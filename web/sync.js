"use strict";
// Keeps STORE in step with the sync server (server.py). Logged out, everything still works on this device alone.
// Needs store.js first. No DOM (test/ runs it in node with a fake fetch).
//
//   SYNC.login(server, name, password)   SYNC.logout()   SYNC.now() -> Promise   SYNC.call(method, path, body)
//   SYNC.passkeyStart({server, link}) leaves for the passkey login, SYNC.passkeyFinish(code, other) ends it (login.html)
//   SYNC.state() -> {status, server, name, last, error}   SYNC.onState(f) -> off()
//   status: "local" (not logged in), "idle", "syncing", "offline", "error"
// It syncs on page load, 2 s after an edit, when the network comes back and when the page is shown again.

const SYNC = (() => {
  const KEY = "rb-sync"; // {server, token, name, last}
  const DEFAULT_SERVER = (window.SETTINGS && window.SETTINGS.syncServer) || "https://rb-api.raumi.dev";
  const DELAY = 2000;
  const ls = (() => { try { return window.localStorage; } catch { return null; } })();
  let conf = (() => { try { return JSON.parse(ls?.getItem(KEY)) || {}; } catch { return {}; } })();
  let status = conf.token ? "idle" : "local", error = null, running = null, again = false, timer = null;
  const listeners = new Set();

  const saveConf = () => { try { ls?.setItem(KEY, JSON.stringify(conf)); } catch { /* */ } };
  const state = () => ({ status, server: conf.server || DEFAULT_SERVER, name: conf.name || null, last: conf.last || null, error });
  const set = (s, e = null) => { status = s; error = e; for (const f of listeners) try { f(state()); } catch (x) { console.error(x); } };

  class ServerError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  async function call(method, path, body, token = conf.token, server = conf.server || DEFAULT_SERVER) {
    let r;
    try {
      r = await fetch(server.replace(/\/+$/, "") + path, {
        method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) { throw new ServerError(0, "can't reach the server"); }
    let b = null;
    try { b = await r.json(); } catch { /* */ }
    if (!r.ok) throw new ServerError(r.status, b?.error || `server answered ${r.status}`);
    return b;
  }

  async function once() {
    for (;;) {
      const out = STORE.pending();
      const r = await call("POST", "/sync", { since: STORE.cursor(), changes: out });
      STORE.sent(out);
      STORE.apply(r.changes);
      STORE.setCursor(r.cursor);
      if (!r.more && !STORE.pending().length) return;
    }
  }

  // one run at a time; an edit during a run makes one more run after it
  function now() {
    if (!conf.token) return Promise.resolve();
    if (running) { again = true; return running; }
    clearTimeout(timer);
    set("syncing");
    running = (async () => {
      try {
        do { again = false; await once(); } while (again);
        conf.last = Date.now(); saveConf();
        set("idle");
      } catch (e) {
        if (e.status === 401) { conf.token = null; saveConf(); set("local", "logged out by the server: log in again"); }
        else set(e.status === 0 ? "offline" : "error", e.message);
      } finally { running = null; }
    })();
    return running;
  }

  const later = () => { if (conf.token) { clearTimeout(timer); timer = setTimeout(now, DELAY); } };
  let applying = false; // the server's own changes don't need sending back
  STORE.on(() => { if (!applying) later(); });
  const apply = STORE.apply;
  STORE.apply = (c) => { applying = true; try { return apply(c); } finally { applying = false; } };

  // logged in: as someone else this device starts empty, else its records go up with the first sync
  async function adopt(server, r) {
    if (STORE.owner() && STORE.owner().toLowerCase() !== r.name.toLowerCase()) STORE.wipe(); // someone else's records
    STORE.setOwner(r.name);
    STORE.setCursor(0); // everything the account has; local records made logged out go up with the first sync
    conf = { server, token: r.token, name: r.name, last: null };
    saveConf();
    set("idle");
    await now();
    return r.name;
  }
  const tidy = (server) => (server || conf.server || DEFAULT_SERVER).trim().replace(/\/+$/, "");
  const device = () => (typeof navigator !== "undefined" && navigator.userAgent) || "";

  async function login(server, name, password) {
    server = tidy(server || DEFAULT_SERVER);
    return adopt(server, await call("POST", "/login", { name, password, label: device() }, null, server));
  }

  // Passkeys: the page keeps a verifier, goes to the provider through the server and comes back to login.html#code=…,
  // where the code and the verifier make a token. localStorage, as an installed app may come back in another tab.
  const PK = "rb-passkey", PK_TTL = 15 * 60e3;
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const canPasskey = () => typeof location !== "undefined" && location.protocol.startsWith("http") && !!globalThis.crypto?.subtle;
  async function passkeyStart({ server, link = false } = {}) {
    server = tidy(server);
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const r = await call("POST", "/oidc/start", { challenge, return: new URL("login.html", location.href).href.split(/[?#]/)[0], link }, link ? conf.token : null, server);
    ls?.setItem(PK, JSON.stringify({ verifier, server, link, back: location.href, at: Date.now() }));
    location.assign(r.url);
  }
  // on login.html; other(name) -> whether to go on when this browser holds someone else's records
  async function passkeyFinish(code, other) {
    let p = null;
    try { p = JSON.parse(ls?.getItem(PK)); ls?.removeItem(PK); } catch { /* */ }
    if (!p || Date.now() - p.at > PK_TTL) throw new Error("this login has expired, try again");
    const r = await call("POST", "/oidc/finish", { code, verifier: p.verifier, label: device() }, p.link ? conf.token : null, p.server);
    if (!p.link) {
      if (STORE.owner() && STORE.owner().toLowerCase() !== r.name.toLowerCase() && !(await other(r.name))) {
        await call("POST", "/logout", {}, r.token, p.server).catch(() => {});
        return { back: p.back };
      }
      await adopt(p.server, r);
    }
    return { back: p.back, name: r.name, linked: !!r.linked };
  }

  async function logout() {
    if (conf.token) { try { await call("POST", "/logout"); } catch { /* the token goes anyway */ } }
    conf = { server: conf.server };
    saveConf();
    set("local");
  }

  try {
    window.addEventListener("online", now);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") now(); });
    window.addEventListener("storage", (e) => {
      if (e.key === KEY) { try { conf = JSON.parse(e.newValue) || {}; } catch { conf = {}; } set(conf.token ? "idle" : "local"); }
    });
    setTimeout(now, 0);
  } catch { /* node */ }

  return { login, logout, canPasskey, passkeyStart, passkeyFinish, now, call: (m, p, b) => call(m, p, b), state, onState: (f) => { listeners.add(f); return () => listeners.delete(f); }, DEFAULT_SERVER };
})();
