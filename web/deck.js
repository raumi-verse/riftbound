"use strict";
// Decks: reading a pasted list or a Piltover deck code, and checking it is legal. No DOM (test/ runs it in node).
// Needs query.js first (CARDS, playable).

// ---------- cards by printing id and by name ----------

const BY_PRINT = new Map(), BY_NAME = new Map();
for (const c of CARDS) {
  if (c.supertype === "Token") continue;
  BY_NAME.set(c.name.toLowerCase(), c);
  for (const p of c.printings) BY_PRINT.set(p.id.toUpperCase(), c);
}
// a printing id from a deck code; signed printings are "*" here, "s" in Piltover's own tools
const cardByCode = (code) => BY_PRINT.get(code.toUpperCase()) || BY_PRINT.get(code.toUpperCase().replace(/S$/, "*")) || BY_PRINT.get(code.toUpperCase().replace(/[A-Z*]$/, ""));

// ---------- Piltover deck codes ----------
// Format 1, versions 1 to 6: a port of riftbound-tts' "Riftbound Deck Codes" object (itself a port of
// github.com/Piltover-Archive/RiftboundDeckCodes 1.5.0). decodeDeckCode(code) -> {main: [{code, count}], side,
// champion, legends, version}; throws an Error with the reason.

const CODE_SETS = ["OGN", "OGS", "ARC", "SFD", "UNL", "VEN", "RAD"];
const CODE_VARIANTS = { 0: "", 1: "a", 2: "*", 3: "b" };
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(str) {
  str = str.replace(/\s+/g, "").replace(/=+$/, "");
  const bytes = [];
  let buffer = 0, bits = 0;
  for (const ch of str) {
    const v = B32.indexOf(ch.toUpperCase());
    if (v < 0) throw new Error(`Invalid character in deck code: '${ch}'`);
    buffer = ((buffer << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xff); }
  }
  return bytes;
}

function decodeDeckCode(code) {
  const bytes = base32Decode(code);
  let pos = 0;
  const byte = () => { if (pos >= bytes.length) throw new Error("Deck code ended early"); return bytes[pos++]; };
  const varint = () => { let r = 0, mult = 1; for (;;) { const b = byte(); r += (b & 127) * mult; if (b < 128) return r; mult *= 128; } };
  const unknown = new Set();
  const set = (v) => CODE_SETS[v] ?? (unknown.add(v), `SET${v}`);
  const variant = (v) => CODE_VARIANTS[v] ?? `?${v}`;
  const number = (flagged, strict) => {
    if (!flagged) return String(varint()).padStart(3, "0");
    const flag = byte(), n = varint();
    if (flag === 1) return `R${String(n).padStart(2, "0")}`;
    if (strict && flag === 2) return `SP${n}`;
    if (strict && flag !== 0) throw new Error(`Unknown number-prefix flag: ${flag}`);
    return String(n).padStart(3, "0");
  };
  const header = byte(), format = header >> 4, version = header & 15;
  if (format !== 1) throw new Error(`Unsupported deck code format ${format}`);
  if (version > 6) throw new Error(`Unsupported deck code version ${version} (this page reads up to 6)`);
  let flagged = version >= 4;
  if (version >= 5) {
    const f = byte();
    if (f > 1) throw new Error(`Unsupported deck prefix flag: ${f}`);
    flagged = f === 1;
  }
  const group = (deck, count, strict) => {
    for (let g = varint(); g > 0; g--) {
      const n = varint(), s = set(byte()), v = variant(byte());
      for (let i = 0; i < n; i++) deck.push({ code: `${s}-${number(flagged, strict)}${v}`, count });
    }
  };
  const section = (max) => {
    const deck = [];
    if (version >= 5) for (let k = varint(); k > 0; k--) group(deck, varint(), true);
    else for (let count = max; count >= 1; count--) group(deck, count, false);
    return deck;
  };
  const ref = () => { const s = set(byte()), v = variant(byte()); return `${s}-${number(flagged, true)}${v}`; };
  const main = section(12);
  const side = version >= 2 ? section(3) : [];
  const champion = version >= 3 && byte() === 1 ? ref() : null;
  const legends = [];
  if (version >= 6) for (let n = varint(); n > 0; n--) legends.push(ref());
  return { main, side, champion, legends, version, unknownSets: [...unknown].sort() };
}

// encodeDeckCode(deck from readDeck) -> a version 5 code (the newest any decoder in use reads for decks without
// additional legends). Each card is written as its base printing, or its first printing in a set codes can hold
// (Nexus Night and Worlds printings can't be written). Legend, champion, runes and battlefields go in the main section,
// as Piltover does; the chosen champion is also named after the side deck. Throws if a card has no codable printing.
const PRINT_ID = /^([A-Z]+)-(R|SP)?(\d+)([ab*]?)$/i;

function codable(card) {
  for (const id of [card.id, ...card.printings.map((p) => p.id)]) {
    const m = id.match(PRINT_ID);
    if (m && CODE_SETS.includes(m[1].toUpperCase())) {
      return { set: CODE_SETS.indexOf(m[1].toUpperCase()), prefix: { R: 1, SP: 2 }[(m[2] || "").toUpperCase()] ?? 0,
        num: +m[3], variant: { "": 0, a: 1, "*": 2, b: 3 }[m[4].toLowerCase()] };
    }
  }
  throw new Error(`${card.name} has no printing a deck code can hold`);
}

function base32Encode(bytes) {
  let out = "", buffer = 0, bits = 0;
  for (const b of bytes) {
    buffer = ((buffer << 8) | b) & 0xffff; bits += 8;
    while (bits >= 5) { bits -= 5; out += B32[(buffer >> bits) & 31]; }
  }
  if (bits > 0) out += B32[(buffer << (5 - bits)) & 31];
  return out;
}

function encodeDeckCode(d) {
  const out = [];
  const varint = (n) => { while (n >= 128) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); };
  const all = [d.legend, d.champion, ...d.main, ...d.battlefields, ...d.runes].filter(Boolean);
  const flagged = [...all, ...d.side].some((c) => codable(c).prefix !== 0);
  const number = (x) => { if (flagged) out.push(x.prefix); varint(x.num); };
  const section = (cards) => {
    const counts = new Map(); // card id -> [codable, count]
    for (const c of cards) { const e = counts.get(c.id) || [codable(c), 0]; e[1]++; counts.set(c.id, e); }
    const byCount = new Map(); // count -> "set/variant" -> [codable…]
    for (const [x, n] of counts.values()) {
      const g = byCount.get(n) || new Map(), k = `${x.set}/${x.variant}`;
      g.set(k, [...(g.get(k) || []), x]);
      byCount.set(n, g);
    }
    const ordered = [...byCount].sort((a, b) => b[0] - a[0]);
    varint(ordered.length);
    for (const [n, groups] of ordered) {
      varint(n);
      varint(groups.size);
      for (const xs of groups.values()) {
        varint(xs.length); out.push(xs[0].set, xs[0].variant);
        for (const x of xs.sort((a, b) => a.num - b.num)) number(x);
      }
    }
  };
  out.push(0x15, flagged ? 1 : 0);
  section(all);
  section(d.side);
  if (d.champion) { const x = codable(d.champion); out.push(1, x.set, x.variant); number(x); } else out.push(0);
  return base32Encode(out);
}

// ---------- reading a deck ----------
// readDeck(text): a deck code, or a list of "2 Name" / "2x Name" lines, optionally under headers
// (Legend: Champion: MainDeck: Battlefields: Runes: Sideboard:, Piltover's text export). Without headers each card
// goes where its type says. -> {legend, champion, main: [card…] (one entry per copy, without the chosen champion),
// battlefields, runes, side, problems: [text…]}

const HEADERS = { legend: "legend", legends: "legend", champion: "champion", "chosen champion": "champion", maindeck: "main", "main deck": "main",
  main: "main", deck: "main", battlefields: "battlefields", battlefield: "battlefields", runes: "runes", rune: "runes", "rune deck": "runes",
  sideboard: "side", side: "side", "side deck": "side" };

function readDeck(input) {
  const text = input.trim();
  const problems = [];
  const entries = []; // {card, count, section, line}
  let chosen = null;
  if (/^[A-Z2-7]{8,}=*$/i.test(text)) { // a deck code: one word of base32
    let d;
    try { d = decodeDeckCode(text); } catch (e) { return { problems: [e.message] }; }
    if (d.unknownSets.length) problems.push(`unknown sets in the code (${d.unknownSets.join(", ")}): the card data may be older than the deck`);
    const add = (list, section) => {
      for (const { code, count } of list) {
        const card = cardByCode(code);
        if (card) entries.push({ card, count, section, line: code });
        else problems.push(`no card with the id ${code}`);
      }
    };
    add(d.main, null);
    add(d.legends.map((code) => ({ code, count: 1 })), null);
    add(d.side, "side");
    chosen = d.champion && cardByCode(d.champion);
  } else {
    let section = null;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("//")) continue;
      // a header: "MainDeck:", "Runes (12)", "Battlefields"
      const h = line.toLowerCase().replace(/\s*\(\d+\)\s*:?$/, "").replace(/[:\s]+$/, "");
      if (HEADERS[h] && !/^\d/.test(line)) { section = HEADERS[h]; continue; }
      // "2 Name", "2x Name", "Name x2", or just "Name"; a trailing printing "(OGN-027)" or "#OGN-027" is ignored
      let m = line.match(/^(\d+)\s*x?\s+(.+)$/i), count, name;
      if (m) [count, name] = [+m[1], m[2]];
      else if ((m = line.match(/^(.+?)\s+x(\d+)$/i))) [count, name] = [+m[2], m[1]];
      else [count, name] = [1, line];
      name = name.replace(/\s*\([A-Z]{2,4}-[\w*]+\)$/i, "").replace(/\s+#\S+$/, "").trim();
      const card = BY_NAME.get(name.toLowerCase()) || cardByCode(name);
      if (!card) { problems.push(`unknown card: "${line}"`); continue; }
      entries.push({ card, count, section, line });
      if (section === "champion") chosen = card;
    }
  }

  const deck = { legend: null, champion: null, main: [], battlefields: [], runes: [], side: [], problems };
  const legends = entries.filter((e) => e.card.type === "Legend" && e.section !== "side");
  deck.legend = legends[0]?.card ?? null;
  if (!deck.legend) problems.push("no legend");
  if (new Set(legends.map((e) => e.card.id)).size > 1) problems.push(`more than one legend: ${legends.map((e) => e.card.name).join(", ")} (the first one is used)`);
  // the chosen champion: the one named, otherwise the first champion unit of the legend's champion
  chosen ??= entries.find((e) => e.section !== "side" && e.card.supertype === "Champion" && e.card.type !== "Legend" && e.card.champion === deck.legend?.champion)?.card;
  let championTaken = false;
  for (const { card, count, section } of entries) {
    if (card.type === "Legend" && section !== "side") continue;
    for (let i = 0; i < count; i++) {
      if (section === "side") deck.side.push(card);
      else if (card.type === "Rune") deck.runes.push(card);
      else if (card.type === "Battlefield") deck.battlefields.push(card);
      else if (chosen && card.id === chosen.id && !championTaken) { deck.champion = card; championTaken = true; }
      else deck.main.push(card);
    }
  }
  if (chosen && !championTaken) deck.champion = chosen; // listed only under Champion: with the main deck not counting it
  checkDeck(deck);
  return deck;
}

// The deck building rules (Core Rules 103): main deck at least 40 counting the chosen champion, at most 3 of a name
// (champion included), at most 3 signature cards, 12 runes, 3 different battlefields, everything within the legend.
function checkDeck(d) {
  const p = d.problems, l = d.legend;
  const main = d.champion ? [d.champion, ...d.main] : d.main;
  if (!d.champion) p.push("no chosen champion");
  if (main.length < 40) p.push(`main deck has ${main.length} cards (with the champion), needs at least 40`);
  const names = {};
  for (const c of main) names[c.name] = (names[c.name] || 0) + 1;
  for (const [n, k] of Object.entries(names)) if (k > 3) p.push(`${k} copies of ${n} (at most 3)`);
  const sigs = main.filter((c) => c.supertype === "Signature").length;
  if (sigs > 3) p.push(`${sigs} signature cards (at most 3)`);
  if (d.runes.length !== 12) p.push(`${d.runes.length} runes (needs 12)`);
  if (d.battlefields.length && d.battlefields.length !== 3) p.push(`${d.battlefields.length} battlefields (needs 3)`);
  if (new Set(d.battlefields.map((c) => c.name)).size < d.battlefields.length) p.push("the same battlefield twice");
  if (l) {
    const bad = [...new Set([...main, ...d.runes, ...d.battlefields].filter((c) => !playable(c, l)).map((c) => c.name))];
    for (const n of bad) p.push(`${n} isn't playable with ${l.name}`);
  }
  return d;
}

// The deck as text in the same format readDeck reads (Piltover's text export)
function deckText(d) {
  const count = (list) => {
    const m = new Map();
    for (const c of list) m.set(c.name, (m.get(c.name) || 0) + 1);
    return [...m].map(([n, k]) => `${k} ${n}`).join("\n");
  };
  return [["Legend", d.legend ? [d.legend] : []], ["Champion", d.champion ? [d.champion] : []], ["MainDeck", d.main],
    ["Battlefields", d.battlefields], ["Runes", d.runes], ["Sideboard", d.side]]
    .filter(([, l]) => l.length).map(([h, l]) => `${h}:\n${count(l)}`).join("\n\n");
}
