"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelPost } from "../../../messenger/channel-model";
import { messengerApi } from "../client";
import { ChannelPostCard } from "./post";
import "./styles.css";

export function PinnedAnnouncements() {
  const [posts, setPosts] = useState<ChannelPost[]>([]);
  const request = useRef<AbortController | null>(null);
  const reload = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    void messengerApi<{ posts: ChannelPost[] }>("channels/home", { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setPosts(result.posts);
    }).catch(() => { if (!controller.signal.aborted) setPosts([]); });
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    return () => { request.current?.abort(); window.removeEventListener("focus", reload); };
  }, [reload]);
  if (!posts.length) return null;
  return <section className="panel pinned-announcements" aria-label="Pinned announcements">
    <header className="channel-page-heading"><h2>Pinned announcements</h2><a href="/messages/channels">Company channels</a></header>
    <div className="channel-posts">{posts.map(post => <ChannelPostCard key={post.id} post={post} home onChange={reload} />)}</div>
  </section>;
}
