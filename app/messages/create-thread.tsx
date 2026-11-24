"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { MessengerRoster } from "../../messenger/model";
import { errorMessage, messengerAction, messengerApi, requestId } from "./client";

export function CreateThread({ onCreated, onCancel }: { onCreated: (id: number) => void; onCancel: () => void }) {
  const [roster, setRoster] = useState<MessengerRoster>();
  const [source, setSource] = useState<"people" | "department" | "schedule">("people");
  const [people, setPeople] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [date, setDate] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const retry = useRef<{ fields: string; id: string; conversationId: number } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void messengerApi<MessengerRoster>("roster", { signal: abort.signal }).then(setRoster).catch(reason => {
      if (!abort.signal.aborted) setError(errorMessage(reason));
    });
    return () => abort.abort();
  }, []);
  const valid = source === "people" ? people.length > 0 : source === "department" ? !!department : !!date;
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;
    setPending(true); setError("");
    const body = { action: "create", name, source, ...(source === "people" ? { people } : source === "department" ? { departmentId: Number(department) } : { date }) };
    const fields = JSON.stringify(body);
    if (retry.current?.fields !== fields) retry.current = { fields, id: requestId(),
      conversationId: Number.parseInt(crypto.randomUUID().replaceAll("-", "").slice(0, 12), 16) || 1 };
    try {
      const result = await messengerAction<{ id: number }>({ ...body, id: retry.current.id, conversationId: retry.current.conversationId });
      onCreated(result.id);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setPending(false); }
  }

  return <form className="messenger-create" onSubmit={create}>
    <h2>New conversation</h2>
    {error && <p role="alert">{error}</p>}
    {!roster && !error && <p role="status">Loading team members…</p>}
    {roster && <fieldset disabled={pending}>
      <legend>Group members</legend>
      <label>Choose by
        <select aria-label="Choose by" value={source} onChange={event => setSource(event.target.value as typeof source)}>
          <option value="people">Team members</option>
          {roster.departments.length > 0 && <option value="department">Department</option>}
          {roster.canGroupBySchedule && <option value="schedule">Published schedule</option>}
        </select>
      </label>
      {source === "people" && <>
        <label>Filter team members <input type="search" value={filter} onChange={event => setFilter(event.target.value)} /></label>
        <div className="messenger-roster">
          {roster.people.filter(person => person.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(person =>
            <label key={person.id}><input type="checkbox" checked={people.includes(person.id)}
              onChange={event => setPeople(items => event.target.checked ? [...items, person.id] : items.filter(id => id !== person.id))} /> {person.name}</label>)}
          {!roster.people.length && <p>No team members are available.</p>}
        </div>
      </>}
      {source === "department" && <label>Department
        <select aria-label="Department" value={department} onChange={event => setDepartment(event.target.value)}>
          <option value="">Select department</option>
          {roster.departments.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>}
      {source === "schedule" && <label>Published shift date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>}
      <label>Conversation name <input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
    </fieldset>}
    <div className="messenger-actions">
      <button type="submit" className="primary-action" disabled={!roster || !valid || pending}>{pending ? "Creating…" : "Start chat"}</button>
      <button type="button" disabled={pending} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
