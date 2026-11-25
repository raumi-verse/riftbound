"use strict";
// The pages were under /search/: the service worker there removes itself and its copies of the pages.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) { const u = new URL(req.url); if (u.origin === location.origin && u.pathname.startsWith("/search/")) await cache.delete(req); }
    }
    await self.registration.unregister();
  })());
});
