const cacheName = "dombase-kiosk-shell-v1";
const shell = "/kiosk";
const allowedAsset = (url) => url.origin === self.location.origin && !url.search &&
  /^\/(?:_next\/static|assets)\/[A-Za-z0-9_./-]+\.(?:js|css)$/.test(url.pathname);

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("message", event => {
  if (event.data?.type !== "prepare-kiosk" || !event.source?.url ||
    new URL(event.source.url).pathname !== shell || !event.ports[0]) return;
  event.waitUntil((async () => {
    const reply = event.ports[0];
    try {
      const page = await fetch(shell, { credentials: "omit", cache: "no-store", redirect: "error" });
      if (!page.ok || !page.headers.get("content-type")?.includes("text/html")) throw new Error();
      const html = await page.clone().text();
      const references = Array.from(html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g), item => item[1]);
      const supplied = Array.isArray(event.data.assets) ? event.data.assets.slice(0, 128) : [];
      const urls = [...new Set([...references, ...supplied].filter(value => typeof value === "string")
        .map(value => new URL(value, self.location.origin)).filter(allowedAsset).map(url => url.href))];
      if (!urls.length) throw new Error();
      const cache = await caches.open(cacheName);
      await cache.addAll(urls.map(url => new Request(url, { credentials: "omit", cache: "reload" })));
      await cache.put(shell, page);
      reply.postMessage(true);
    } catch { reply.postMessage(false); }
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === shell) {
    event.respondWith((async () => {
      try {
        const live = await fetch(request, { signal: AbortSignal.timeout(4000) });
        if (live.status < 500) return live;
      } catch { /* Fall back to the last prepared kiosk page. */ }
      const cache = await caches.open(cacheName);
      return await cache.match(shell) ?? Response.error();
    })());
  } else if (allowedAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return await cache.match(request) ?? await fetch(request);
    })());
  }
});
