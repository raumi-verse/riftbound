// Decks and the goldfish simulator on the real cards: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const ctx = vm.createContext({});
ctx.window = ctx;
for (const f of ["web/settings.js", "web/cards.js", "web/query.js", "web/deck.js", "web/sim.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), ctx, { filename: f });
const G = (name) => vm.runInContext(name, ctx);
const readDeck = G("readDeck"), deckText = G("deckText"), decodeDeckCode = G("decodeDeckCode"), encodeDeckCode = G("encodeDeckCode"), goldfish = G("goldfish"), runeSplits = G("runeSplits");
const CARDS = G("CARDS"), playable = G("playable");

// A legal 40-card Jinx deck from the card data: the legend, a champion unit x3, 12 other cards x3 and one x1, 6/6 runes,
// 3 battlefields
const legend = CARDS.find((c) => c.type === "Legend" && c.champion === "Jinx");
const champion = CARDS.find((c) => c.supertype === "Champion" && c.type === "Unit" && c.champion === "Jinx");
const fillers = CARDS.filter((c) => ["Unit", "Spell", "Gear"].includes(c.type) && !c.supertype && !c.banned && playable(c, legend)).slice(0, 13);
const bfs = CARDS.filter((c) => c.type === "Battlefield" && !c.banned).slice(0, 3);
const rune = (d) => CARDS.find((c) => c.type === "Rune" && c.name === `${d} Rune`);
const list = (runesA = 6) => [
  "Legend:", `1 ${legend.name}`, "Champion:", `1 ${champion.name}`, "MainDeck:", `2 ${champion.name}`, ...fillers.map((c, i) => `${i < 12 ? 3 : 1} ${c.name}`),
  "Battlefields:", ...bfs.map((c) => `1 ${c.name}`), "Runes:", `${runesA} ${legend.domains[0]} Rune`, `${12 - runesA} ${legend.domains[1]} Rune`,
].join("\n");

test("a legal list reads without problems", () => {
  const d = readDeck(list());
  assert.deepEqual([...d.problems], []);
  assert.equal(d.legend.id, legend.id);
  assert.equal(d.champion.id, champion.id);
  assert.equal(d.main.length, 39); // the 40 without the chosen champion
  assert.equal(d.runes.length, 12);
  assert.equal(d.battlefields.length, 3);
});

test("the list round-trips through deckText", () => {
  const d = readDeck(list()), again = readDeck(deckText(d));
  assert.deepEqual([...again.problems], []);
  assert.equal(deckText(again), deckText(d));
});

test("without headers cards go where their type says", () => {
  const d = readDeck(list().split("\n").filter((l) => !l.endsWith(":")).join("\n"));
  assert.equal(d.legend.id, legend.id);
  assert.equal(d.champion.id, champion.id); // the first champion unit of the legend's champion
  assert.equal(d.runes.length, 12);
  assert.equal(d.battlefields.length, 3);
  assert.deepEqual([...d.problems], []);
});

test("illegal decks say why", () => {
  const off = CARDS.find((c) => c.type === "Unit" && !c.supertype && !c.banned && !playable(c, legend));
  const has = (text, re) => assert.ok(readDeck(text).problems.some((p) => re.test(p)), `${re} in ${readDeck(text).problems}`);
  has(list().replace(`3 ${fillers[0].name}`, `4 ${fillers[0].name}`), /4 copies/);
  has(list().replace(`3 ${fillers[0].name}`, `2 ${fillers[0].name}`), /needs at least 40/);
  has(list().replace(`3 ${fillers[0].name}`, `3 ${off.name}`), /isn't playable/);
  has(list(5).replace(/^5 /m, "4 "), /11 runes/);
  has(list() + "\n1 Not A Real Card", /unknown card/);
  has(list().replace(/Legend:\n.*\n/, ""), /no legend/);
});

// ---------- deck codes: the same vectors as riftbound-tts/tests/test_deckcodes.lua ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32(bytes) {
  let out = "", buffer = 0, bits = 0;
  for (const b of bytes) {
    buffer = buffer * 256 + b; bits += 8;
    while (bits >= 5) { bits -= 5; out += B32[Math.floor(buffer / 2 ** bits) % 32]; buffer %= 2 ** bits; }
  }
  if (bits > 0) out += B32[(buffer * 2 ** (5 - bits)) % 32];
  return out;
}
function varint(n, out) { while (n >= 128) { out.push((n % 128) + 128); n = Math.floor(n / 128); } out.push(n); }
const plain = (x) => JSON.parse(JSON.stringify(x));

test("deck code version 1", () => {
  const b = [0x11];
  for (let count = 12; count >= 1; count--) {
    if (count === 3) { varint(1, b); varint(1, b); b.push(0, 0); varint(7, b); }
    else if (count === 1) { varint(1, b); varint(1, b); b.push(0, 0); varint(8, b); }
    else varint(0, b);
  }
  const d = plain(decodeDeckCode(b32(b)));
  assert.equal(d.version, 1);
  assert.deepEqual(d.main, [{ code: "OGN-007", count: 3 }, { code: "OGN-008", count: 1 }]);
  assert.deepEqual(d.side, []);
});

test("deck code version 5: sparse, runes, champion", () => {
  const b = [0x15, 1];
  varint(1, b); varint(2, b); varint(1, b);
  varint(2, b); b.push(4, 1);
  b.push(0); varint(2, b);
  b.push(1); varint(1, b);
  varint(0, b);
  b.push(1, 4, 0, 0); varint(9, b);
  const d = plain(decodeDeckCode(b32(b)));
  assert.deepEqual(d.main, [{ code: "UNL-002a", count: 2 }, { code: "UNL-R01a", count: 2 }]);
  assert.equal(d.champion, "UNL-009");
});

test("deck code version 6: additional legends", () => {
  const b = [0x16, 0];
  varint(0, b); varint(0, b); b.push(0); varint(1, b); b.push(0, 0); varint(5, b);
  assert.deepEqual(plain(decodeDeckCode(b32(b)).legends), ["OGN-005"]);
});

test("deck code errors and unknown sets", () => {
  assert.throws(() => decodeDeckCode("not a deck code!"), /Invalid character/);
  assert.throws(() => decodeDeckCode(""), /ended early/);
  assert.throws(() => decodeDeckCode(b32([0x17])), /version 7/);
  assert.throws(() => decodeDeckCode(b32([0x21])), /format 2/);
  const b = [0x11];
  for (let count = 12; count >= 1; count--) {
    if (count === 2) { varint(1, b); varint(2, b); b.push(9, 0); varint(12, b); varint(13, b); }
    else varint(0, b);
  }
  const d = plain(decodeDeckCode(b32(b)));
  assert.equal(d.main[0].code, "SET9-012");
  assert.deepEqual(d.unknownSets, [9]);
});

test("readDeck takes a deck code and maps printing ids to cards", () => {
  const b = [0x11];
  for (let count = 12; count >= 1; count--) {
    if (count === 3) { varint(1, b); varint(1, b); b.push(0, 0); varint(7, b); } // 3 Fury Rune (OGN-007)
    else varint(0, b);
  }
  const d = readDeck(b32(b));
  assert.equal(d.runes.length, 3);
  assert.equal(d.runes[0].name, "Fury Rune");
  assert.ok(d.problems.some((p) => /no legend/.test(p)));
});

test("encodeDeckCode gives a code that reads back as the same deck", () => {
  const d = readDeck(list());
  const code = encodeDeckCode(d);
  assert.match(code, /^[A-Z2-7]+$/);
  const back = readDeck(code);
  assert.deepEqual([...back.problems], []);
  const lines = (x) => deckText(x).split("\n").sort();
  assert.deepEqual(lines(back), lines(d));
  assert.equal(back.champion.id, d.champion.id);
  const raw = plain(decodeDeckCode(code));
  assert.equal(raw.version, 5);
  assert.equal(raw.main.find((e) => e.code === legend.id).count, 1);
  assert.equal(raw.main.find((e) => e.code === champion.id).count, 3); // the chosen one is in the main section too
});

test("encodeDeckCode: runes with R numbers, alt printings, the side deck", () => {
  const fury = CARDS.find((c) => c.name === "Fury Rune");
  const sfdRune = { ...fury, id: "SFD-R01" }; // as if its base printing were the Spiritforged one
  const promoOnly = CARDS.find((c) => !/^(OGN|OGS|ARC|SFD|UNL|VEN|RAD)-/.test(c.id) && c.printings.some((p) => /^(OGN|SFD|UNL)-\d+$/.test(p.id)));
  const d = { legend, champion, main: [], battlefields: [], runes: [sfdRune, sfdRune], side: [fillers[0]], problems: [] };
  if (promoOnly) d.main.push(promoOnly);
  const raw = plain(decodeDeckCode(encodeDeckCode(d)));
  assert.deepEqual(raw.main.find((e) => e.code === sfdRune.id), { code: sfdRune.id, count: 2 });
  assert.deepEqual(raw.side, [{ code: fillers[0].id, count: 1 }]);
  if (promoOnly) assert.ok(raw.main.some((e) => promoOnly.printings.some((p) => p.id === e.code)));
  const token = { name: "Nowhere", id: "XYZ-001", printings: [] };
  assert.throws(() => encodeDeckCode({ ...d, main: [token] }), /no printing/);
});

// ---------- the simulator against exact maths ----------
const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; };
const deck = readDeck(list());

test("a 3-of in the opening 4 of the 39 drawable cards", () => {
  const r = goldfish(deck, { games: 40000, turns: 1, mulliganMax: 0, firstPlayerDraws: false, seed: 7 });
  const c = r.cards.find((x) => x.card.id === fillers[0].id);
  const exact = 1 - C(36, 4) / C(39, 4);
  assert.ok(Math.abs(c.seen[0] - exact) < 0.01, `${c.seen[0]} vs ${exact}`);
});

test("both domains on turn 1 with 6/6 runes: 2 runes first, 3 second", () => {
  const first = goldfish(deck, { games: 40000, turns: 1, seed: 3 }), second = goldfish(deck, { games: 40000, turns: 1, second: true, seed: 3 });
  assert.ok(Math.abs(first.turn.bothDomains[0] - (1 - (2 * C(6, 2)) / C(12, 2))) < 0.01, `${first.turn.bothDomains[0]}`);
  assert.ok(Math.abs(second.turn.bothDomains[0] - (1 - (2 * C(6, 3)) / C(12, 3))) < 0.01, `${second.turn.bothDomains[0]}`);
});

test("the chosen champion is always available and runes grow by 2 a turn", () => {
  const r = goldfish(deck, { games: 2000, turns: 3 });
  const c = r.cards.find((x) => x.champion);
  assert.deepEqual([...c.seen], [1, 1, 1]);
  assert.ok(Math.abs(r.turn.runes[0] - 2) < 1e-9);
  assert.ok(r.turn.runes[2] <= 6 && r.turn.runes[2] > 4); // fewer when power was paid by recycling
});

test("the same seed gives the same result", () => {
  assert.deepEqual(plain(goldfish(deck, { games: 3000, seed: 42 })), plain(goldfish(deck, { games: 3000, seed: 42 })));
});

test("rune splits: every split once, the deck's own marked, none of one domain only better than all", () => {
  const s = runeSplits(deck, { games: 1500 });
  assert.equal(s.length, 13);
  assert.equal(s.filter((x) => x.current).length, 1);
  assert.ok(s.every((x) => Number.isFinite(x.paid) && x.screwed >= 0));
});
