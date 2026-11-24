"use strict";
// The collection: copies per printing in the store (kind "coll", id = printing id, data {n, x}), and reading what you
// type or paste. No DOM (test/ runs it in node). Needs query.js and store.js first; deck.js for pasted deck codes.
//
// n counts every copy; x says how many of them are another version than plain English: {foil: 1, zh: 2, "zh-foil": 1}.
//
//   COLL.n(id)  COLL.v(id, ver)  COLL.add(id, delta, ver) -> new total  COLL.set(id, n)  COLL.setV(id, ver, n)
//   COLL.apply([{id, n, ver?}], "add"|"set")      VERSIONS: ver -> name ("" is plain English)
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
  return n;
}

const COLL = {
  n: (id) => STORE.get("coll", id)?.n || 0,
  set(id, n) {
    n = Math.max(0, Math.round(n) || 0);
    if (n === COLL.n(id)) return n;
    // the total, whatever the versions: more are plain English, fewer take those off first
    const c = Object.fromEntries(Object.keys(VERSIONS).map((k) => [k, COLL.v(id, k)]));
    let less = COLL.n(id) - n;
    if (less < 0) c[""] -= less;
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
      if (mode !== "set") COLL.add(id, n, ver || "");
      else if (ver == null) COLL.set(id, n); else COLL.setV(id, ver, n);
    }
  },
};

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
    return { ...i, card: r.card, p: r.p, pile: r.key[0], already: box.has(i.id), after: same(all[k - 1]) ? near(all[k - 1]) : null, before: same(all[next]) ? near(all[next]) : null, k };
  }).sort((a, b) => a.k - b.k || String(a.ver || "").localeCompare(String(b.ver || "")));
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
    if (!e.error) { add(e, e.n, l, e.ver); lastSet = e.set; continue; }
    const { rest, ver } = byName.has(l.replace(/^\d+\s*x?\s+/i, "").toLowerCase()) ? { rest: l } : splitVersion(l);
    let m = rest.match(/^(\d+)\s*x?\s+(.+)$/i), n = 1, name = rest;
    if (m) [n, name] = [+m[1], m[2]];
    else if ((m = rest.match(/^(.+?)\s+x(\d+)$/i))) [name, n] = [m[1], +m[2]];
    const pid = name.match(/\(([A-Z]{2,5}-[\w*-]+)\)\s*$/i);
    if (pid && PRINTS.has(pid[1].toUpperCase())) { add(PRINTS.get(pid[1].toUpperCase()), n, l, ver); continue; }
    const card = byName.get(name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase());
    add(card && PRINTS.get(card.id.toUpperCase()), n, l, ver);
  }
  return { items: [...items.values()], problems };
}
