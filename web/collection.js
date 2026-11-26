"use strict";
// The collection: copies per printing in the store (kind "coll", id = printing id, data {n, x}), and reading what you
// type or paste. No DOM (test/ runs it in node). Needs query.js and store.js first; deck.js for pasted deck codes.
//
// n counts every copy; x says how many of them are another version than plain English: {foil: 1, zh: 2, "zh-foil": 1}.
//
//   COLL.n(id)  COLL.v(id, ver)  COLL.add(id, delta, ver) -> new total  COLL.set(id, n)  COLL.setV(id, ver, n)
//   COLL.apply([{id, n, ver?}], "add"|"set")      VERSIONS: ver -> name ("" is plain English)
//   KEEP: how many copies of a card stay in the box       ASIDE: the copies put aside as spares, still in COLL's counts
//   sortOut(items) -> which of a batch go into the box and which aside      spares() -> what the box and the pile still need
//   FILING(saved): the batch being filed, ticked and edited               filing(items, boxed): where each goes
//   parseEntry("ogn 42 3", lastSet) -> {id, n, card, p, set} | {error}     quick entry, one printing per line
//   parseBulk(text) -> {items: [{id, n, card, p}], problems: [text…]}       lists, ids, CSV, deck codes

const PRINTS = new Map(); // "OGN-042A" -> {card, p}
for (const c of CARDS) for (const p of c.printings) PRINTS.set(p.id.toUpperCase(), { card: c, p });
const SET_IDS = new Set([...PRINTS.keys()].map((id) => id.split("-")[0]));

const LANGS = { en: ["English", "EN"], zh: ["Chinese", "中"], fr: ["French", "FR"], ko: ["Korean", "한"] };
const verOf = (lang, foil) => [lang in LANGS && lang !== "en" ? lang : "", foil ? "foil" : ""].filter(Boolean).join("-");
const langOf = (ver) => { const l = String(ver || "").split("-")[0]; return l in LANGS ? l : "en"; };
const isFoil = (ver) => String(ver || "").endsWith("foil");
const VERSIONS = Object.fromEntries(Object.entries(LANGS).flatMap(([l, [n]]) => [[verOf(l), n], [verOf(l, true), `${n} foil`]]));
const VER_SHORT = Object.fromEntries(Object.entries(LANGS).flatMap(([l, [, s]]) => [[verOf(l), s], [verOf(l, true), `${s} ✦`]]));
// A version as the printing exists: foil where it's only made as foil, not where it never is (p.foil from sync.py)
function autoVer(id, ver = "") {
  const f = PRINTS.get(id.toUpperCase())?.p.foil;
  return verOf(langOf(ver), f === "only" || (f !== "no" && isFoil(ver)));
}
// copies counted as a version their printing doesn't exist in: [{id, n, from, to}]
function wrongFoils() {
  return STORE.all("coll").flatMap(({ id }) => Object.keys(VERSIONS).map((from) => ({ id, n: COLL.v(id, from), from, to: autoVer(id, from) })).filter((x) => x.n > 0 && x.to !== x.from));
}
// "ogn 42 zh foil": the version words at the end, and the rest; ver undefined without any
function splitVersion(s) {
  let lang, foil, m;
  while ((m = s.match(/^(.*\S)\s+(foil|zh|cn|chinese|中文|fr|french|ko|kr|korean|한국어|en|english)$/i))) {
    const w = m[2].toLowerCase();
    if (w === "foil") foil = true; else lang = /^en/.test(w) ? "en" : /^fr/.test(w) ? "fr" : /^(k|한)/.test(w) ? "ko" : "zh";
    s = m[1];
  }
  return { rest: s, ver: lang || foil ? verOf(lang, foil) : undefined };
}
function put(id, counts) {
  const n = Object.values(counts).reduce((a, b) => a + b, 0);
  const x = Object.fromEntries(Object.entries(counts).filter(([k, c]) => k && c));
  if (n) STORE.put("coll", id, Object.keys(x).length ? { n, x } : { n }); else STORE.del("coll", id);
  ASIDE.trim(id);
  return n;
}

const COLL = {
  n: (id) => STORE.get("coll", id)?.n || 0,
  set(id, n) {
    n = Math.max(0, Math.round(n) || 0);
    if (n === COLL.n(id)) return n;
    // the total, whatever the versions: more are English (foil if it's only made so), fewer take the first ones off
    const c = Object.fromEntries(Object.keys(VERSIONS).map((k) => [k, COLL.v(id, k)]));
    let less = COLL.n(id) - n;
    if (less < 0) c[autoVer(id)] -= less;
    else for (const k of Object.keys(c)) { const t = Math.min(less, c[k]); c[k] -= t; less -= t; }
    return put(id, c);
  },
  // copies of one version
  v(id, ver = "") {
    const r = STORE.get("coll", id);
    if (!r) return 0;
    return ver ? r.x?.[ver] || 0 : r.n - Object.values(r.x || {}).reduce((a, b) => a + b, 0);
  },
  setV(id, ver, n) {
    n = Math.max(0, Math.round(n) || 0);
    const c = Object.fromEntries(Object.keys(VERSIONS).map((k) => [k, k === ver ? n : COLL.v(id, k)]));
    if (n === COLL.v(id, ver)) return COLL.n(id);
    return put(id, c);
  },
  // one less of a version you have none of takes nothing off
  add: (id, delta, ver = "") => COLL.setV(id, ver, COLL.v(id, ver) + delta),
  apply(items, mode = "add") {
    for (const { id, n, ver } of items) {
      if (mode !== "set") COLL.add(id, n, ver ?? autoVer(id));
      else if (ver == null) COLL.set(id, n); else COLL.setV(id, ver, n);
    }
  },
};

// ---------- playsets and spares ----------
// The box holds a playset of each printing, the best copies first; the rest are spares. Records: ("keep", card id)
// {all}: every copy stays or not, where that's not the rule's own answer; ("keep", "foil-first") {on}; ("aside",
// printing id) {ver: n}: the copies put aside.
const KEEP = {
  // as many as a deck may have of it; settings' playset says how many that is
  always: (card) => card.supertype === "Token" || /your deck can have any number of cards named/i.test(card.text || ""),
  all: (card) => STORE.get("keep", card.id)?.all ?? KEEP.always(card),
  setAll(card, on) { if (on === KEEP.always(card)) STORE.del("keep", card.id); else STORE.put("keep", card.id, { all: on }); },
  size: playsetSize, // query.js
  limit: (card) => (KEEP.all(card) ? Infinity : KEEP.size(card)),
  foilFirst: () => STORE.get("keep", "foil-first")?.on ?? S.keepFoilFirst ?? false,
  setFoilFirst: (on) => STORE.put("keep", "foil-first", { on }),
  // the versions, the one to keep first in front
  order() {
    const langs = [...new Set([...(S.languages || []), ...Object.keys(LANGS)])].filter((l) => l in LANGS), foil = KEEP.foilFirst();
    return langs.flatMap((l) => [verOf(l, foil), verOf(l, !foil)]);
  },
};
const noVers = () => Object.fromEntries(Object.keys(VERSIONS).map((k) => [k, 0]));
// of these copies, the ones that stay
function keepOf(have, limit) {
  const out = noVers();
  for (const v of KEEP.order()) { out[v] = Math.min(have[v] || 0, limit); limit -= out[v]; }
  return out;
}
const ASIDE = {
  v: (id, ver = "") => Math.min(STORE.get("aside", id)?.[ver] || 0, COLL.v(id, ver)),
  add(id, ver, d) {
    if (!d) return;
    const c = {};
    for (const k of Object.keys(VERSIONS)) { const n = Math.min(COLL.v(id, k), Math.max(0, ASIDE.v(id, k) + (k === (ver || "") ? d : 0))); if (n) c[k] = n; }
    if (Object.keys(c).length) STORE.put("aside", id, c); else STORE.del("aside", id);
  },
  // never more than there are, so copies that are gone don't come back as spares
  trim(id) {
    const r = STORE.get("aside", id);
    if (!r || Object.entries(r).every(([k, n]) => n <= COLL.v(id, k))) return;
    const c = Object.fromEntries(Object.keys(r).map((k) => [k, ASIDE.v(id, k)]).filter(([, n]) => n));
    if (Object.keys(c).length) STORE.put("aside", id, c); else STORE.del("aside", id);
  },
};
// what's in the box: not aside, and not among the items still to be filed (those already in the counts)
function inBox(id, items) {
  const c = noVers();
  for (const k of Object.keys(c)) c[k] = COLL.v(id, k) - ASIDE.v(id, k);
  for (const i of items) if (i.id === id && !i.isNew) c[i.ver || ""] -= i.n;
  for (const k of Object.keys(c)) c[k] = Math.max(0, c[k]);
  return c;
}
// items: [{id, n, ver, isNew}], isNew: not in the collection's counts yet (a scan's tally)
// -> for each {box, aside, out}: copies for the box, for the spares, and {ver: n} to take out of the box for better ones
function sortOut(items) {
  const res = items.map((i) => ({ box: 0, aside: 0, out: {} }));
  const by = new Map();
  items.forEach((i, at) => { if (!by.has(i.id)) by.set(i.id, []); by.get(i.id).push(at); });
  for (const [id, ats] of by) {
    const hit = PRINTS.get(id.toUpperCase());
    if (!hit) continue;
    const box = inBox(id, items), have = { ...box };
    for (const at of ats) have[items[at].ver || ""] += items[at].n;
    const keep = keepOf(have, KEEP.limit(hit.card)), room = {}, out = {};
    for (const k of Object.keys(have)) { const stay = Math.min(box[k], keep[k]); room[k] = keep[k] - stay; if (box[k] > stay) out[k] = box[k] - stay; }
    for (const at of ats) { const v = items[at].ver || ""; res[at].box = Math.min(items[at].n, room[v]); res[at].aside = items[at].n - res[at].box; room[v] -= res[at].box; }
    // taken out when the first of its better ones goes in
    if (Object.keys(out).length) res[ats.find((at) => res[at].box) ?? ats[0]].out = out;
  }
  return res;
}
// the printings in the box
const boxedIds = (items = []) => STORE.all("coll").map((r) => r.id).filter((id) => Object.values(inBox(id, items)).some((n) => n));
// Over the whole collection but the items still to be filed: what is beyond a playset in the box, what of the spares
// belongs in it, and the spares. -> {out, back, aside}, each [{id, n, ver, card, p}] in filing order
function spares(items = []) {
  const r = { out: [], back: [], aside: [] };
  for (const { id } of STORE.all("coll")) {
    const hit = PRINTS.get(id.toUpperCase());
    if (!hit) continue;
    const box = inBox(id, items), all = noVers();
    for (const k of Object.keys(all)) all[k] = box[k] + ASIDE.v(id, k);
    const keep = keepOf(all, KEEP.limit(hit.card));
    for (const ver of Object.keys(all)) {
      const row = (n) => ({ id: hit.p.id, n, ver, ...hit });
      if (box[ver] > keep[ver]) r.out.push(row(box[ver] - keep[ver]));
      if (keep[ver] > box[ver]) r.back.push(row(keep[ver] - box[ver]));
      if (ASIDE.v(id, ver)) r.aside.push(row(ASIDE.v(id, ver)));
    }
  }
  for (const k of Object.keys(r)) r[k] = r[k].map((x) => ({ x, key: [fileKey({ ...x.card, p: x.p }), x.ver] })).sort((a, b) => cmp(a.key, b.key)).map(({ x }) => x);
  return r;
}

// The batch being filed: {items: [{id, n, ver, guess}], done: [{k, id, n, ver, guess, aside, out}]}, done: ticked, newest
// first; aside: those went to the spares; out: taken out of the box with them; guess: the list lost once was put together
// again without knowing how many. Changes the batch it's given.
const FILING = {
  read(f) {
    if (!f?.items) return { items: [], done: [] };
    // kept as indexes of items before spares were
    if (f.done.some((x) => typeof x === "number")) return { items: f.items.filter((_, i) => !f.done.includes(i)), done: f.items.filter((_, i) => f.done.includes(i)).map((i) => ({ ...i, k: STORE.uid(), out: {} })) };
    return f;
  },
  put(f, i) {
    const same = f.items.find((x) => x.id === i.id && (x.ver || "") === (i.ver || "") && !x.guess === !i.guess);
    if (same) same.n += i.n; else f.items.push({ id: i.id, n: i.n, ver: i.ver || "", ...(i.guess ? { guess: true } : {}) });
  },
  // an item's part that goes into the box or aside
  tick(f, item, aside) {
    const r = sortOut(f.items)[f.items.indexOf(item)];
    const n = r && (aside ? r.aside : r.box);
    if (!n) return null;
    const out = !aside || !r.box ? r.out : {};
    item.n -= n;
    if (!item.n) f.items.splice(f.items.indexOf(item), 1);
    if (aside) ASIDE.add(item.id, item.ver, n);
    for (const [v, c] of Object.entries(out)) ASIDE.add(item.id, v, c);
    const d = { k: STORE.uid(), id: item.id, n, ver: item.ver || "", ...(item.guess ? { guess: true } : {}), aside: !!aside, out };
    f.done.unshift(d);
    return d;
  },
  untick(f, d) {
    f.done.splice(f.done.indexOf(d), 1);
    if (d.aside) ASIDE.add(d.id, d.ver, -d.n);
    for (const [v, c] of Object.entries(d.out || {})) ASIDE.add(d.id, v, -c);
    FILING.put(f, d);
  },
  // n copies of a printing's version turn out to be these instead: {ver: n}, maybe of another printing. Of a guess only
  // what's on the list changes, not the collection.
  edit(f, { id, n, ver, guess }, to, counts) {
    const item = f.items.find((x) => x.id === id && (x.ver || "") === (ver || "") && !x.guess === !guess);
    if (!item) return;
    item.n -= n;
    if (item.n <= 0) f.items.splice(f.items.indexOf(item), 1);
    if (!guess) COLL.add(id, -n, ver);
    for (const [v, c] of Object.entries(counts)) if (c > 0) { if (!guess) COLL.add(to, c, v); FILING.put(f, { id: to, n: c, ver: v, guess }); }
  },
};

// ---------- filing ----------

// Where a batch of printings goes in the box. items: [{id, n, ver}], boxed: the printings already in it.
// -> [{id, n, ver, card, p, pile, after, before, already}] in filing order; after: the card just in front, maybe one of
// the batch itself (it's filed by then); before: the next one in the box; already: the box has this printing.
function filing(items, boxed) {
  const row = (id) => { const h = PRINTS.get(id.toUpperCase()); return h && { id, card: h.card, p: h.p, key: fileKey({ ...h.card, p: h.p }) }; };
  const box = new Set(boxed), batch = new Set(items.map((i) => i.id));
  const all = [...new Set([...box, ...batch])].map(row).filter(Boolean).sort((a, b) => cmp(a.key, b.key));
  const at = new Map(all.map((r, i) => [r.id, i]));
  // neighbours only within a pile
  const near = (r) => (r ? { id: r.id, name: r.card.name } : null);
  return items.filter((i) => at.has(i.id)).map((i) => {
    const k = at.get(i.id), r = all[k], same = (x) => x && x.key[0] === r.key[0];
    let next = k + 1;
    while (next < all.length && !box.has(all[next].id)) next++;
    return { ...i, card: r.card, p: r.p, pile: r.key[0], already: box.has(i.id), after: same(all[k - 1]) ? near(all[k - 1]) : null, before: same(all[next]) ? near(all[next]) : null, pos: k };
  }).sort((a, b) => a.pos - b.pos || String(a.ver || "").localeCompare(String(b.ver || "")));
}

// The printing a set, number and variant mean: OGN 42 -> OGN-042, SFD R1 -> SFD-R01, OGN 300* (or s) signed
function findPrint(set, prefix, num, variant) {
  const v = variant === "s" ? "*" : variant;
  for (const pad of [3, 2, 1]) {
    const hit = PRINTS.get(`${set}-${prefix}${num.padStart(pad, "0")}${v}`.toUpperCase());
    if (hit) return hit;
  }
  return null;
}

// one line of quick entry: "ogn 42", "OGN-042", "ogn-42a x2", "3x ogn 42", "sfd r01 -1", "42" (the last set),
// "-ogn 42" (one less), a full printing id ("OGN-151b-Nexus"). n is the change, default +1.
const ENTRY = /^([a-z]{2,5})?[\s-]*(r|sp|t)?(\d{1,3})\s*([ab*s]?)$/i;
function parseEntry(line, lastSet) {
  const { rest, ver } = splitVersion(line.trim());
  const e = parsePlain(rest, lastSet);
  return e.error != null || ver === undefined ? e : { ...e, ver };
}
function parsePlain(line, lastSet) {
  let s = line.trim().replace(/\s+/g, " "), n = 1, m;
  if (!s) return { error: "" };
  const isCard = (x) => PRINTS.has(x.toUpperCase()) || (ENTRY.test(x) && !/^[a-z]{2,5}$/i.test(x)); // not a set alone
  if ((m = s.match(/^([+-]?\d+)\s*x\s+(.+)$/i))) [n, s] = [+m[1], m[2]]; // 3x ogn 42
  else if ((m = s.match(/^(.+?)\s*x\s*([+-]?\d+)$/i)) && isCard(m[1])) [s, n] = [m[1], +m[2]]; // ogn 42 x3, OGN-042x3
  else if ((m = s.match(/^(.+?)\s+([+-]?\d+)$/)) && isCard(m[1])) [s, n] = [m[1], +m[2]]; // ogn 42 3, sfd r01 -1
  if (s.startsWith("-") && !/^-\d/.test(s)) { s = s.slice(1).trim(); n = -Math.abs(n); }
  const exact = PRINTS.get(s.toUpperCase());
  if (exact) return { id: exact.p.id, n, ...exact, set: exact.p.id.split("-")[0] };
  m = s.match(ENTRY);
  if (!m) return { error: `"${line.trim()}"? e.g. ogn 42, OGN-042a x2, 3x sfd 7, 42 for the last set` };
  const set = (m[1] || lastSet || "").toUpperCase();
  if (!set) return { error: "which set? e.g. ogn 42 (after that a number alone is enough)" };
  if (!SET_IDS.has(set)) return { error: `no set ${set} (${[...SET_IDS].filter((x) => !x.includes("NN")).join(", ")})` };
  const hit = findPrint(set, (m[2] || "").toUpperCase(), m[3], (m[4] || "").toLowerCase());
  if (!hit) return { error: `no card ${set} ${m[2] || ""}${m[3]}${m[4] || ""}` };
  return { id: hit.p.id, n, ...hit, set };
}

// A pasted list. CSV with an id column (this page's export, or id,count); a deck code; else per line a quick entry
// ("ogn 42 3"), a printing id, or "3 Name" / "Name x3" (the card's base printing; "Name (OGN-042a)" picks one).
function parseBulk(text) {
  const items = new Map(), problems = [];
  const said = (id, ver) => (ver === undefined || isFoil(ver) ? ver : autoVer(id, ver)); // "foil" said counts as said
  const add = (hit, n, line, ver) => {
    if (!hit) return problems.push(`not found: "${line}"`);
    const key = `${hit.p.id} ${ver ?? "any"}`;
    const e = items.get(key) || { id: hit.p.id, n: 0, card: hit.card, p: hit.p, ...(ver === undefined ? {} : { ver }) };
    e.n += n;
    items.set(key, e);
  };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  const head = lines[0]?.toLowerCase().split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
  if (head && head.length > 1 && head.includes("id")) { // CSV
    const id = head.indexOf("id"), cnt = ["own", "count", "quantity", "qty", "n", "copies"].map((k) => head.indexOf(k)).find((i) => i >= 0);
    for (const l of lines.slice(1)) {
      const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
      const n = cnt == null ? 1 : parseInt(cells[cnt]) || 0;
      const hit = PRINTS.get((cells[id] || "").toUpperCase());
      const x = Object.keys(VERSIONS).filter(Boolean).map((k) => [k, head.includes(k) ? parseInt(cells[head.indexOf(k)]) || 0 : 0]).filter(([, c]) => c);
      if (!x.length || !hit) { if (n) add(hit, n, l); continue; }
      const plain = n - x.reduce((a, [, c]) => a + c, 0);
      if (plain > 0) add(hit, plain, l, "");
      for (const [k, c] of x) add(hit, c, l, k);
    }
    return { items: [...items.values()], problems };
  }
  if (lines.length === 1 && /^[A-Z2-7]{8,}=*$/i.test(lines[0]) && typeof readDeck === "function") { // a deck code
    const d = readDeck(lines[0]);
    if (!d.legend && d.problems.length && !d.main?.length) return { items: [], problems: d.problems };
    for (const c of [d.legend, d.champion, ...d.main, ...d.battlefields, ...d.runes, ...d.side].filter(Boolean)) add(PRINTS.get(c.id.toUpperCase()), 1, c.name);
    return { items: [...items.values()], problems };
  }
  let lastSet = null;
  const byName = new Map(CARDS.map((c) => [c.name.toLowerCase(), c]));
  const HEADER = /^(legend|champion|chosen champion|main ?deck|main|deck|battlefields?|runes?|rune deck|side ?board|side deck|side)\s*(\(\d+\))?:?$/i;
  for (const l of lines) {
    if (HEADER.test(l)) continue;
    const e = parseEntry(l, lastSet);
    if (!e.error) { add(e, e.n, l, said(e.id, e.ver)); lastSet = e.set; continue; }
    const { rest, ver } = byName.has(l.replace(/^\d+\s*x?\s+/i, "").toLowerCase()) ? { rest: l } : splitVersion(l);
    let m = rest.match(/^(\d+)\s*x?\s+(.+)$/i), n = 1, name = rest;
    if (m) [n, name] = [+m[1], m[2]];
    else if ((m = rest.match(/^(.+?)\s+x(\d+)$/i))) [name, n] = [m[1], +m[2]];
    const pid = name.match(/\(([A-Z]{2,5}-[\w*-]+)\)\s*$/i);
    if (pid && PRINTS.has(pid[1].toUpperCase())) { add(PRINTS.get(pid[1].toUpperCase()), n, l, said(pid[1], ver)); continue; }
    const card = byName.get(name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase());
    add(card && PRINTS.get(card.id.toUpperCase()), n, l, card && said(card.id, ver));
  }
  return { items: [...items.values()], problems };
}
