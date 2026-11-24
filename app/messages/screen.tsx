"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { MessengerHistory, MessengerHit, MessengerInbox, MessengerMessage } from "../../messenger/model";
import { errorMessage, messageTime, messageTimestamp, messengerAction, messengerApi } from "./client";
import { Composer } from "./composer";
import { CreateThread } from "./create-thread";
import "./screen.css";

type Selection = { id: number; anchor?: number };
type HistoryState = { selection: Selection; data: MessengerHistory };

function MessageRow({ message, own, highlighted }: { message: MessengerMessage; own: boolean; highlighted: boolean }) {
  return <li className="messenger-message" data-own={own} data-highlighted={highlighted}>
    <header><strong>{message.sender}</strong><time dateTime={message.sentAt}>{messageTime(message.sentAt)}</time></header>
    <p>{message.body}</p>
    {message.mentions.length > 0 && <small>Mentioned {message.mentions.map(person => person.name).join(", ")}</small>}
    {message.attachments.length > 0 && <ul className="messenger-files" aria-label="Attachments">
      {message.attachments.map(file => <li key={file.id}>
        <a href={"/api/messenger/files/" + file.id} download={file.name}>{file.name}</a>
        <small>{file.size >= 1048576 ? (file.size / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(file.size / 1024)) + " KB"}</small>
      </li>)}
    </ul>}
  </li>;
}

export function TeamMessenger({ back, initial }: { back: string; initial?: number }) {
  const [data, setData] = useState<MessengerInbox>();
  const [selected, setSelected] = useState<Selection | undefined>(initial ? { id: initial } : undefined);
  const [history, setHistory] = useState<HistoryState>();
  const [creating, setCreating] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<MessengerHit[]>();
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const refreshId = useRef(0);
  const current = useRef<Selection | undefined>(selected);
  const read = useRef("");
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const invalidate = useCallback(() => { refreshId.current++; }, []);

  const reload = useCallback(async () => {
    const next = ++refreshId.current;
    const choice = current.current;
    try {
      const [view, messages] = await Promise.all([
        messengerApi<MessengerInbox>("inbox"),
        choice ? messengerApi<MessengerHistory>("history?conversation=" + choice.id + (choice.anchor ? "&anchor=" + choice.anchor : "")) : undefined,
      ]);
      if (next !== refreshId.current) return;
      setData(view);
      if (choice && messages) {
        setHistory(previous => {
          if (previous?.selection !== choice || !messages.messages.length) return { selection: choice, data: messages };
          const latest = new Set(messages.messages.map(message => message.id));
          const first = messageTimestamp(messages.messages[0].sentAt);
          const older = previous.data.messages.filter(message => !latest.has(message.id) && messageTimestamp(message.sentAt) <= first);
          return { selection: choice, data: { ...messages, messages: [...older, ...messages.messages],
            canLoadOlder: older.length ? previous.data.canLoadOlder : messages.canLoadOlder } };
        });
        const last = messages.messages.at(-1);
        const key = last ? choice.id + ":" + last.id : "";
        if (last && key !== read.current) {
          read.current = key;
          try {
            await messengerAction({ action: "read", conversationId: choice.id, through: last.id });
            const currentInbox = await messengerApi<MessengerInbox>("inbox");
            if (next === refreshId.current) setData(currentInbox);
          } catch (reason) {
            if (read.current === key) read.current = "";
            throw reason;
          }
        }
      }
    } catch (reason) {
      if (next === refreshId.current) { setHistory(undefined); setError(errorMessage(reason)); }
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void reload(), 0);
    const interval = window.setInterval(() => { if (!document.hidden) void reload(); }, 15_000);
    return () => { clearTimeout(initial); clearInterval(interval); invalidate(); };
  }, [invalidate, reload]);

  function open(id: number, anchor?: number) {
    const choice = { id, anchor };
    current.current = choice; read.current = "";
    setSelected(choice); setCreating(false); setHits(undefined); setError("");
    void reload();
    window.requestAnimationFrame(() => heading.current?.focus());
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (term.trim().length < 2 || searching) return;
    setSearching(true); setError("");
    try { setHits((await messengerApi<{ hits: MessengerHit[] }>("search?" + new URLSearchParams({ term: term.trim() }))).hits); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setSearching(false); }
  }
  const thread = data?.threads.find(row => row.id === selected?.id);
  const conversation = history?.selection === selected ? history?.data : undefined;
  const lastMessage = conversation?.messages.at(-1)?.id;
  useEffect(() => {
    if (lastMessage && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [lastMessage, selected]);

  async function older() {
    if (!selected || !conversation?.messages.length || pending) return;
    const choice = selected;
    setPending(true); setError("");
    try {
      const page = await messengerApi<MessengerHistory>("history?conversation=" + choice.id + "&before=" + conversation.messages[0].id);
      if (current.current === choice) setHistory(previous => {
        if (!previous || previous.selection !== choice) return previous;
        const seen = new Set(previous.data.messages.map(message => message.id));
        return { selection: choice, data: { ...page, messages: [...page.messages.filter(message => !seen.has(message.id)), ...previous.data.messages] } };
      });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setPending(false); }
  }

  async function changePreference(kind: "pinned" | "muted") {
    if (!thread || pending) return;
    setPending(true); setError("");
    try { await messengerAction({ action: "preferences", conversationId: thread.id, [kind]: !thread[kind] }); await reload(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setPending(false); }
  }

  return <main className="team-messenger">
    <header className="messenger-header">
      <div><a href={back}>{back === "/me" ? "← My profile" : "← Dashboard"}</a><h1>Team messenger</h1></div>
      <a href="/messages/channels">Company channels</a>
      {data && <button type="button" className="primary-action" onClick={() => { setCreating(true); setError(""); }}>New conversation</button>}
    </header>
    {error && <p className="messenger-error" role="alert">{error} <button type="button" onClick={() => { setError(""); void reload(); }}>Retry</button></p>}
    {!data && !error && <p role="status">Loading conversations…</p>}
    {data && <div className="messenger-layout">
      <aside className="messenger-sidebar" aria-label="Conversations">
        <form onSubmit={search} aria-label="Search messages">
          <label htmlFor="messenger-search">Search messages</label>
          <div className="messenger-actions"><input id="messenger-search" type="search" value={term} maxLength={100} onChange={event => setTerm(event.target.value)} />
            <button disabled={term.trim().length < 2 || searching}>{searching ? "Searching…" : "Search"}</button></div>
        </form>
        {hits ? <div aria-live="polite">
          <div className="messenger-result-title"><strong>Search results</strong><button type="button" onClick={() => { setHits(undefined); setTerm(""); }}>Clear</button></div>
          {!hits.length && <p>No messages match your search.</p>}
          <ul className="messenger-threads">{hits.map(hit => <li key={hit.id}>
            <button type="button" onClick={() => open(hit.conversationId, hit.id)}><strong>{hit.sender}</strong><span>{hit.body}</span><small>{messageTime(hit.sentAt)}</small></button>
          </li>)}</ul>
        </div> : <>
          {!data.threads.length && <p>No conversations yet.</p>}
          <ul className="messenger-threads">{data.threads.map(row => <li key={row.id}>
            <button type="button" aria-current={row.id === selected?.id ? "true" : undefined} onClick={() => open(row.id)}>
              <strong>{row.title}</strong><span>{[row.pinned && "Pinned", row.muted && "Muted", row.mentions ? row.mentions + " new " + (row.mentions === 1 ? "mention" : "mentions") : row.unread ? row.unread + " unread" : ""].filter(Boolean).join(" · ")}</span>
            </button>
          </li>)}</ul>
        </>}
      </aside>
      <section className="messenger-detail">
        {creating ? <CreateThread onCreated={open} onCancel={() => setCreating(false)} /> : selected ? <>
          <div className="messenger-thread-heading">
            <h2 tabIndex={-1} ref={heading}>{thread?.title ?? "Conversation"}</h2>
            {thread && <div className="messenger-actions">
              <button type="button" disabled={pending} onClick={() => void changePreference("pinned")}>{thread.pinned ? "Unpin" : "Pin"}</button>
              <button type="button" disabled={pending} onClick={() => void changePreference("muted")}>{thread.muted ? "Unmute" : "Mute"}</button>
            </div>}
          </div>
          {selected.anchor && <button type="button" onClick={() => open(selected.id)}>Go to latest messages</button>}
          {!conversation && !error && <p role="status">Loading messages…</p>}
          {conversation && <>
            {conversation.canLoadOlder && <button type="button" disabled={pending} onClick={() => void older()}>Load older messages</button>}
            {!conversation.messages.length && <p>No messages yet.</p>}
            <ol ref={list} className="messenger-history" aria-label="Conversation messages">
              {conversation.messages.map(message => <MessageRow key={message.id} message={message} own={message.senderId === data.employeeId} highlighted={message.id === selected.anchor} />)}
            </ol>
            <Composer key={selected.id} conversation={selected.id} members={conversation.members} employeeId={data.employeeId}
              onSent={() => { if (selected.anchor) open(selected.id); else void reload(); }} />
          </>}
        </> : <p>Select a conversation or start a new one.</p>}
      </section>
    </div>}
  </main>;
}
