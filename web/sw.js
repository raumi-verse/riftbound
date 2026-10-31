// Offline use (on the website; browsers don't run service workers for file://).
// The page itself network-first, so the weekly cards.js is never stale while online; icons and card pictures
// from the cache once seen. The page is never served from an old cache when the network works, so the
// cache names only change if this file's layout of them does.
const SHELL = "shell-v1", ICONS = "icons-v1", IMAGES = "images-v1";
const KEEP_IMAGES = 1500; // card pictures, ~100 KB each (about every printing, ~150 MB); oldest dropped first
const SHELL_FILES = ["./", "index.html", "style.css", "settings.js", "cards.js", "query.js", "app.js", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => ![SHELL, ICONS, IMAGES].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.hostname === "cdn.piltoverarchive.com") return e.respondWith(cacheFirst(IMAGES, req, true));
  if (url.origin !== location.origin) return;
  if (url.pathname.includes("/icons/")) return e.respondWith(cacheFirst(ICONS, req));
  if (url.pathname.includes("/img/")) return e.respondWith(cacheFirst(IMAGES, req)); // sync.py --images
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === "navigate" && await cache.match("./"));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(name, req, cors = false) {
  const cache = await caches.open(name);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  // the CDN allows CORS: a readable response, so the cache counts its real size (an opaque one costs megabytes)
  const res = await fetch(cors ? new Request(req.url, { mode: "cors", credentials: "omit" }) : req);
  if (res.ok) {
    await cache.put(req.url, res.clone());
    if (name === IMAGES) trim(cache);
  }
  return res;
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_IMAGES))) await cache.delete(k);
}
