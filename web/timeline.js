"use strict";
// What was done to the collection, its spares and the filing list on this device, newest last, each undoable on its
// own whatever came after. No DOM. Needs store.js and collection.js first.
//
//   FILE.get() / FILE.set(f)                  the batch being filed (FILING in collection.js), in this browser
//   TIMELINE.record(kind, text, fn) -> key    runs fn and keeps what it changed; null if nothing
//   TIMELINE.toggle(key, undone?)             undoes it, or does it again; with undone true or false only if it isn't so
//   TIMELINE.all() -> [{k, at, kind, text, d, undone}]      TIMELINE.ofTick(k): the entry a ticked card is from
//
// An entry keeps differences, not states: d = {coll: {id: {ver: n}}, aside: …, items: {"id ver guess": n}, done: {add, del}}.

const FILE = (() => {
  const KEY = "rb-filing";
  let mem = null;
  return {
    get() { let s = mem; try { s = localStorage.getItem(KEY); } catch { /* */ } try { return FILING.read(JSON.parse(s)); } catch { return FILING.read(null); } },
    set(f) { mem = f.items.length || f.done.length ? JSON.stringify(f) : null; try { if (mem) localStorage.setItem(KEY, mem); else localStorage.removeItem(KEY); } catch { /* */ } },
  };
})();

const TIMELINE = (() => {
  const KEY = "rb-timeline", MOST = 800, CHARS = 1e6; // the oldest go first
  let mem = "[]";
  const read = () => { let s = mem; try { s = localStorage.getItem(KEY) ?? "[]"; } catch { /* */ } try { return JSON.parse(s); } catch { return []; } };
  function write(list) {
    list = list.slice(-MOST);
    let s = JSON.stringify(list);
    while (s.length > CHARS && list.length > 1) { list = list.slice(Math.ceil(list.length / 10)); s = JSON.stringify(list); }
    mem = s;
    try { localStorage.setItem(KEY, s); } catch (e) { console.warn("timeline: can't save", e); }
  }
  // records of an account that isn't logged in now aren't to be undone into this one's
  const mine = (e) => !e.owner || !STORE.owner() || e.owner === STORE.owner();

  const vers = { coll: (r) => (r ? { ...r.x, "": r.n - Object.values(r.x || {}).reduce((a, b) => a + b, 0) } : {}), aside: (r) => r || {} };
  const itemKey = (i) => `${i.id} ${i.ver || ""} ${i.guess ? "?" : ""}`;
  const state = () => ({
    ...Object.fromEntries(["coll", "aside"].map((kind) => [kind, new Map(STORE.all(kind).map((r) => [r.id, JSON.stringify(r.data)]))])),
    file: FILE.get(),
  });
  function diff(a, b) {
    const d = {};
    for (const kind of ["coll", "aside"]) for (const id of new Set([...a[kind].keys(), ...b[kind].keys()])) {
      const was = a[kind].get(id), is = b[kind].get(id);
      if (was === is) continue;
      const x = vers[kind](was && JSON.parse(was)), y = vers[kind](is && JSON.parse(is)), c = {};
      for (const v of new Set([...Object.keys(x), ...Object.keys(y)])) { const n = (y[v] || 0) - (x[v] || 0); if (n) c[v] = n; }
      if (Object.keys(c).length) (d[kind] ??= {})[id] = c;
    }
    const count = (f) => { const m = {}; for (const i of f.items) m[itemKey(i)] = (m[itemKey(i)] || 0) + i.n; return m; };
    const x = count(a.file), y = count(b.file);
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { const n = (y[k] || 0) - (x[k] || 0); if (n) (d.items ??= {})[k] = n; }
    const add = b.file.done.filter((e) => !a.file.done.some((o) => o.k === e.k)), del = a.file.done.filter((e) => !b.file.done.some((o) => o.k === e.k));
    if (add.length || del.length) d.done = { add, del };
    return Object.keys(d).length ? d : null;
  }
  // the opposite of d
  function revert(d) {
    const each = (kind, fn) => { for (const [id, c] of Object.entries(d[kind] || {})) for (const [v, n] of Object.entries(c)) fn(id, v, -n); };
    // spares can't be more than there are: off before, on after
    each("aside", (id, v, n) => { if (n < 0) ASIDE.add(id, v, n); });
    each("coll", (id, v, n) => COLL.add(id, n, v));
    each("aside", (id, v, n) => { if (n > 0) ASIDE.add(id, v, n); });
    if (!d.items && !d.done) return;
    const f = FILE.get();
    for (const [key, n] of Object.entries(d.items || {})) {
      const [id, ver, guess] = key.split(" ");
      if (n < 0) { FILING.put(f, { id, ver, n: -n, guess: !!guess }); continue; }
      const i = f.items.find((x) => itemKey(x) === key);
      if (i && (i.n -= n) <= 0) f.items.splice(f.items.indexOf(i), 1);
    }
    if (d.done) {
      f.done = f.done.filter((e) => !d.done.add.some((o) => o.k === e.k));
      f.done.push(...d.done.del.filter((o) => !f.done.some((e) => e.k === o.k)));
    }
    FILE.set(f);
  }
  // + and − on the same card one after another are one entry
  function merge(a, b) {
    const c = { ...a };
    for (const [v, n] of Object.entries(b)) { c[v] = (c[v] || 0) + n; if (!c[v]) delete c[v]; }
    return c;
  }
  const only = (d) => (Object.keys(d).length === 1 && d.coll && Object.keys(d.coll).length === 1 ? Object.keys(d.coll)[0] : null);

  return {
    record(kind, text, fn) {
      const a = state();
      fn();
      const d = diff(a, state());
      if (!d) return null;
      const list = read(), last = list.at(-1), id = kind === "count" && only(d);
      if (id && last?.kind === "count" && !last.undone && only(last.d) === id && Date.now() - last.at < 120e3 && last.owner === STORE.owner()) {
        const c = merge(last.d.coll[id], d.coll[id]);
        if (!Object.keys(c).length) { list.pop(); write(list); return null; }
        last.d = { coll: { [id]: c } }; last.at = Date.now();
        write(list);
        return last.k;
      }
      const e = { k: STORE.uid(), at: Date.now(), kind, text, d, owner: STORE.owner() };
      write([...list, e]);
      return e.k;
    },
    toggle(k, undone) {
      const list = read(), e = list.find((x) => x.k === k);
      if (!e || !mine(e) || !!e.undone === undone) return;
      const a = state();
      revert(e.d);
      // what it really changed (some of it may be gone since), so doing it again is exact
      e.d = diff(a, state()) || {};
      e.undone = !e.undone;
      write(list);
    },
    all: () => read().filter(mine),
    ofTick: (k) => read().find((e) => mine(e) && !e.undone && e.kind === "tick" && e.d.done?.add.some((x) => x.k === k)),
  };
})();
