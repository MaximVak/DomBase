"use client";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Channel } from "../../../messenger/channel-model";
import { errorMessage, requestId } from "../client";
import { channelAction } from "./client";

export function ChannelComposer({ channel, canPublish, emailAvailable, onSent }: {
  channel: Channel; canPublish: boolean; emailAvailable: boolean; onSent: () => void;
}) {
  const [announcement, setAnnouncement] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(true);
  const [email, setEmail] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const receipt = useRef<{ key: string; id: string } | null>(null);
  const valid = !!body.trim() && (!announcement || !!title.trim());
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!valid || lock.current) return;
    lock.current = true; setPending(true); setError("");
    const message = { action: announcement ? "announce" : "post", channel, body: body.trim(),
      ...(announcement ? { title: title.trim(), pin: pinned, email: email && emailAvailable } : {}) };
    const key = JSON.stringify(message);
    if (receipt.current?.key !== key) receipt.current = { key, id: requestId() };
    try {
      await channelAction({ ...message, id: receipt.current.id });
      receipt.current = null; setTitle(""); setBody(""); setEmail(false); onSent();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { lock.current = false; setPending(false); }
  }

  return <form className="channel-composer" aria-label="Write a channel post" onSubmit={send}>
    <fieldset disabled={pending}>
      <legend>Write a post</legend>
      {canPublish && <label htmlFor="channel-post-kind">Post type</label>}
      {canPublish && <select id="channel-post-kind" value={announcement ? "announce" : "post"} onChange={event => setAnnouncement(event.target.value === "announce")}>
        <option value="post">Message</option><option value="announce">Announcement</option>
      </select>}
      {announcement && <><label htmlFor="channel-title">Announcement title</label>
        <input id="channel-title" value={title} maxLength={120} onChange={event => setTitle(event.target.value)} required />
      </>}
      <label htmlFor="channel-message">Message</label>
      <textarea id="channel-message" value={body} onChange={event => setBody(event.target.value)} maxLength={4000} rows={4} required />
      {announcement && <div className="channel-options">
        <label><input type="checkbox" checked={pinned} onChange={event => setPinned(event.target.checked)} /> Pin on Home</label>
        <label><input type="checkbox" checked={email && emailAvailable} disabled={!emailAvailable} onChange={event => setEmail(event.target.checked)} /> Email a copy to people who opted in</label>
        {!emailAvailable && <small>Announcement email delivery is pending setup.</small>}
      </div>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="primary-action" disabled={!valid}>{pending ? "Posting…" : announcement ? "Publish announcement" : "Post message"}</button>
    </fieldset>
  </form>;
}
