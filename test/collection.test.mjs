// Quick entry and pasted lists for the collection: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const ctx = vm.createContext({ console });
ctx.window = ctx;
for (const f of ["web/settings.js", "web/cards.js", "web/query.js", "web/store.js", "web/deck.js", "web/collection.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), ctx, { filename: f });
const G = (n) => vm.runInContext(n, ctx);
const parseEntry = G("parseEntry"), parseBulk = G("parseBulk"), COLL = G("COLL"), encodeDeckCode = G("encodeDeckCode"), readDeck = G("readDeck");
const plain = (x) => JSON.parse(JSON.stringify(x));
const entry = (s, last) => { const e = parseEntry(s, last); return e.error != null ? e.error : `${e.id} ${e.n}`; };

test("quick entry", () => {
  assert.equal(entry("ogn 7"), "OGN-007 1");
  assert.equal(entry("OGN-007"), "OGN-007 1");
  assert.equal(entry("ogn-7a"), "OGN-007a 1");
  assert.equal(entry("ogn7 3"), "OGN-007 3");
  assert.equal(entry("ogn 7 x3"), "OGN-007 3");
  assert.equal(entry("OGN-007x3"), "OGN-007 3");
  assert.equal(entry("3x ogn 7"), "OGN-007 3");
  assert.equal(entry("sfd r1"), "SFD-R01 1");
  assert.equal(entry("sfd r01 -1"), "SFD-R01 -1");
  assert.equal(entry("-ogn 7"), "OGN-007 -1");
  assert.equal(entry("ogn 300*"), "OGN-300* 1");
  assert.equal(entry("ogn 300s"), "OGN-300* 1");
  assert.equal(entry("7", "OGN"), "OGN-007 1");
  assert.equal(entry("7 2", "OGN"), "OGN-007 2");
  assert.equal(entry("ogn-151b-nexus"), "OGN-151b-Nexus 1");
  assert.match(entry("7"), /which set/);
  assert.match(entry("xyz 7"), /no set XYZ/);
  assert.match(entry("ogn 888"), /no card OGN 888/);
  assert.match(entry("hello world"), /e\.g\./);
});

test("pasted lists: quick entries, ids, names, headers, printing hints", () => {
  const r = plain(parseBulk("# my binder\nogn 7 2\n8\nOGN-007a\n2 Jinx, Demolitionist\nBlazing Scorcher x2\nMainDeck:\n1 Jinx, Demolitionist (OGN-030a)\nnope nope"));
  const by = Object.fromEntries(r.items.map((i) => [i.id, i.n]));
  assert.equal(by["OGN-007"], 2);
  assert.equal(by["OGN-008"], 1); // the set of the line before
  assert.equal(by["OGN-007a"], 1);
  assert.equal(by["OGN-030"], 2);
  assert.equal(by["OGN-030a"], 1);
  assert.equal(r.items.find((i) => i.card.name === "Blazing Scorcher").n, 2);
  assert.deepEqual(r.problems, ['not found: "nope nope"']);
});

test("pasted CSV: this page's export and id,count", () => {
  let r = plain(parseBulk('name,id,set,own\n"Jinx, Demolitionist",OGN-030,OGN,2\nFury Rune,OGN-007,OGN,0\n'));
  assert.deepEqual(r.items.map((i) => [i.id, i.n]), [["OGN-030", 2]]);
  r = plain(parseBulk("id,count\nogn-007,12\nnope-1,1"));
  assert.deepEqual(r.items.map((i) => [i.id, i.n]), [["OGN-007", 12]]);
  assert.equal(r.problems.length, 1);
});

test("a pasted deck code: every card of the deck once per copy", () => {
  const d = readDeck("Legend:\n1 Jinx, Loose Cannon\nChampion:\n1 Jinx, Demolitionist\nMainDeck:\n2 Jinx, Demolitionist\nRunes:\n6 Fury Rune\n6 Chaos Rune");
  const r = plain(parseBulk(encodeDeckCode(d)));
  const by = Object.fromEntries(r.items.map((i) => [i.card.name, i.n]));
  assert.equal(by["Jinx, Demolitionist"], 3);
  assert.equal(by["Fury Rune"], 6);
  assert.equal(by["Jinx, Loose Cannon"], 1);
});

test("COLL counts in the store", () => {
  assert.equal(COLL.add("OGN-007", 2), 2);
  assert.equal(COLL.add("OGN-007", -5), 0); // never below 0, and gone from the store
  assert.equal(G("STORE").get("coll", "OGN-007"), null);
  COLL.apply([{ id: "OGN-008", n: 3 }, { id: "OGN-009", n: 1 }]);
  COLL.apply([{ id: "OGN-008", n: 1 }], "set");
  assert.equal(COLL.n("OGN-008"), 1);
  assert.equal(COLL.n("OGN-009"), 1);
});
