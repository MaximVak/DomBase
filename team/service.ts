import { createTeamInsights } from "./insights";
import { eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { AuthError, json, readAuthBody } from "../auth/http";
import { newToken, rateKey } from "../auth/crypto";
import type { createAccessService } from "../access/service";
import type { Database } from "../workforce/context";
import { WorkspaceTransaction } from "../workforce/transaction";
import { workspaceSnapshot } from "../workforce/snapshot";
import { employeeChange } from "../workforce/records";
import { scheduleChange } from "../workforce/schedule";
import { canonical, newRecordId } from "../workforce/contract";
import * as v from "../workforce/validation";
import { invitation, localInbox } from "./invitations";
import { periodFor, tenure, terminationReasons, normalizePhone } from "./rules";
export function createTeamService(db: Database, access: ReturnType<typeof createAccessService>, options: { secret: string; fieldKey: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  async function handle(request: Request) {
    try {
      if (new URL(request.url).pathname === "/api/team/insights") return createTeamInsights(db, access, options.fieldKey, now).handle(request);
      const ctx = await access.workspaceContext(request); ctx.requirePermission("team.read");
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now());
      const path = new URL(request.url).pathname.slice("/api/team/".length);
      if (path === "inbox" && request.method === "GET") return json(await localInbox(db, ctx, request, options.fieldKey, now()));
      const view = await workspaceSnapshot(db, ctx, options.fieldKey);
      const roles = await db.select().from(s.roles);
      const [config] = await db.select().from(s.teamSettings);
      const settings = config ?? { id: 1, payPeriod: "weekly" as const, anchorDate: "2026-11-02", version: 1 };
      if (path === "state" && request.method === "GET") {
        const invites = ctx.permissions["team.invite"] ? await db.select({ id: s.teamInvitations.id, employeeId: s.teamInvitations.employeeId, channel: s.teamInvitations.channel,
          expiresAt: s.teamInvitations.expiresAt, usedAt: s.teamInvitations.usedAt, revokedAt: s.teamInvitations.revokedAt }).from(s.teamInvitations).where(ctx.employeeFilter(s.teamInvitations.employeeId)).limit(500) : [];
        return json({ revision: view.revision, permissions: ctx.permissions, allDepartments: ctx.allDepartments, settings, currentPeriod: periodFor(today, settings.payPeriod, settings.anchorDate), today,
          departments: view.state.departments, roles: roles.filter(role => !role.archived && (ctx.allDepartments || ctx.departmentIds.includes(role.departmentId ?? -1))).map(role => ({ id: role.id, name: role.name, departmentId: role.departmentId })),
          shifts: view.state.shifts, employees: view.state.employees.map(e => ({ id: e.id, version: view.employeeVersions[e.id], name: e.name, email: e.email, phone: e.phone,
            startDate: e.startDate, tenure: tenure(e.startDate, today), payrollId: e.payrollId, active: e.active, terminated: e.terminated, terminationDate: e.terminationDate,
            terminationReason: e.terminationReason, eligibleForRehire: e.eligibleForRehire, photoFileId: e.photoFileId, jobs: e.jobs ?? [], wageRates: e.wageRates ?? [], employmentHistory: e.employmentHistory ?? [] })), invites });
      }
      if (path !== "commit" || request.method !== "POST") throw new AuthError(404, "Not found.");
      const body = await readAuthBody(request, 65536); v.keys(body, ["id", "revision", "operation", "data"]);
      if (typeof body.id !== "string" || !/^[\w-]{43}$/.test(body.id)) throw new AuthError(400, "Invalid save identifier.");
      const hash = rateKey(options.secret, canonical(body));
      const [previous] = await db.select().from(s.workforceCommits).where(eq(s.workforceCommits.id, body.id));
      if (previous) { if (previous.accountId !== ctx.account.id || previous.bodyHash !== hash) throw new AuthError(409, "Save identifier already used."); return json({ saved: true }); }
      if (v.integer(body.revision, 0) !== view.revision) throw new AuthError(409, "Team changed. Reload before saving.");
      const tx = new WorkspaceTransaction(db, ctx, body.id, new Date(now()).toISOString());
      const r = { db, ctx, tx, view, roles, fieldKey: options.fieldKey, today };
      const operation = v.oneOf(body.operation, ["bulk", "invite", "jobs", "wage", "details", "employment", "settings", "publish"]);
      if (operation === "invite") ctx.requirePermission("team.invite");
      const data = v.object(body.data);
      async function person() {
        const id = v.integer(data.employeeId); const e = view.state.employees.find(e => e.id === id);
        if (!e) throw new AuthError(404, "Employee not available.");
        if (view.employeeVersions[id] !== v.integer(data.version)) throw new AuthError(409, "Employee changed. Reload before saving.");
        return e;
      }
      function job(id: unknown) { const role = roles.find(role => role.id === v.integer(id) && !role.archived && (ctx.allDepartments || ctx.departmentIds.includes(role.departmentId ?? -1))); if (!role) throw new AuthError(403, "Choose a job in your departments."); return role; }
      async function canInvite(id: number) {
        ctx.requirePermission("team.invite"); ctx.requirePermission("team.contact.read");
        if (await db.get(sql`SELECT 1 FROM accounts WHERE employee_id = ${id}`)) throw new AuthError(409, "An account already exists. Use Account access for initial setup or sign in.");
      }
      if (operation === "bulk") {
        ctx.requirePermission("team.manage"); v.keys(data, ["rows"]); const rows = v.list(data.rows, 50);
        if (!rows.length) throw new AuthError(400, "Add at least one employee.");
        const contacts = new Set<string>();
        for (const entry of rows) {
          const row = v.object(entry); v.keys(row, ["name", "email", "phone", "roleId", "startDate", "channel"]);
          const name = v.text(row.name, 100, true); const email = v.text(row.email ?? "", 254).toLowerCase(); const suppliedPhone = v.text(row.phone ?? "", 50); const phone = normalizePhone(suppliedPhone);
          if (phone === null || (!email && !phone) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new AuthError(400, "Each employee needs a valid email or phone.");
          for (const key of [email && `email:${email}`, phone && `phone:${phone.replace(/\D/g, "")}`].filter(Boolean)) { if (contacts.has(key)) throw new AuthError(400, "Duplicate contact in this batch."); contacts.add(key); }
          if ((await db.select({ email: s.employees.email, phone: s.employees.phone }).from(s.employees)).some(existing => email && existing.email.trim().toLowerCase() === email || phone && normalizePhone(existing.phone) === phone)) throw new AuthError(409, "A contact is already on the team. Review that record instead of adding a duplicate.");
          const role = job(row.roleId); const id = newRecordId();
          tx.insert(s.employees, { id, name, email, phone, pinHash: `unenrolled:${newToken()}`, roleId: role.id, active: true, startDate: row.startDate ? v.date(row.startDate) : today });
          tx.insert(s.employeeRoles, { employeeId: id, roleId: role.id, active: true });
          if (row.channel) { ctx.requirePermission("team.invite"); const channel = v.oneOf(row.channel, ["email", "sms"]); const recipient = channel === "email" ? email : phone; if (!recipient) throw new AuthError(400, "Choose a channel with a contact value."); invitation(tx, id, channel, recipient, options.fieldKey, now(), ctx.version); }
        }
      } else if (operation === "settings") {
        ctx.requirePermission("settings.manage"); if (!ctx.allDepartments) throw new AuthError(403, "Company-wide settings require company-wide access.");
        v.keys(data, ["payPeriod", "anchorDate"]); tx.update(s.teamSettings, { payPeriod: v.oneOf(data.payPeriod, ["weekly", "biweekly", "semimonthly", "monthly"]), anchorDate: v.date(data.anchorDate), version: settings.version + 1 }, sql`id = 1 AND version = ${settings.version}`);
      } else if (operation === "publish") {
        v.keys(data, ["departmentId"]); const departmentId = v.integer(data.departmentId);
        if (!view.state.departments.some(d => d.id === departmentId)) throw new AuthError(403, "Department is outside your access.");
        await scheduleChange(r, { entity: "schedule-publish", id: 1, before: null, after: { departmentId } });
      } else {
        const e = await person();
        if (operation === "invite") {
          v.keys(data, ["employeeId", "version", "channel"]); await canInvite(e.id);
          if (!e.active || e.terminated) throw new AuthError(400, "Invite an active employee.");
          const channel = v.oneOf(data.channel, ["email", "sms"]); const recipient = channel === "email" ? e.email : normalizePhone(e.phone);
          if (!recipient) throw new AuthError(400, "Add the contact value before inviting.");
          invitation(tx, e.id, channel, recipient, options.fieldKey, now(), ctx.version);
        } else if (operation === "jobs") {
          ctx.requirePermission("team.manage"); v.keys(data, ["employeeId", "version", "roleIds"]);
          const selected = v.list(data.roleIds, 30).map(job); if (!selected.length || new Set(selected.map(r => r.id)).size !== selected.length) throw new AuthError(400, "Choose unique jobs and a primary job.");
          if (!ctx.allDepartments && await db.get(sql`SELECT 1 FROM employee_roles er WHERE er.employee_id = ${e.id} AND er.active = 1 AND NOT (${ctx.roleFilter(sql`er.role_id`)})`)) throw new AuthError(403, "An Owner must change a multi-department employee's jobs.");
          tx.update(s.employees, { roleId: selected[0].id, version: data.version as number + 1, updatedAt: tx.stamp }, sql`id = ${e.id} AND version = ${data.version}`);
          tx.write(sql`UPDATE employee_roles SET active = 0 WHERE employee_id = ${e.id} AND ${tx.receipt}`);
          for (const role of selected) tx.insert(s.employeeRoles, { employeeId: e.id, roleId: role.id, active: true, updatedAt: tx.stamp }, sql`1 = 1`, { target: ["employeeId", "roleId"], update: ["active", "updatedAt"] });
        } else if (operation === "wage") {
          ctx.requirePermission("wages.manage"); ctx.requirePermission("team.manage"); v.keys(data, ["employeeId", "version", "roleId", "amountCents", "basis", "effectiveDate", "overtimeExempt"]);
          const role = job(data.roleId); if (!await db.get(sql`SELECT 1 FROM employee_roles WHERE employee_id = ${e.id} AND role_id = ${role.id} AND active = 1`)) throw new AuthError(400, "Assign the job before adding its wage.");
          const effectiveDate = v.date(data.effectiveDate); const basis = v.oneOf(data.basis, ["hourly", "annual_salary"]); const amountCents = v.integer(data.amountCents, 0, 1000000000); const overtimeExempt = v.boolean(data.overtimeExempt);
          if (basis === "hourly" && overtimeExempt) throw new AuthError(400, "The salary exemption option applies only to annual salary.");
          tx.insert(s.wageRates, { employeeId: e.id, roleId: role.id, amountCents, basis, effectiveDate, overtimeExempt, recordedByAccountId: ctx.account.id });
          tx.update(s.employees, { version: Number(data.version) + 1, updatedAt: tx.stamp }, sql`id = ${e.id} AND version = ${data.version}`);
        } else if (operation === "details") {
          ctx.requirePermission("team.manage"); v.keys(data, ["employeeId", "version", "startDate", "payrollId"]);
          if ("payrollId" in data) ctx.requirePermission("team.private.read");
          const startDate = v.date(data.startDate);
          if (await db.get(sql`SELECT 1 FROM employment_history WHERE employee_id = ${e.id} AND date < ${startDate} LIMIT 1`)) throw new AuthError(400, "Hire date cannot move after retained employment history.");
          tx.update(s.employees, { startDate, ...(data.payrollId === undefined ? {} : { payrollId: v.text(data.payrollId, 200) }), version: Number(data.version) + 1, updatedAt: tx.stamp }, sql`id = ${e.id} AND version = ${data.version}`);
        } else if (operation === "employment") {
          ctx.requirePermission("team.manage"); ctx.requirePermission("team.private.read"); v.keys(data, ["employeeId", "version", "action", "date", "reason", "eligibleForRehire"]);
          const action = v.oneOf(data.action, ["terminate", "rehire"]); const date = v.date(data.date);
          if (date > today || (e.startDate && date < e.startDate)) throw new AuthError(400, "Use a date between hire date and today.");
          const next = { ...e, active: action === "rehire", terminated: action === "terminate", employmentHistory: [...(e.employmentHistory ?? []), { type: action === "rehire" ? "rehired" as const : "terminated" as const, date, ...(action === "terminate" ? { reason: v.oneOf(data.reason, terminationReasons) } : {}) }],
            ...(action === "terminate" ? { terminationDate: date, terminationReason: v.oneOf(data.reason, terminationReasons), eligibleForRehire: v.boolean(data.eligibleForRehire) } : { terminationDate: "", terminationReason: "", terminationNote: "", eligibleForRehire: v.boolean(data.eligibleForRehire) }) };
          await employeeChange(r, { entity: "employee", id: e.id, before: e, after: next });
        }
      }
      if (!await tx.commit(view.revision, hash, [`team.${operation}`])) throw new AuthError(409, "Team or access changed. Reload before saving.");
      return json({ saved: true });
    } catch (error) { if (error instanceof AuthError) return json({ error: error.message }, error.status); console.error("Team request failed."); return json({ error: "Could not confirm the team change. Reload before saving again." }, 503); }
  }
  return { handle };
}
