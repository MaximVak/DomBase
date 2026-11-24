/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { drizzle } from "drizzle-orm/d1";
import { registeredDevice } from "../kiosk/device";
import * as schema from "../db/schema";
import { runScheduledMaintenance } from "../workforce/maintenance";
import { cleanupDocumentUploads } from "../documents/maintenance";
import { scheduleHostedBackup } from "../backup/schedule";
import type { BackupScheduleEnv } from "../backup/schedule";
import type { DocumentBucket } from "../documents/types";
import { dispatchScheduleEmails } from "../workforce/schedule-email";
import { dispatchClockReminderEmails } from "../workforce/clock-reminder-email";
import { dispatchInvitationEmails } from "../team/email";
import { dispatchEmployeeNotices, runEmployeeReminderDelivery, smsAvailable } from "../workforce/employee-notice-delivery";
import type { EmployeeNoticeEnv } from "../workforce/employee-notice-delivery";
import { runManagerEmailDelivery } from "../workforce/manager-email";
import type { ManagerEmailEnv } from "../workforce/manager-email";

interface Env extends Omit<BackupScheduleEnv, "AUTH_PRIVATE_FIELD_KEY">, EmployeeNoticeEnv, ManagerEmailEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES?: DocumentBucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduleHostedBackup(env));
    const db = drizzle(env.DB, { schema });
    ctx.waitUntil(dispatchScheduleEmails(db, env).catch(() => { console.error("Schedule email status is temporarily unavailable."); }));
    ctx.waitUntil(dispatchInvitationEmails(db, env).catch(() => { console.error("Invitation email queue is temporarily unavailable."); }));
    const now = Date.now();
    ctx.waitUntil(runScheduledMaintenance(db, now, async () => {
      await Promise.all([
        dispatchClockReminderEmails(db, env, now).catch(() => console.error("Clock reminder email is temporarily unavailable.")),
        runEmployeeReminderDelivery(db, env, now).catch(() => console.error("Employee reminder delivery is temporarily unavailable.")),
        runManagerEmailDelivery(db, env, now).catch(() => console.error("Manager email delivery is temporarily unavailable.")),
      ]);
    }).then(recorded => {
      // Scheduled-only, non-personal evidence that background work ran without a browser.
      console.info("Scheduled workforce maintenance complete", { recorded });
    }));
    if (env.FILES && new Date().getUTCMinutes() === 0) ctx.waitUntil(cleanupDocumentUploads(db, env.FILES));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (["/", "/login", "/setup", "/access", "/kiosk-admin", "/me", "/me/schedule", "/me/availability", "/team", "/team/reports", "/community", "/invite", "/backups"].includes(url.pathname)) {
      try {
        if (await registeredDevice(drizzle(env.DB, { schema }), request.headers.get("cookie"), url)) {
          return new Response(null, { status: 303, headers: { Location: "/kiosk", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
        }
      } catch {
        return new Response("Sign-in is temporarily unavailable. Please try again.", { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    if (request.method === "POST" && (url.pathname === "/api/workspace/commit" || (["/api/workspace/open-shifts", "/api/workspace/shift-exchanges", "/api/self/shift-exchanges"].includes(url.pathname) && response.headers.get("X-Schedule-Dispatch") === "1")) && response.ok) ctx.waitUntil(dispatchScheduleEmails(drizzle(env.DB, { schema }), env).catch(() => { console.error("Schedule email status is temporarily unavailable."); }));
    if (request.method === "POST" && url.pathname === "/api/workspace/commit" && response.ok && smsAvailable(env)) {
      ctx.waitUntil(dispatchEmployeeNotices(drizzle(env.DB, { schema }), env, Date.now(), "schedule").catch(() => console.error("Schedule text status is temporarily unavailable.")));
    }
    if (["/", "/login", "/setup", "/access", "/kiosk", "/kiosk-admin", "/me", "/me/schedule", "/me/availability", "/team", "/team/reports", "/community", "/invite", "/backups"].includes(url.pathname) || /^\/api\/(auth|access|workforce|workspace|documents|kiosk|kiosk-admin|self|team|community|invitations|backups)\//.test(url.pathname)) {
      const headers = new Headers(response.headers);
      headers.delete("X-Schedule-Dispatch");
      headers.set("Cache-Control", "private, no-store");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Frame-Options", "DENY");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  },
};

export default worker;
