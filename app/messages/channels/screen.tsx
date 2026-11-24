"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { channelTitles } from "../../../messenger/channel-model";
import type { Channel, ChannelFeed } from "../../../messenger/channel-model";
import { errorMessage, messengerApi, messageTimestamp } from "../client";
import { ChannelComposer } from "./composer";
import { ChannelPostCard } from "./post";
import "./styles.css";

export function ChannelScreen({ manager, initial, anchor }: { manager: boolean; initial: Channel; anchor?: number }) {
  const [selection, setSelection] = useState({ channel: initial, anchor });
  const [feed, setFeed] = useState<ChannelFeed>();
  const [error, setError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const request = useRef<AbortController | null>(null);
  const nav = useRef(selection);
  const target = useRef<HTMLLIElement>(null);
  const last = useRef(0);
  const read = useCallback((clear = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const { channel, anchor: post } = nav.current;
    const args = new URLSearchParams({ channel, ...(post ? { anchor: String(post) } : {}) });
    void messengerApi<ChannelFeed>("channels/feed?" + args, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setError("");
      setFeed(previous => {
        if (clear || !previous || previous.channel !== data.channel || !data.posts.length) return data;
        const ids = new Set(data.posts.map(item => item.id));
        const first = data.posts[0];
        const time = messageTimestamp(first.createdAt);
        const older = previous.posts.filter(item => !ids.has(item.id) &&
          (messageTimestamp(item.createdAt) < time || item.createdAt === first.createdAt && item.id < first.id));
        return { ...data, posts: [...older, ...data.posts], canLoadOlder: older.length ? previous.canLoadOlder : data.canLoadOlder };
      });
    }).catch(reason => {
      if (!controller.signal.aborted) { setFeed(undefined); setError(errorMessage(reason)); }
    });
  }, []);
  useEffect(() => {
    const start = window.setTimeout(() => read(), 0);
    const tick = window.setInterval(() => { if (!document.hidden) read(); }, 15_000);
    return () => { clearTimeout(start); clearInterval(tick); request.current?.abort(); };
  }, [read]);
  const visible = feed?.channel === selection.channel ? feed : undefined;
  const focused = selection.anchor && visible?.posts.some(post => post.id === selection.anchor) ? selection.anchor : 0;
  useEffect(() => {
    if (focused && focused !== last.current && target.current) {
      last.current = focused;
      target.current.scrollIntoView({ block: "nearest" });
      target.current.focus({ preventScroll: true });
    }
  }, [focused]);

  function choose(channel: Channel) {
    const next = { channel, anchor: undefined };
    nav.current = next; last.current = 0;
    setSelection(next); setFeed(undefined); setError("");
    read(true);
  }
  async function older() {
    if (loadingOlder || !visible?.posts.length) return;
    const current = nav.current;
    setLoadingOlder(true);
    try {
      const data = await messengerApi<ChannelFeed>("channels/feed?channel=" + current.channel + "&before=" + visible.posts[0].id);
      if (nav.current !== current) return;
      setFeed(existing => {
        if (!existing) return existing;
        const ids = new Set(existing.posts.map(post => post.id));
        return { ...existing, canLoadOlder: data.canLoadOlder, posts: [...data.posts.filter(post => !ids.has(post.id)), ...existing.posts] };
      });
    } catch (reason) { if (nav.current === current) setError(errorMessage(reason)); }
    finally { setLoadingOlder(false); }
  }
  return <main className="channel-page">
    <header className="channel-page-heading"><div><a href="/messages">← Team messenger</a><h1>Company channels</h1></div></header>
    <nav className="channel-navigation" aria-label="Company channels">
      {(manager ? (["company", "managers"] as const) : (["company"] as const)).map(channel =>
        <button type="button" key={channel} aria-current={selection.channel === channel ? "page" : undefined}
          onClick={() => choose(channel)}>{channelTitles[channel]}</button>)}
    </nav>
    <section className="channel-section" aria-label={channelTitles[selection.channel] + " channel"}>
      <h2>{channelTitles[selection.channel]} channel</h2>
      {error && <p role="alert">{error} <button type="button" onClick={() => read(true)}>Retry</button></p>}
      {!visible && !error && <p role="status">Loading channel…</p>}
      {visible && <>
        {selection.anchor && <button type="button" onClick={() => choose(selection.channel)}>Go to latest posts</button>}
        {visible.canLoadOlder && <button type="button" disabled={loadingOlder} onClick={() => void older()}>Load older posts</button>}
        {!visible.posts.length && <p>No posts yet.</p>}
        <ol className="channel-posts" aria-label="Channel posts">{visible.posts.map(post => <li key={post.id}
          ref={post.id === focused ? target : undefined} tabIndex={post.id === focused ? -1 : undefined}>
          <ChannelPostCard post={post} highlighted={post.id === focused} onChange={() => read()} />
        </li>)}</ol>
        <ChannelComposer key={selection.channel} channel={visible.channel} canPublish={visible.canPublish} emailAvailable={visible.emailAvailable}
          onSent={() => selection.anchor ? choose(selection.channel) : read()} />
      </>}
    </section>
  </main>;
}
