"use client";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { messengerFileLimit, messengerFilesPerMessage, messengerFileTypes } from "../../messenger/model";
import type { Attachment, Person } from "../../messenger/model";
import { errorMessage, messengerAction, messengerApi, requestId } from "./client";

type Selected = { id: string; file: File };
const trailingMention = /(?:^|\s)@([^\s@]*)$/;

export function Composer({ conversation, members, employeeId, onSent }: {
  conversation: number; members: Person[]; employeeId: number; onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<Person[]>([]);
  const [files, setFiles] = useState<Selected[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [picker, setPicker] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const candidates = members.filter(person => person.id !== employeeId);
  const match = trailingMention.exec(text);
  const suggestions = match && suggestionsOpen
    ? candidates.filter(person => person.name.toLocaleLowerCase().includes(match[1].toLocaleLowerCase())).slice(0, 8) : [];

  function addMention(person: Person, replaceTrailing = false) {
    setText(current => {
      const prefix = replaceTrailing ? current.slice(0, -(match?.[1].length ?? 0) - 1) : current + (current && !/\s$/.test(current) ? " " : "");
      return prefix + "@" + person.name + " ";
    });
    setMentions(items => items.some(item => item.id === person.id) ? items : [...items, person]);
    setPicker(false);
    setSuggestionsOpen(false);
    textarea.current?.focus();
  }

  function chooseFiles(chosen: FileList | null) {
    const selected = Array.from(chosen ?? []);
    if (!selected.length) return;
    if (files.length + selected.length > messengerFilesPerMessage) {
      setError("Choose up to four attachments per message.");
      return;
    }
    if (selected.some(file => !file.size || file.size > messengerFileLimit || !messengerFileTypes.split(",").includes(file.type))) {
      setError("Choose a nonempty PDF, PNG, JPEG, GIF or MP4 up to 10 MB.");
      return;
    }
    setFiles(items => [...items, ...selected.map(file => ({ file, id: requestId() }))]);
    setError("");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending.current || (!text.trim() && !files.length)) return;
    sending.current = true;
    setPending(true); setError("");
    const fields = { action: "send", conversationId: conversation, body: text.trim(),
      mentions: mentions.filter(person => text.includes("@" + person.name)).map(person => person.id), attachments: files.map(file => file.id) };
    const payload = JSON.stringify(fields);
    if (retry.current?.payload !== payload) retry.current = { payload, id: requestId() };
    try {
      await Promise.all(files.map(({ id, file }) => messengerApi<Attachment>("files?conversation=" + conversation, {
        method: "POST", body: file, headers: {
          "Content-Type": file.type, "x-file-name": encodeURIComponent(file.name), "x-upload-id": id,
        },
      })));
      await messengerAction({ ...fields, id: retry.current.id });
      setText(""); setMentions([]); setFiles([]); setPicker(false); retry.current = null; onSent();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { sending.current = false; setPending(false); }
  }

  return <form className="messenger-composer" onSubmit={send} aria-label="Send a message">
    <label htmlFor="messenger-message">Message</label>
    <textarea id="messenger-message" ref={textarea} value={text} maxLength={4000} rows={3} disabled={pending}
      onChange={event => { setText(event.target.value); setSuggestionsOpen(true); }}
      onKeyDown={event => { if (event.key === "Escape") { setSuggestionsOpen(false); setPicker(false); } }} />
    {suggestions.length > 0 && <ul className="messenger-people" aria-label="Mention suggestions">
      {suggestions.map(person => <li key={person.id}><button type="button" onClick={() => addMention(person, true)}>{person.name}</button></li>)}
    </ul>}
    <div className="messenger-compose-tools">
      <label className="messenger-file-input">Attach files
        <input type="file" aria-label="Attach files" multiple accept={messengerFileTypes} disabled={pending}
          onChange={event => { chooseFiles(event.target.files); event.target.value = ""; }} />
      </label>
      <button type="button" disabled={!candidates.length || pending} aria-expanded={picker} onClick={() => setPicker(value => !value)}>Mention teammate</button>
    </div>
    {picker && <label>Choose a teammate
      <select aria-label="Choose a teammate to mention" value="" onChange={event => {
        const person = candidates.find(item => item.id === Number(event.target.value));
        if (person) addMention(person);
      }}>
        <option value="">Select teammate</option>
        {candidates.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>
    </label>}
    {files.length > 0 && <ul className="messenger-files">
      {files.map(({ id, file }) => <li key={id}><span>{file.name}</span>
        <button type="button" aria-label={"Remove " + file.name} disabled={pending} onClick={() => setFiles(items => items.filter(item => item.id !== id))}>Remove</button>
      </li>)}
    </ul>}
    {error && <p role="alert">{error}</p>}
    <button type="submit" className="primary-action" disabled={pending || (!text.trim() && !files.length)}>{pending ? "Sending…" : "Send"}</button>
  </form>;
}
