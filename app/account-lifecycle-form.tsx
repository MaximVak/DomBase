"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import { accessRequest, roleName } from "./account-access-client";
import type { Access, Department, EmployeeLink } from "./account-access-client";

type Props = { access?: Access; departments: Department[]; employees: EmployeeLink[]; busy: boolean;
  onBusy: (busy: boolean) => void; onSaved: (access: Access) => void; onCancel?: () => void };
export function AccountLifecycleForm({ access, departments, employees, busy, onBusy, onSaved, onCancel }: Props) {
  const account = access?.account;
  const [email, setEmail] = useState(account?.email ?? "");
  const [name, setName] = useState(account?.displayName ?? "");
  const [level, setLevel] = useState(account?.accessLevel ?? "manager");
  const [employeeId, setEmployeeId] = useState(account?.employeeId ?? null);
  const [disabled, setDisabled] = useState(Boolean(account?.disabledAt));
  const [departmentIds, setDepartmentIds] = useState(access?.departmentIds ?? []);
  const [error, setError] = useState("");
  const prefix = account ? `account-edit-${account.id}` : "account-create";
  const linkedEmployee = employees.find(e => e.id === employeeId);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; onBusy(true); setError("");
    try {
      const body = { email, displayName: name, accessLevel: level, employeeId, departmentIds: level === "manager" ? departmentIds : [],
        ...(account ? { version: account.version, disabled } : {}) };
      onSaved(await accessRequest<Access>(account ? `accounts/${account.id}/lifecycle` : "accounts", undefined, body));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not confirm the change. Reload accounts before retrying."); }
    finally { onBusy(false); }
  }
  return <form className="account-lifecycle" onSubmit={submit} aria-label={account ? "Edit account" : "Create account"}>
    <h4>{account ? "Account details" : "Create account"}</h4>
    <fieldset disabled={busy}>
      <legend className="sr-only">Identity and access</legend>
      <div className="account-fields">
        <label htmlFor={`${prefix}-name`}>Name<input id={`${prefix}-name`} value={name} onChange={e => setName(e.target.value)} maxLength={100} required autoComplete="off" /></label>
        <label htmlFor={`${prefix}-email`}>Sign-in email<input id={`${prefix}-email`} type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required autoComplete="off" /></label>
        <label htmlFor={`${prefix}-employee`}>Linked employee<select id={`${prefix}-employee`} value={employeeId ?? ""} disabled={account?.employeeId != null} onChange={e => setEmployeeId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">No employee link</option>
          {employeeId !== null && !linkedEmployee ? <option value={employeeId}>Current employee (inactive or unavailable)</option> : null}
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select></label>
        <label htmlFor={`${prefix}-level`}>Access level<select id={`${prefix}-level`} value={level} onChange={e => setLevel(e.target.value as typeof level)}>
          {(["manager", "general_manager", "employee"] as const).map(value => <option key={value} value={value}>{roleName(value)}</option>)}
        </select></label>
      </div>
      <p>Job roles and wages are managed in Team. An employee link identifies this account’s person and cannot be reassigned once saved.</p>
      {level === "general_manager" ? <p>General Managers have company-wide access and do not need department assignments.</p> : null}
      {level === "employee" ? <p>Link an active employee to enable password access to their own profile. Tablet PIN access is separate.</p> : null}
      {level === "manager" ? <div className="account-departments"><strong>Assigned departments</strong>
        <p>A manager with no assigned departments cannot access team records.</p>
        {departments.length ? departments.map(department => <label key={department.id}><input type="checkbox" checked={departmentIds.includes(department.id)} onChange={e => {
          const checked = e.target.checked; setDepartmentIds(ids => checked ? [...ids, department.id] : ids.filter(id => id !== department.id));
        }} />{department.name}</label>) : <p>Create a department in Team before assigning it.</p>}
      </div> : null}
      {account ? <label className="account-disable"><input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} />Disable account access</label> : null}
      {account ? <p>Saving ends existing sign-ins and invalidates setup links and manager approval PINs. Changing access level resets custom permissions to the new level’s defaults.</p> : <p>The account starts without a password. After creating an account, generate a private setup link so the person can choose their own password.</p>}
      <div className="account-actions">{onCancel ? <button type="button" onClick={onCancel}>Cancel</button> : null}<button type="submit">{busy ? "Saving…" : account ? "Save account details" : "Create account"}</button></div>
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}
