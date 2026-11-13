"use client";

import { useEffect, useState } from "react";
import { permissionCatalog } from "../access/policy";
import type { PermissionMap } from "../access/policy";
import { accessRequest as request, roleName } from "./account-access-client";
import type { Account, Access, Department, EmployeeLink } from "./account-access-client";
import { AccountLifecycleForm } from "./account-lifecycle-form";
import { AccountSetupLink } from "./account-setup-link";

type Mine = { permissions: PermissionMap; canManageAccess: boolean; allDepartments: boolean };

export function TeamPermissionsPanel() {
  const [mine, setMine] = useState<Mine | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<EmployeeLink[]>([]);
  const [creating, setCreating] = useState(false);
  const [showDisabled, setShowDisabled] = useState(false);
  const [selectedId, setSelectedId] = useState(0);
  const [draft, setDraft] = useState<Access | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      const current = await request<Mine>("me", controller.signal);
      if (controller.signal.aborted) return;
      setMine(current);
      if (current.canManageAccess) {
        const result = await request<{ accounts: Account[]; departments: Department[]; employees: EmployeeLink[] }>("accounts", controller.signal);
        if (controller.signal.aborted) return;
        setAccounts(result.accounts);
        setDepartments(result.departments);
        setEmployees(result.employees);
        const visible = result.accounts.filter(account => showDisabled || !account.disabledAt);
        setSelectedId(id => visible.some(account => account.id === id) ? id : (visible.find(account => account.accessLevel === "manager")?.id ?? visible[0]?.id ?? 0));
      }
      setLoading(false);
    }
    void load().catch(() => {
      if (controller.signal.aborted) return;
      setError("Could not load access settings. Check your connection and try again.");
      setLoading(false);
    });
    return () => controller.abort();
  }, [reload, showDisabled]);

  useEffect(() => {
    if (!selectedId || !mine?.canManageAccess) return;
    const controller = new AbortController();
    async function load() {
      setDraft(null);
      setError("");
      const result = await request<Access>(`accounts/${selectedId}`, controller.signal);
      if (!controller.signal.aborted) setDraft(result);
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setError("Could not load this account. Reload and try again.");
    });
    return () => controller.abort();
  }, [selectedId, mine?.canManageAccess, reload]);

  const visibleAccounts = accounts.filter(account => showDisabled || !account.disabledAt);
  const editable = Boolean(!loading && mine?.canManageAccess && draft && ["manager", "general_manager"].includes(draft.account.accessLevel) && draft.account.id === selectedId);
  const shownPermissions = mine?.canManageAccess ? draft?.permissions : mine?.permissions;

  function accountSaved(updated: Access) {
    setAccounts(current => current.some(a => a.id === updated.account.id) ? current.map(a => a.id === updated.account.id ? updated.account : a) : [...current, updated.account]);
    if (updated.account.disabledAt) setShowDisabled(true);
    setDraft(updated); setSelectedId(updated.account.id); setCreating(false); setError("");
    setMessage("Account saved. Existing sign-ins have ended. Review permissions below before handing over access.");
  }

  async function save() {
    if (!editable || !draft || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await request<Access>(`accounts/${draft.account.id}`, undefined, {
        version: draft.account.version, permissions: draft.permissions, departmentIds: draft.departmentIds,
      });
      accountSaved(updated);
      setMessage(updated.account.loginEnabled ? "Access saved. This person will need to sign in again." : "Access saved. This person will need a new password setup link.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save access. Try again.");
    } finally { setSaving(false); }
  }

  return <section className="panel settings-enforcement-panel settings-team-permissions-panel" aria-labelledby="permissions-heading" aria-busy={loading || saving}>
    <div className="settings-panel-heading">
      <h3 id="permissions-heading">Team permissions</h3>
      {mine?.canManageAccess ? <button type="button" onClick={save} disabled={!editable || saving || creating}>{saving ? "Saving…" : "Save permissions"}</button> : null}
    </div>
    <p className="team-permissions-intro">Owners control account access. Managers see their assigned departments; Owners and General Managers can work across departments.</p>
    {loading ? <p role="status">Loading access settings…</p> : null}
    {error ? <div className="permissions-feedback"><p role="alert">{error}</p><button type="button" onClick={() => setReload(value => value + 1)} disabled={saving}>Reload access settings</button></div> : null}
    {message ? <p role="status">{message}</p> : null}
    {!loading && mine?.canManageAccess ? <>
      <button type="button" disabled={saving} onClick={() => { setCreating(value => !value); setMessage(""); }}>{creating ? "Close new account form" : "Add account"}</button>
      {creating ? <AccountLifecycleForm departments={departments} employees={employees.filter(e => !accounts.some(a => a.employeeId === e.id))} busy={saving} onBusy={setSaving} onSaved={accountSaved} onCancel={() => setCreating(false)} /> : null}
      <label className="retired-records-toggle"><input type="checkbox" checked={showDisabled} disabled={saving || creating} onChange={event => setShowDisabled(event.target.checked)} />Show disabled accounts</label>
      <label className="permissions-account" htmlFor="permissions-account">Account
        <select id="permissions-account" value={selectedId} disabled={saving || creating || !visibleAccounts.length} onChange={event => { setDraft(null); setMessage(""); setSelectedId(Number(event.target.value)); }}>
          {visibleAccounts.map(account => <option key={account.id} value={account.id}>{account.displayName} — {roleName(account.accessLevel)} ({account.email})</option>)}
        </select>
      </label>
      {!visibleAccounts.length ? <p>No active accounts are available. Show disabled accounts to review past access.</p> : null}
      {draft && !creating ? <>
        <p>{roleName(draft.account.accessLevel)}{draft.account.disabledAt ? " · Account disabled" : !draft.account.loginEnabled ? " · Password setup pending" : ""}</p>
        {draft.account.accessLevel === "owner" ? <p>Owners retain full account control. Their access cannot be reduced here.</p> : null}
        {draft.account.accessLevel === "employee" ? <p>Employee clock access is managed separately from dashboard accounts.</p> : null}
        {draft.account.accessLevel === "general_manager" ? <button type="button" disabled={saving} onClick={() => setDraft(current => current ? { ...current, permissions: Object.fromEntries(permissionCatalog.map(permission => [permission.id, ["timesheets.read", "wages.read", "exports.timesheets"].includes(permission.id)])) as PermissionMap, departmentIds: [] } : current)}>Apply limited timesheet / wage administrator permissions</button> : null}
        {draft.account.accessLevel !== "owner" ? <>
          <AccountLifecycleForm key={`${draft.account.id}:${draft.account.version}`} access={draft} departments={departments} employees={employees.filter(e => e.id === draft.account.employeeId || !accounts.some(a => a.employeeId === e.id))} busy={saving} onBusy={setSaving} onSaved={accountSaved} />
          <AccountSetupLink key={draft.account.id} account={draft.account} busy={saving} onBusy={setSaving} onSaved={accountSaved} />
        </> : null}
      </> : selectedId && !creating ? <p role="status">Loading this account…</p> : null}
    </> : !loading && mine ? <p>Your permissions are shown below. Ask an Owner to change your access.</p> : null}
    {shownPermissions && !creating ? <div className="permissions-table-scroll"><table className="team-permissions-table">
      <thead><tr><th scope="col">Permission</th><th scope="col">Allowed</th></tr></thead>
      <tbody>{permissionCatalog.map(permission => <tr key={permission.id}>
        <th scope="row" id={`permission-${permission.id}`}>{permission.label}</th>
        <td><input type="checkbox" checked={shownPermissions[permission.id]} disabled={!editable || saving} aria-labelledby={`permission-${permission.id}`} onChange={event => {
          const checked = event.target.checked;
          setDraft(current => current ? { ...current, permissions: { ...current.permissions, [permission.id]: checked } } : current);
        }} /></td>
      </tr>)}</tbody>
    </table></div> : null}
    <p className="permissions-footnote">Access changes end this person’s existing sign-ins. Conversation access also requires membership.</p>
  </section>;
}
