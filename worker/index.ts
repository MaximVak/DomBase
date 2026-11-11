/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { drizzle } from "drizzle-orm/d1";
import { registeredDevice } from "../kiosk/device";
import * as schema from "../db/schema";
import { runScheduledMaintenance } from "../workforce/maintenance";
import { cleanupDocumentUploads } from "../documents/maintenance";
import type { DocumentBucket } from "../documents/types";

interface Env {
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
    const db = drizzle(env.DB, { schema });
    ctx.waitUntil(runScheduledMaintenance(db).then(recorded => {
      // Scheduled-only, non-personal evidence that background work ran without a browser.
      console.info("Scheduled workforce maintenance complete", { recorded });
    }));
    if (env.FILES && new Date().getUTCMinutes() === 0) ctx.waitUntil(cleanupDocumentUploads(db, env.FILES));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (["/", "/login", "/setup", "/access", "/kiosk-admin", "/me", "/team", "/team/reports", "/community", "/invite"].includes(url.pathname)) {
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
    if (["/", "/login", "/setup", "/access", "/kiosk", "/kiosk-admin", "/me", "/team", "/team/reports", "/community", "/invite"].includes(url.pathname) || /^\/api\/(auth|access|workforce|workspace|documents|kiosk|kiosk-admin|self|team|community|invitations)\//.test(url.pathname)) {
      const headers = new Headers(response.headers);
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
