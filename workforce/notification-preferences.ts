import { and, eq, sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { PermissionMap } from "../access/policy";
import * as s from "../db/schema";
import { AuthError, json, readAuthBody } from "../auth/http";
import { rateKey, tokenIsValid } from "../auth/crypto";
import { validEmail } from "../backup/email-config.mjs";
import { normalizePhone } from "../team/rules";
import { canonical } from "./contract";
import type { Database } from "./context";
import { dashboardNotificationEvents, notificationSpec, notificationTypes } from "./notification-preferences-model";
import type { ChannelValues, DashboardNotificationFlags, NotificationChannel, NotificationChoices, NotificationEvent, NotificationPreferences, NotificationSpec } from "./notification-preferences-model";
import { WorkspaceTransaction } from "./transaction";
import * as v from "./validation";

type PreferenceContext = {
  account: { id: number; employeeId: number | null }; guard: SQL; contextToken: string;
  manager?: { attendance: boolean; timeOff: boolean; schedule: boolean; messaging: boolean };
};

export function managerNotificationAccess(p: PermissionMap) {
  return { attendance: p["schedule.read"] && p["timesheets.read"],
    timeOff: p["time_off.read"] && (p["team.manage"] || p["schedule.manage"] || p["time_off.approve"]),
    schedule: p["schedule.manage"], messaging: p["messages.read"] };
}

function channelPath(event: NotificationEvent, channel: NotificationChannel) {
  return `$.events.${event}.${channel}`;
}

export function accountNotificationAllowed(accountId: number, event: NotificationEvent, channel: NotificationChannel) {
  const fallback = notificationSpec(event).channels[channel] === true;
  const value = sql`(SELECT json_extract(p.choices, ${channelPath(event, channel)}) FROM account_notification_preferences p WHERE p.account_id=${accountId})`;
  if (channel !== "sms") return sql`COALESCE(${value},${fallback})=1`;
  return sql`COALESCE(${value},0)=1 AND EXISTS (SELECT 1 FROM account_notification_preferences p WHERE p.account_id=${accountId} AND json_extract(p.choices,'$.smsEnabled')=1)`;
}

// Legacy schedule choices also supply the default for trades and claims. An
// explicit choice for either of those events takes precedence for that event.
export function employeeNotificationAllowed(employeeId: SQLWrapper, event: NotificationEvent, channel: NotificationChannel, fallback = sql`${notificationSpec(event).channels[channel] === true}`) {
  const account = sql`FROM accounts a JOIN account_notification_preferences p ON p.account_id=a.id
    WHERE a.employee_id=${employeeId}`;
  const value = sql`(SELECT json_extract(p.choices, ${channelPath(event, channel)}) ${account})`;
  if (channel !== "sms") return sql`COALESCE(${value},${fallback})=1`;
  return sql`EXISTS (SELECT 1 ${account} AND a.login_enabled=1 AND a.disabled_at IS NULL
    AND json_extract(p.choices,'$.smsEnabled')=1 AND json_extract(p.choices,${channelPath(event, channel)})=1)`;
}

export async function dashboardNotificationFlags(db: Database, accountId: number): Promise<DashboardNotificationFlags> {
  const [row] = await db.select({ choices: s.accountNotificationPreferences.choices }).from(s.accountNotificationPreferences)
    .where(eq(s.accountNotificationPreferences.accountId, accountId));
  return Object.fromEntries(dashboardNotificationEvents.map(event => [event, row?.choices.events?.[event]?.inApp ?? true])) as DashboardNotificationFlags;
}

function visibleTypes(linked: boolean, manager: PreferenceContext["manager"]): readonly NotificationSpec[] {
  return notificationTypes.filter(type => {
    switch (type.id) {
      case "lateArrival": case "noShow": case "clockExceptions": case "managerOvertime": case "dailySummary": case "weeklySummary": return !!manager?.attendance;
      case "timeOffRequest": return !!manager?.timeOff;
      case "managerShiftExchange": case "managerOpenShift": return !!manager?.schedule;
      case "announcement": case "mention": return !manager || manager.messaging;
      default: return linked;
    }
  });
}

async function preferenceState(db: Database, ctx: PreferenceContext) {
  const [row] = await db.select({ revision: s.workforceState.revision, version: s.accountNotificationPreferences.version, choices: s.accountNotificationPreferences.choices,
    employeeId: s.employees.id, email: s.employees.email, phone: s.employees.phone, locationAlerts: s.employeeSettings.sendLocationAlerts, scheduleAlerts: s.locationSettings.notifyScheduleChanges,
    scheduleVersion: s.scheduleNotificationPreferences.version, scheduleInApp: s.scheduleNotificationPreferences.inApp, scheduleEmail: s.scheduleNotificationPreferences.email,
  }).from(s.accounts).innerJoin(s.workforceState, eq(s.workforceState.id, 1))
    .leftJoin(s.employees, and(eq(s.employees.id, s.accounts.employeeId), eq(s.employees.active, true), eq(s.employees.terminated, false)))
    .leftJoin(s.accountNotificationPreferences, eq(s.accountNotificationPreferences.accountId, s.accounts.id))
    .leftJoin(s.scheduleNotificationPreferences, eq(s.scheduleNotificationPreferences.employeeId, s.employees.id))
    .leftJoin(s.employeeSettings, eq(s.employeeSettings.employeeId, s.employees.id)).leftJoin(s.locationSettings, eq(s.locationSettings.businessId, 1))
    .where(and(eq(s.accounts.id, ctx.account.id), ctx.guard)).limit(1);
  if (!row) throw new AuthError(401, "Sign in to continue.");
  return row;
}

async function readPreferences(db: Database, ctx: PreferenceContext): Promise<NotificationPreferences> {
  const row = await preferenceState(db, ctx);
  const schedule = { inApp: row.scheduleInApp ?? true, email: row.scheduleEmail ?? true };
  return { revision: row.revision, version: row.version ?? 0, scheduleVersion: row.scheduleVersion ?? 0, contextToken: ctx.contextToken,
    smsEnabled: row.choices?.smsEnabled === true, hasPhone: !!normalizePhone(row.phone ?? ""), hasScheduleEmail: validEmail((row.email ?? "").trim()),
    locationAlerts: row.locationAlerts !== false, scheduleAlerts: row.scheduleAlerts !== false,
    rows: visibleTypes(row.employeeId !== null, ctx.manager).map(({ id, channels }) => ({ id, channels: {
      ...channels, ...(row.employeeId !== null && (id === "shiftExchange" || id === "openShift") ? schedule : {}), ...row.choices?.events?.[id],
      ...(id === "schedule" ? schedule : {}),
    } })),
  };
}

async function savePreferences(db: Database, ctx: PreferenceContext, body: Record<string, unknown>, secret: string, now: number) {
  v.keys(body, ["id", "contextToken", "revision", "version", "scheduleVersion", "smsEnabled", "events"]);
  const id = body.id;
  if (!tokenIsValid(id)) throw new AuthError(400, "Invalid save identifier.");
  if (body.contextToken !== ctx.contextToken) throw new AuthError(409, "Your sign-in changed. Reload notification preferences.");
  const revision = v.integer(body.revision, 0), version = v.integer(body.version, 0), scheduleVersion = v.integer(body.scheduleVersion, 0);
  const bodyHash = `notification-preferences:${rateKey(secret, canonical(body))}`;
  async function previous() {
    const [receipt] = await db.select().from(s.workforceCommits).where(and(eq(s.workforceCommits.id, id as string), ctx.guard)).limit(1);
    if (!receipt) return false;
    if (receipt.bodyHash !== bodyHash || receipt.accountId !== ctx.account.id) throw new AuthError(409, "This save identifier is already in use.");
    return true;
  }
  if (await previous()) return readPreferences(db, ctx);
  const current = await preferenceState(db, ctx);
  if (current.revision !== revision || (current.version ?? 0) !== version || (current.scheduleVersion ?? 0) !== scheduleVersion) {
    throw new AuthError(409, "Preferences or shared data changed. Reload before saving.");
  }
  const allowed = visibleTypes(current.employeeId !== null, ctx.manager);
  const changes = v.object(body.events ?? {});
  v.keys(changes, allowed.map(event => event.id));
  const choices: NotificationChoices = { ...current.choices, events: { ...current.choices?.events } };
  const schedule: ChannelValues = {};
  for (const event of allowed) {
    if (!(event.id in changes)) continue;
    const update = v.object(changes[event.id]);
    v.keys(update, Object.keys(event.channels));
    for (const channel of Object.keys(update) as NotificationChannel[]) {
      const enabled = v.boolean(update[channel]);
      if (event.id === "schedule" && channel !== "sms") schedule[channel] = enabled;
      else choices.events![event.id] = { ...choices.events![event.id], [channel]: enabled };
    }
  }
  if (body.smsEnabled !== undefined) {
    if (!current.employeeId) throw new AuthError(400, "An active employee profile is required for text preferences.");
    choices.smsEnabled = v.boolean(body.smsEnabled);
  }
  const stamp = new Date(now).toISOString();
  const tx = new WorkspaceTransaction(db, { account: ctx.account, activeActor: () => ctx.guard }, id, stamp);
  if (version) tx.update(s.accountNotificationPreferences, { choices, version: version + 1, updatedAt: stamp }, sql`account_id=${ctx.account.id} AND version=${version}`);
  else tx.insert(s.accountNotificationPreferences, { accountId: ctx.account.id, choices, createdAt: stamp, updatedAt: stamp });
  if (Object.keys(schedule).length && current.employeeId !== null) {
    const { inApp = current.scheduleInApp ?? true, email = current.scheduleEmail ?? true } = schedule;
    const active = sql`EXISTS (SELECT 1 FROM employees WHERE id=${current.employeeId} AND active=1 AND terminated=0)`;
    if (scheduleVersion) tx.update(s.scheduleNotificationPreferences, { inApp, email, version: scheduleVersion + 1, updatedAt: stamp }, sql`employee_id=${current.employeeId} AND version=${scheduleVersion} AND ${active}`);
    else tx.insert(s.scheduleNotificationPreferences, { employeeId: current.employeeId, inApp, email, createdAt: stamp, updatedAt: stamp }, active);
  }
  tx.insert(s.auditLog, { actorAccountId: ctx.account.id, employeeId: current.employeeId, action: "notifications.preferences_changed", entityType: "account", entityId: String(ctx.account.id), metadata: { events: changes, smsEnabled: body.smsEnabled }, createdAt: stamp });
  if (!await tx.commit(revision, bodyHash, ["notification-preferences"]) && !await previous()) throw new AuthError(409, "Your access or shared data changed. Reload before saving.");
  return readPreferences(db, ctx);
}

export async function handleNotificationPreferences(db: Database, ctx: PreferenceContext, request: Request, secret: string, now: number, smsConfigured: boolean, managerEmailConfigured = false) {
  if (new URL(request.url).search) throw new AuthError(400, "Preferences do not accept account selectors.");
  if (request.method === "GET") return json({ ...await readPreferences(db, ctx), smsConfigured, ...(ctx.manager ? { managerEmailConfigured } : {}) });
  if (request.method === "POST") return json({ ...await savePreferences(db, ctx, await readAuthBody(request, 8192), secret, now), smsConfigured, ...(ctx.manager ? { managerEmailConfigured } : {}) });
  return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
}
