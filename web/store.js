"use strict";
// The page's own records (collection, decks, deck versions, matches, a game in progress), kept in localStorage and
// swapped with the sync server by sync.js. No DOM (test/ runs it in node).
//
// A record is (kind, id) -> data, with the time of its last edit; a delete leaves a tombstone so it reaches the other
// devices. Every local edit also goes into the outbox until the server has it. Newest edit wins, here and there.
//
//   STORE.get(kind, id) -> data | null          STORE.all(kind) -> [{id, data, updated}]  (no deleted ones)
//   STORE.put(kind, id, data)                   STORE.update(kind, id, (old|null) => data)   STORE.del(kind, id)
//   STORE.on((kinds) => …) -> off()             called after any change, here, from another tab, or from the server
//   STORE.uid() -> a fresh id
// for sync.js: pending(), sent(changes), apply(changes) -> kinds, cursor()/setCursor(n), owner()/setOwner(name), wipe()

const STORE = (() => {
  const PREFIX = "rb-db:"; // rb-db:<kind> holds {id: {data, updated, deleted}}, rb-db@meta the outbox and cursor
  const META = "rb-db@meta";
  const ls = (() => { try { const s = window.localStorage; s.getItem("x"); return s; } catch { return null; } })();
  const mem = new Map(); // without storage (private mode, previews) everything still works until the tab closes
  const read = (k) => { try { const v = ls ? ls.getItem(k) : mem.get(k); return v ? JSON.parse(v) : null; } catch { return null; } };
  const write = (k, v) => {
    const s = JSON.stringify(v);
    try { if (ls) ls.setItem(k, s); else mem.set(k, s); } catch (e) { console.warn("store: can't save", k, e); }
  };

  const kinds = new Map(); // kind -> {id: rec}
  let meta = read(META) || { outbox: {}, cursor: 0, owner: null }; // outbox: "kind\tid" -> updated
  const listeners = new Set();

  const table = (kind) => {
    if (!kinds.has(kind)) kinds.set(kind, read(PREFIX + kind) || {});
    return kinds.get(kind);
  };
  const save = (kind) => write(PREFIX + kind, table(kind));
  const saveMeta = () => write(META, meta);
  const emit = (changed) => { if (changed.size) for (const f of listeners) try { f(changed); } catch (e) { console.error(e); } };
  let clock = 0;
  const stamp = (prev) => (clock = Math.max(Date.now(), clock + 1, (prev?.updated ?? 0) + 1));

  function local(kind, id, data) {
    const t = table(kind), rec = { data: data ?? null, updated: stamp(t[id]), deleted: data == null };
    t[id] = rec;
    meta.outbox[kind + "\t" + id] = rec.updated;
    save(kind); saveMeta();
    emit(new Set([kind]));
  }

  // another tab wrote: forget the cached copy so the next read takes the new one
  try {
    window.addEventListener("storage", (e) => {
      if (e.key === META) meta = read(META) || meta;
      else if (e.key?.startsWith(PREFIX)) { const k = e.key.slice(PREFIX.length); kinds.delete(k); emit(new Set([k])); }
    });
  } catch { /* node */ }

  return {
    get: (kind, id) => { const r = table(kind)[id]; return r && !r.deleted ? r.data : null; },
    all: (kind) => Object.entries(table(kind)).filter(([, r]) => !r.deleted).map(([id, r]) => ({ id, data: r.data, updated: r.updated })),
    put: (kind, id, data) => local(kind, id, data),
    update: (kind, id, fn) => { const r = table(kind)[id]; local(kind, id, fn(r && !r.deleted ? r.data : null)); },
    del: (kind, id) => { if (table(kind)[id] && !table(kind)[id].deleted) local(kind, id, null); },
    on: (f) => { listeners.add(f); return () => listeners.delete(f); },
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10),

    pending() {
      return Object.keys(meta.outbox).map((k) => {
        const [kind, id] = k.split("\t"), r = table(kind)[id];
        return { kind, id, updated: r.updated, deleted: r.deleted, data: r.deleted ? null : r.data };
      });
    },
    // the server has these; anything edited again since stays in the outbox
    sent(changes) {
      for (const c of changes) if (meta.outbox[c.kind + "\t" + c.id] === c.updated) delete meta.outbox[c.kind + "\t" + c.id];
      saveMeta();
    },
    // records from the server; a newer local edit (still to be sent) is kept
    apply(changes) {
      const changed = new Set();
      for (const c of changes) {
        const t = table(c.kind), old = t[c.id];
        if (old && old.updated >= c.updated) continue;
        t[c.id] = { data: c.deleted ? null : c.data, updated: c.updated, deleted: !!c.deleted };
        delete meta.outbox[c.kind + "\t" + c.id];
        changed.add(c.kind);
      }
      for (const k of changed) save(k);
      saveMeta();
      emit(changed);
      return changed;
    },
    cursor: () => meta.cursor,
    setCursor: (n) => { meta.cursor = n; saveMeta(); },
    owner: () => meta.owner,
    setOwner: (name) => { meta.owner = name; saveMeta(); },
    // another account logs in on this device: start empty (that account's records come from the server)
    wipe() {
      const gone = new Set();
      const keys = [];
      try { if (ls) for (let i = 0; i < ls.length; i++) keys.push(ls.key(i)); else keys.push(...mem.keys()); } catch { /* */ }
      for (const k of keys) if (k.startsWith(PREFIX)) { gone.add(k.slice(PREFIX.length)); try { ls ? ls.removeItem(k) : mem.delete(k); } catch { /* */ } }
      for (const k of kinds.keys()) gone.add(k);
      kinds.clear();
      meta = { outbox: {}, cursor: 0, owner: null };
      saveMeta();
      emit(gone);
    },
  };
})();
