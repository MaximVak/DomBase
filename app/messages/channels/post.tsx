"use client";
import { useRef, useState } from "react";
import { channelTitles } from "../../../messenger/channel-model";
import type { AnnouncementReceipts, ChannelPost } from "../../../messenger/channel-model";
import { errorMessage, messageTime, messengerApi } from "../client";
import { channelAction } from "./client";

export function ChannelPostCard({ post, home = false, highlighted = false, onChange }: {
  post: ChannelPost; home?: boolean; highlighted?: boolean; onChange: () => void;
}) {
  const [receipts, setReceipts] = useState<AnnouncementReceipts>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  async function update(action: "read" | "pin" | "receipts") {
    if (lock.current) return;
    if (action === "receipts" && receipts) { setReceipts(undefined); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      if (action === "receipts") setReceipts(await messengerApi<AnnouncementReceipts>("channels/receipts?post=" + post.id));
      else {
        await channelAction({ action, postId: post.id, ...(action === "pin" ? { pinned: !post.pinnedAt } : {}) });
        onChange();
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { lock.current = false; setBusy(false); }
  }

  return <article className="channel-post" data-highlighted={highlighted} aria-label={post.title ?? "Channel message"}>
    <header className="channel-post-header">
      {post.title ? <h3>{post.title}</h3> : <strong>{post.author}</strong>}
      <time dateTime={post.createdAt}>{messageTime(post.createdAt)}</time>
    </header>
    {post.title && <p className="channel-meta">{post.author} · {channelTitles[post.channel]}{post.pinnedAt && !home ? " · Pinned on Home" : ""}</p>}
    <p className="channel-body">{post.body}</p>
    {post.title && <div className="channel-post-actions">
      {post.readAt ? <span>Read confirmed</span> : <button type="button" disabled={busy} onClick={() => void update("read")}>Confirm read</button>}
      {home && <a href={"/messages/channels?channel=" + post.channel + "&post=" + post.id}>View in channel</a>}
      {!home && post.canManage && <>
        <button type="button" disabled={busy} onClick={() => void update("pin")}>{post.pinnedAt ? "Unpin from Home" : "Pin on Home"}</button>
        <button type="button" disabled={busy} aria-expanded={!!receipts} onClick={() => void update("receipts")}>
          {receipts ? "Hide read confirmations" : "View read confirmations"}
        </button>
      </>}
    </div>}
    {receipts && <section className="channel-receipts" aria-label="Read confirmations">
      <strong>{receipts.read} of {receipts.total} confirmed</strong>
      <ul>{receipts.people.map(person => <li key={person.accountId}>
        <span>{person.name}</span><span>{person.readAt ? messageTime(person.readAt) : "Awaiting confirmation"}</span>
      </li>)}</ul>
    </section>}
    {error && <p role="alert">{error}</p>}
  </article>;
}
