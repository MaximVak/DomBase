import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { and, eq, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError, isLoopback, json, readAuthBody, readSessionCookie } from "../auth/http";
import type { createAuthService } from "../auth/service";
import type { createAccessService } from "../access/service";
import { rateKey, tokenIsValid } from "../auth/crypto";
import type { Context, Database } from "../workforce/context";
import { WorkspaceTransaction } from "../workforce/transaction";
import { canonical } from "../workforce/contract";
import { certificationStatusFor, earnedAchievements, milestonesFor, shoutoutCategories, reliabilityFor } from "../team/insights-rules";
import { normalizeScheduleEnforcement } from "../app/schedule-enforcement";
import { plusDays } from "../team/rules";
import * as v from "../workforce/validation";

export function createCommunityService(db: Database, auth: ReturnType<typeof createAuthService>, access: ReturnType<typeof createAccessService>, secret: string, now = Date.now) {
  if (secret.length < 32) throw new Error("Community configuration unavailable.");
  return { async handle(request: Request) {
    try {
      const url = new URL(request.url);
      if (url.protocol !== "https:" && !isLoopback(url.hostname)) throw new AuthError(403, "HTTPS is required.");
      // workspaceContext rejects devices for managers; employees need the same separate check.
      const { registeredDevice } = await import("../kiosk/device");
      if (await registeredDevice(db, request.headers.get("cookie"), url)) throw new AuthError(403, "Use a personal browser for team recognition.");
      const session = await auth.getSession(readSessionCookie(request.headers.get("cookie"), url));
      if (!session) throw new AuthError(401, "Sign in to continue.");
      const { account, sessionId, version } = session; const own = account.employeeId;
      const management: Context | null = account.accessLevel === "employee" ? null : await access.workspaceContext(request);
      if (management) management.requirePermission("team.read");
      const stamp = new Date(now()).toISOString();
      const guard = () => management ? management.activeActor() : sql`EXISTS (SELECT 1 FROM accounts a JOIN account_sessions acs ON acs.account_id = a.id JOIN employees e ON e.id = a.employee_id WHERE a.id = ${account.id} AND a.employee_id = ${own} AND a.access_level = 'employee' AND a.session_version = ${version} AND a.disabled_at IS NULL AND a.login_enabled = 1 AND acs.id = ${sessionId} AND acs.session_version = a.session_version AND acs.revoked_at IS NULL AND julianday(acs.expires_at) > julianday(${stamp}) AND julianday(COALESCE(acs.last_seen_at,acs.created_at)) > julianday(${new Date(now() - 1800000).toISOString()}) AND e.active = 1 AND e.terminated = 0)`;
      const personScope = (column: SQLWrapper) => management ? management.employeeFilter(column) : sql`1 = 1`;
      const linkGuard = sql`EXISTS (SELECT 1 FROM employees e JOIN accounts a ON a.employee_id = e.id WHERE a.id = ${account.id} AND e.id = ${own} AND e.active = 1 AND e.terminated = 0)`;
      const contextToken = rateKey(secret, `community:${account.id}:${own}:${sessionId}:${version}`);
      const [settings] = await db.select().from(s.locationSettings).limit(1); const messaging = settings?.enableTeamMessaging ?? true;
      const [person] = own ? await db.select({ id: s.employees.id, name: s.employees.name, startDate: s.employees.startDate, active: s.employees.active, terminated: s.employees.terminated }).from(s.employees).where(eq(s.employees.id, own)) : [];
      const [pref] = own ? await db.select().from(s.recognitionPreferences).where(eq(s.recognitionPreferences.employeeId, own)) : [];
      const recognitionEnabled = messaging && (!management || management.permissions["messages.read"]);
      const peers = recognitionEnabled ? await db.select({ id: s.employees.id, name: s.employees.name }).from(s.employees).where(and(eq(s.employees.active, true), eq(s.employees.terminated, false), personScope(s.employees.id))).orderBy(s.employees.name).limit(1001) : [];
      if (peers.length > 1000) throw new AuthError(413, "The team directory needs a smaller scope.");
      const canSend = recognitionEnabled && !!person?.active && !person.terminated && (!management || management.permissions["messages.read"]), canModerate = recognitionEnabled && !!management?.permissions["team.manage"];
      const visible = sql`${personScope(s.teamShoutouts.senderEmployeeId)} AND ${personScope(s.teamShoutouts.recipientEmployeeId)} AND ${management ? sql`1 = 1` : sql`(${s.teamShoutouts.senderEmployeeId} = ${own} OR ${s.teamShoutouts.recipientEmployeeId} = ${own})`}`;
      const [revisionRow] = await db.select().from(s.workforceState).limit(1); const revision = revisionRow?.revision ?? 0;
      if (url.pathname === "/api/community/state" && request.method === "GET") {
        const all = recognitionEnabled ? await db.select().from(s.teamShoutouts).where(sql`${visible} AND NOT EXISTS (SELECT 1 FROM shoutout_moderation m WHERE m.shoutout_id = ${s.teamShoutouts.id})`).orderBy(sql`${s.teamShoutouts.createdAt} DESC`, s.teamShoutouts.id).limit(201) : [];
        const feed = all.slice(0, 200);
        const names = new Map((await db.select({ id: s.employees.id, name: s.employees.name }).from(s.employees).where(personScope(s.employees.id))).map(p => [p.id, p.name]));
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now());
        const ownCertificates = own ? await db.select({ id: s.employeeCertificates.id, title: s.employeeCertificates.name, expirationDate: s.employeeCertificates.expirationDate }).from(s.employeeCertificates).where(eq(s.employeeCertificates.employeeId, own)) : [];
        const people = await db.all<{ id: number; name: string; startDate: string; monthDay: string | null }>(sql`SELECT e.id, e.name, e.start_date AS startDate, CASE WHEN rp.share_birthday = 1 THEN substr(p.date_of_birth,6,5) ELSE NULL END AS monthDay FROM employees e LEFT JOIN employee_profiles p ON p.employee_id=e.id LEFT JOIN recognition_preferences rp ON rp.employee_id=e.id WHERE e.active=1 AND e.terminated=0 AND ${management ? personScope(sql`e.id`) : sql`e.id = ${own}`}`);
        const milestones = people.flatMap(p => milestonesFor({ ...p, startDate: p.startDate ?? "", birthdayMonthDay: p.monthDay ?? undefined }, today, plusDays(today, 30))).sort((a, b) => a.date.localeCompare(b.date));
        // Achievement rules expose only own worked-shift counts, never peers' punches or scores.
        const [shifts, punches, edits, cards] = own ? await db.batch([db.select().from(s.shifts).where(and(eq(s.shifts.employeeId, own), sql`archived_at IS NULL AND publication_id IS NOT NULL`)).limit(10001), db.select().from(s.clockEvents).where(eq(s.clockEvents.employeeId, own)).orderBy(s.clockEvents.id).limit(10001), db.select().from(s.timeCardEdits).where(eq(s.timeCardEdits.employeeId, own)).orderBy(s.timeCardEdits.createdAt, s.timeCardEdits.id).limit(10001), db.select().from(s.timeCards).where(eq(s.timeCards.employeeId, own)).limit(10001)]) : [[], [], [], []];
        if ([shifts, punches, edits, cards].some(rows => rows.length > 10000)) throw new AuthError(413, "Your history needs a smaller calculation window.");
        let events = punches.map(e => ({ id: e.id, employeeId: e.employeeId, type: e.eventType, at: /Z$|[+-]\d\d:\d\d$/.test(e.occurredAt) ? e.occurredAt : e.occurredAt.replace(" ", "T") + "Z", automatic: e.automatic }));
        for (const edit of edits) if (Array.isArray(edit.before.eventIds) && Array.isArray(edit.after.events)) { const removed = new Set(edit.before.eventIds); events = [...events.filter(e => !removed.has(e.id)), ...edit.after.events as typeof events]; }
        const scores = person ? reliabilityFor({ employees: [person], shifts: shifts.map(s => ({ id: s.id, employeeId: s.employeeId, date: s.date, start: s.startTime, end: s.endTime, role: s.roleName, station: s.station })), clockEvents: events, ptoRequests: [] }, "1900-01-01", today, now(), normalizeScheduleEnforcement(settings)) : [];
        const [received] = recognitionEnabled && own ? await db.select({ count: sql<number>`count(*)` }).from(s.teamShoutouts).where(sql`recipient_employee_id = ${own} AND NOT EXISTS (SELECT 1 FROM shoutout_moderation m WHERE m.shoutout_id=${s.teamShoutouts.id})`) : [{ count: 0 }];
        if (!await db.get(sql`SELECT 1 WHERE ${guard()}`)) throw new AuthError(401, "Your access changed. Sign in again.");
        return json({ revision, contextToken, ownEmployeeId: own, canSend, canModerate, messagingEnabled: messaging, preferences: { shareBirthday: pref?.shareBirthday ?? false, version: pref?.version ?? 0 }, categories: shoutoutCategories, peers,
          shoutouts: feed.map(s => ({ id: s.id, senderId: s.senderEmployeeId, recipientId: s.recipientEmployeeId, sender: names.get(s.senderEmployeeId) ?? "Former teammate", recipient: names.get(s.recipientEmployeeId) ?? "Former teammate", category: s.category, body: s.body, at: s.createdAt })), hasMore: all.length > 200,
          milestones, certificates: ownCertificates.map(c => ({ ...c, status: certificationStatusFor({name:c.title,expirationDate:c.expirationDate}, ownCertificates.map(c=>({name:c.title,expirationDate:c.expirationDate})), today) })), achievements: earnedAchievements(scores, received.count) });
      }
      if (request.method !== "POST" || !["/api/community/preferences", "/api/community/shoutouts", "/api/community/moderate"].includes(url.pathname)) throw new AuthError(404, "Not found.");
      const body = await readAuthBody(request, 8192); const isPref = url.pathname.endsWith("/preferences"), isModeration = url.pathname.endsWith("/moderate");
      v.keys(body, ["id", "revision", "contextToken", ...(isPref ? ["shareBirthday", "version"] : isModeration ? ["shoutoutId"] : ["recipientId", "category", "message"])]);
      if (!tokenIsValid(body.id)) throw new AuthError(400, "Invalid save identifier.");
      if (typeof body.contextToken !== "string" || !/^[a-f0-9]{64}$/.test(body.contextToken) || !timingSafeEqual(Buffer.from(body.contextToken), Buffer.from(contextToken))) throw new AuthError(409, "This form belongs to another sign-in. Reload before saving.");
      const hash = rateKey(secret, canonical(body)); const [prior] = await db.select().from(s.workforceCommits).where(eq(s.workforceCommits.id, body.id));
      if (prior) { if (prior.accountId !== account.id || prior.bodyHash !== hash) throw new AuthError(409, "Save identifier already used."); return json({ saved: true }); }
      if (v.integer(body.revision, 0) !== revision) throw new AuthError(409, "The team changed. Reload before saving.");
      const tx = new WorkspaceTransaction(db, { account, activeActor: guard }, body.id, stamp);
      if (isPref) {
        if (!own || !person?.active || person.terminated) throw new AuthError(403, "Link an active employee to manage personal reminders.");
        const expected = v.integer(body.version, 0); if (expected !== (pref?.version ?? 0)) throw new AuthError(409, "Reminder preferences changed. Reload first.");
        const values = { shareBirthday: v.boolean(body.shareBirthday), version: expected + 1, updatedAt: stamp };
        if (pref) tx.update(s.recognitionPreferences, values, sql`employee_id=${own} AND version=${expected} AND ${linkGuard}`);
        else tx.insert(s.recognitionPreferences, { employeeId: own, ...values }, linkGuard);
      } else if (isModeration) {
        if (!canModerate || !tokenIsValid(body.shoutoutId)) throw new AuthError(403, "You cannot hide this shout-out.");
        const [target] = await db.select().from(s.teamShoutouts).where(and(eq(s.teamShoutouts.id, body.shoutoutId), visible));
        if (!target) throw new AuthError(404, "Shout-out not available.");
        tx.insert(s.shoutoutModeration, { shoutoutId: target.id, actorAccountId: account.id, createdAt: stamp });
      } else {
        if (!canSend || !own) throw new AuthError(403, "Team recognition is unavailable for this account.");
        const recipient = v.integer(body.recipientId); if (recipient === own || !peers.some(p => p.id === recipient)) throw new AuthError(403, "Choose another active teammate in your scope.");
        if ((await db.get<{ count: number }>(sql`SELECT count(*) AS count FROM team_shoutouts WHERE actor_account_id=${account.id} AND created_at > ${new Date(now() - 3600000).toISOString()}`))!.count >= 20) throw new AuthError(429, "You have sent 20 shout-outs this hour. Try again later.");
        tx.insert(s.teamShoutouts, { id: body.id, senderEmployeeId: own, recipientEmployeeId: recipient, actorAccountId: account.id, category: v.oneOf(body.category, shoutoutCategories.map(c => c.id)), body: v.text(body.message, 500, true), bodyHash: hash, createdAt: stamp }, sql`${linkGuard} AND EXISTS (SELECT 1 FROM employees WHERE id=${recipient} AND active=1 AND terminated=0 AND ${personScope(sql`employees.id`)}) AND NOT EXISTS (SELECT 1 FROM location_settings WHERE enable_team_messaging=0) AND (SELECT count(*) FROM team_shoutouts WHERE actor_account_id=${account.id} AND created_at > ${new Date(now() - 3600000).toISOString()}) < 20`);
      }
      if (!await tx.commit(revision, hash, [isPref ? "recognition.preferences" : isModeration ? "recognition.moderated" : "recognition.sent"])) throw new AuthError(409, "The team or your access changed. Reload before saving.");
      return json({ saved: true });
    } catch (error) { if (error instanceof AuthError) return json({ error: error.message }, error.status); console.error("Community request failed."); return json({ error: "Could not confirm the change. Reload before trying again." }, 503); }
  } };
}
