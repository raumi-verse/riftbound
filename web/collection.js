"use strict";
// The collection: copies per printing in the store (kind "coll", id = printing id, data {n}), and reading what you
// type or paste. No DOM (test/ runs it in node). Needs query.js and store.js first; deck.js for pasted deck codes.
//
//   COLL.n(id)  COLL.add(id, delta) -> new count  COLL.set(id, n)  COLL.apply([{id, n}], "add"|"set")
//   parseEntry("ogn 42 3", lastSet) -> {id, n, card, p, set} | {error}     quick entry, one printing per line
//   parseBulk(text) -> {items: [{id, n, card, p}], problems: [text…]}       lists, ids, CSV, deck codes

const PRINTS = new Map(); // "OGN-042A" -> {card, p}
for (const c of CARDS) for (const p of c.printings) PRINTS.set(p.id.toUpperCase(), { card: c, p });
const SET_IDS = new Set([...PRINTS.keys()].map((id) => id.split("-")[0]));

const COLL = {
  n: (id) => STORE.get("coll", id)?.n || 0,
  set(id, n) {
    n = Math.max(0, Math.round(n) || 0);
    if (n === COLL.n(id)) return n;
    if (n) STORE.put("coll", id, { n }); else STORE.del("coll", id);
    return n;
  },
  add: (id, delta) => COLL.set(id, COLL.n(id) + delta),
  apply(items, mode = "add") { for (const { id, n } of items) COLL.set(id, mode === "set" ? n : COLL.n(id) + n); },
};

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
  const add = (hit, n, line) => {
    if (!hit) return problems.push(`not found: "${line}"`);
    const e = items.get(hit.p.id) || { id: hit.p.id, n: 0, card: hit.card, p: hit.p };
    e.n += n;
    items.set(hit.p.id, e);
  };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));
  const head = lines[0]?.toLowerCase().split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
  if (head && head.length > 1 && head.includes("id")) { // CSV
    const id = head.indexOf("id"), cnt = ["own", "count", "quantity", "qty", "n", "copies"].map((k) => head.indexOf(k)).find((i) => i >= 0);
    for (const l of lines.slice(1)) {
      const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
      const n = cnt == null ? 1 : parseInt(cells[cnt]) || 0;
      if (n) add(PRINTS.get((cells[id] || "").toUpperCase()), n, l);
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
    if (!e.error) { add(e, e.n, l); lastSet = e.set; continue; }
    let m = l.match(/^(\d+)\s*x?\s+(.+)$/i), n = 1, name = l;
    if (m) [n, name] = [+m[1], m[2]];
    else if ((m = l.match(/^(.+?)\s+x(\d+)$/i))) [name, n] = [m[1], +m[2]];
    const pid = name.match(/\(([A-Z]{2,5}-[\w*-]+)\)\s*$/i);
    if (pid && PRINTS.has(pid[1].toUpperCase())) { add(PRINTS.get(pid[1].toUpperCase()), n, l); continue; }
    const card = byName.get(name.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase());
    add(card && PRINTS.get(card.id.toUpperCase()), n, l);
  }
  return { items: [...items.values()], problems };
}
