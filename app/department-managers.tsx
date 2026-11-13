"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { accessRequest } from "./account-access-client";
import type { Account } from "./account-access-client";
import { changeManagerDepartment } from "./department-manager-actions";
import type { WorkspaceData } from "../workforce/contract";

type Assignment = { accountId: number; departmentId: number };
export function useDepartmentManagers(enabled: boolean) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const saving = useRef(false), mounted = useRef(false), controller = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    if (saving.current) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    try {
      const data = await accessRequest<{ accounts: Account[]; departmentAssignments: Assignment[] }>("accounts", abort.signal);
      if (abort.signal.aborted || !mounted.current) return;
      setAccounts(data.accounts.filter(a => a.accessLevel === "manager")); setAssignments(data.departmentAssignments); setError("");
    } catch (e) { if (mounted.current && !abort.signal.aborted) setError(e instanceof Error ? e.message : "Could not load manager assignments."); }
    finally { if (mounted.current && !abort.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    async function initialize() { await reload(); }
    void initialize(); const focus = () => { void reload(); };
    window.addEventListener("focus", focus);
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener("focus", focus); };
  }, [enabled, reload]);
  async function change(accountId: number, departmentId: number, assigned: boolean) {
    if (!enabled || saving.current || error || loading) return;
    const account = accounts.find(a => a.id === accountId); if (!account) return;
    saving.current = true; controller.current?.abort(); setBusy(true); setMessage("");
    try {
      const updated = await changeManagerDepartment(account, departmentId, assigned);
      if (!mounted.current) return;
      setAccounts(values => values.map(a => a.id === accountId ? updated.account : a));
      setAssignments(values => [...values.filter(a => a.accountId !== accountId), ...updated.departmentIds.map(id => ({ accountId, departmentId: id }))]);
      setMessage("Manager assignments saved. This account must sign in again.");
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Could not confirm this change. Reload before trying again."); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  return { accounts, assignments, enabled, loading, busy, error, message, reload, change };
}
type Control = ReturnType<typeof useDepartmentManagers>;
export function DepartmentManagerFeedback({ control }: { control: Control }) {
  return <>
    <p>Manager assignments use the same dashboard accounts as <a href="/access">Account access</a>. General Managers have company-wide access.</p>
    {!control.enabled ? <p>Only an Owner can change manager assignments.</p> : <>
      {control.loading ? <p role="status">Loading manager accounts…</p> : null}
      {control.error ? <div><p role="alert">{control.error}</p><button type="button" disabled={control.busy} onClick={() => void control.reload()}>Reload manager assignments</button></div> : null}
      {control.message ? <p role="status">{control.message}</p> : null}
    </>}
  </>;
}
export function DepartmentManagerCell({ departmentId, name, control, saved = [] }: { departmentId: number; name: string; control: Control; saved?: WorkspaceData["departmentManagers"] }) {
  const assigned = control.enabled
    ? control.accounts.filter(a => control.assignments.some(link => link.departmentId === departmentId && link.accountId === a.id)).map(a => ({ accountId: a.id, name: a.displayName, disabled: Boolean(a.disabledAt), setupPending: !a.loginEnabled }))
    : saved.filter(a => a.departmentId === departmentId);
  const available = control.accounts.filter(a => !a.disabledAt && !assigned.some(link => link.accountId === a.id));
  const disabled = control.busy || control.loading || Boolean(control.error);
  const label = (a: { name: string; disabled: boolean; setupPending: boolean }) => `${a.name}${a.disabled ? " · Disabled" : a.setupPending ? " · Password setup pending" : ""}`;
  return <div className="department-manager-list" role="cell" aria-busy={control.enabled && (control.busy || control.loading)}>
    <small className="department-cell-label">Department managers</small>
    {assigned.map(a => <span key={a.accountId}>{label(a)}{control.enabled ? <button type="button" disabled={disabled} aria-label={`Remove ${a.name} from ${name}`} onClick={() => void control.change(a.accountId, departmentId, false)}>×</button> : null}</span>)}
    {!assigned.length && !(control.enabled && control.loading) ? <small>No department managers assigned.</small> : null}
    {control.enabled && available.length ? <details className={`department-manager-picker${assigned.length ? " has-selection" : ""}`}>
      <summary aria-label={`Select manager for ${name}`}>{assigned.length ? null : "Select manager"}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></summary>
      <div className="department-manager-menu" aria-label={`Available managers for ${name}`}>{available.map(a => <button type="button" key={a.id} disabled={disabled} onClick={event => { void control.change(a.id, departmentId, true); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{label({ name: a.displayName, disabled: Boolean(a.disabledAt), setupPending: !a.loginEnabled })}</button>)}</div>
    </details> : null}
  </div>;
}
