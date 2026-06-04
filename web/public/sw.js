/* Minimal, comprehensible service worker.
   - App shell: network-first, cache fallback (works offline after first load)
   - Catalog demo images (GitHub raw): cache-first (offline demos)
   - API calls: never intercepted; offline writes are handled by the IndexedDB queue */
const SHELL = "shell-v1";
const MEDIA = "media-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL, MEDIA].includes(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;                       // queue handles writes
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/coach")) return;
  if (url.hostname === "raw.githubusercontent.com") {
    e.respondWith(
      caches.open(MEDIA).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/")))
  );
});
