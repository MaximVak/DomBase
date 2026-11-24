import { sql } from "drizzle-orm";
import { AuthError, isLoopback, json, readAuthBody, readSessionCookie } from "../auth/http";
import type { createAuthService } from "../auth/service";
import type { createAccessService } from "../access/service";
import type { DocumentBucket } from "../documents/types";
import { registeredDevice } from "../kiosk/device";
import type { createSelfService } from "../self/service";
import type { Database } from "../workforce/context";
import * as v from "../workforce/validation";
import { messagingEnabled } from "./context";
import type { MessengerActor } from "./context";
import { downloadMessengerFile, uploadMessengerFile } from "./files";
import { history, inbox, searchMessages } from "./read";
import { createConversation, markConversation, roster, sendMessage } from "./write";

type Auth = Pick<ReturnType<typeof createAuthService>, "getSession">;
type Access = Pick<ReturnType<typeof createAccessService>, "workspaceContext">;
type SelfAccess = Pick<ReturnType<typeof createSelfService>, "authorize">;

export function createMessengerService(db: Database, auth: Auth, access: Access, self: SelfAccess, options: { secret: string; bucket?: DocumentBucket; now?: () => number }) {
  async function authorize(request: Request, url: URL): Promise<MessengerActor> {
    if (url.protocol !== "https:" && !isLoopback(url.hostname)) throw new AuthError(403, "HTTPS is required.");
    if (await registeredDevice(db, request.headers.get("cookie"), url)) throw new AuthError(403, "Use your own device to open messages.");
    const session = await auth.getSession(readSessionCookie(request.headers.get("cookie"), url));
    if (!session) throw new AuthError(401, "Sign in to continue.");
    if (session.account.accessLevel === "employee") {
      const ctx = await self.authorize(request);
      const account = ctx.account;
      return { account, activeActor: () => ctx.guard, employeeScope: () => sql`1`, roleScope: () => sql`1`, scheduleScope: "own",
        departmentScope: department => sql`EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id=er.role_id
          WHERE er.employee_id=${account.employeeId} AND er.active=1 AND r.archived=0 AND r.department_id=${department})` };
    }
    const ctx = await access.workspaceContext(request);
    ctx.requirePermission("messages.read");
    const { id, employeeId } = ctx.account;
    if (!employeeId) throw new AuthError(403, "Link your dashboard account to an employee profile before messaging.");
    return { account: { id, employeeId }, employeeScope: ctx.employeeFilter, roleScope: ctx.roleFilter,
      activeActor: () => sql`${ctx.activeActor()} AND EXISTS (SELECT 1 FROM employees WHERE id=${employeeId} AND active=1 AND terminated=0)`,
      departmentScope: department => ctx.allDepartments ? sql`1` : sql`${department} IN (SELECT value FROM json_each(${JSON.stringify(ctx.departmentIds)}))`,
      scheduleScope: ctx.permissions["schedule.read"] ? "department" : "none" };
  }
  const unavailable = () => json({ error: "Method not allowed." }, 405);
  const id = (url: URL, key: string) => {
    const value = url.searchParams.get(key);
    if (!value || !/^[1-9]\d*$/.test(value) || url.searchParams.getAll(key).length !== 1) throw new AuthError(400, "Choose a conversation or message.");
    return v.integer(Number(value));
  };
  return { async handle(request: Request) {
    try {
      const url = new URL(request.url);
      const actor = await authorize(request, url);
      if (!await db.get(sql`SELECT 1 WHERE ${actor.activeActor()}`)) throw new AuthError(403, "Messaging is unavailable for this account.");
      if (!await db.get(sql`SELECT 1 WHERE ${messagingEnabled}`)) throw new AuthError(403, "Team messaging is turned off.");
      const now = (options.now ?? Date.now)();
      const route = url.pathname.slice("/api/messenger/".length);
      if (route === "actions") {
        if (request.method !== "POST") return unavailable();
        if (url.search) throw new AuthError(400, "Send the message details in the request body.");
        const body = await readAuthBody(request, 32768);
        const action = v.oneOf(body.action, ["create", "send", "read", "preferences"]);
        if (action === "create") return json(await createConversation(db, actor, body, options.secret, now), 201);
        if (action === "send") return json(await sendMessage(db, actor, options.bucket, body, options.secret, now), 201);
        return json(await markConversation(db, actor, body, now));
      }
      if (route === "files" && request.method === "POST") {
        if (!options.bucket) throw new AuthError(503, "Attachment storage is unavailable.");
        return await uploadMessengerFile(db, actor, options.bucket, request, id(url, "conversation"), now);
      }
      if (request.method !== "GET") return unavailable();
      if (route.startsWith("files/")) {
        if (!options.bucket) throw new AuthError(503, "Attachment storage is unavailable.");
        return await downloadMessengerFile(db, actor, options.bucket, route.slice("files/".length));
      }
      if (route === "inbox") return json(await inbox(db, actor));
      if (route === "roster") return json(await roster(db, actor));
      if (route === "search") return json({ hits: await searchMessages(db, actor, v.text(url.searchParams.get("term"), 100, true)) });
      if (route === "history") {
        const before = url.searchParams.has("before") ? id(url, "before") : undefined;
        const anchor = url.searchParams.has("anchor") ? id(url, "anchor") : undefined;
        if (before && anchor) throw new AuthError(400, "Choose one message position.");
        return json(await history(db, actor, id(url, "conversation"), before, anchor));
      }
      throw new AuthError(404, "Not found.");
    } catch (error) {
      if (error instanceof AuthError) return json({ error: error.message }, error.status);
      console.error("Messenger request failed.");
      return json({ error: "Messaging is temporarily unavailable. Try again shortly." }, 503);
    }
  } };
}
