// Decks, versions and matches in the store: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const ctx = vm.createContext({ console });
ctx.window = ctx;
for (const f of ["web/settings.js", "web/cards.js", "web/query.js", "web/store.js", "web/deck.js", "web/collection.js", "web/library.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), ctx, { filename: f });
const G = (n) => vm.runInContext(n, ctx);
const LIB = G("LIB"), record = G("record"), recordBy = G("recordBy"), diffLists = G("diffLists"), missing = G("missing"), COLL = G("COLL");
const plain = (x) => JSON.parse(JSON.stringify(x));

const base = "Legend:\n1 Jinx, Loose Cannon\nChampion:\n1 Jinx, Demolitionist\nMainDeck:\n2 Jinx, Demolitionist\n3 Blazing Scorcher\nRunes:\n6 Fury Rune\n6 Chaos Rune";

test("a deck and its versions", () => {
  const a = LIB.save(null, base);
  assert.ok(a.created);
  const d = LIB.deck(a.deck);
  assert.equal(d.name, "Jinx, Loose Cannon");
  assert.equal(d.status, "active");
  assert.equal(d.legend, "OGN-251");
  const v1 = LIB.version(d.version);
  assert.equal(v1.n, 1);
  assert.match(v1.code, /^[A-Z2-7]+$/);
  assert.equal(v1.ids.split(" ").length, 1 + 1 + 2 + 3 + 12);
  // the same list: no new version, but the fields change
  const same = LIB.save(a.deck, base, { name: "Jinx aggro" });
  assert.equal(same.created, false);
  assert.equal(LIB.deck(a.deck).name, "Jinx aggro");
  // a changed list: version 2
  const b = LIB.save(a.deck, base.replace("3 Blazing Scorcher", "2 Blazing Scorcher\n1 Get Excited!"));
  assert.ok(b.created);
  assert.deepEqual(plain(LIB.versions(a.deck).map((v) => v.n)), [1, 2]);
  assert.deepEqual(plain(diffLists(v1.list, LIB.version(b.version).list)), [{ name: "Get Excited!", delta: 1 }, { name: "Blazing Scorcher", delta: -1 }]);
  LIB.setDeck(a.deck, { status: "pinned" });
  assert.equal(LIB.deck(a.deck).status, "pinned");
  assert.equal(LIB.deck(a.deck).name, "Jinx aggro");
  LIB.removeDeck(a.deck);
  assert.equal(LIB.deck(a.deck), null);
  assert.deepEqual(plain(LIB.versions(a.deck)), []);
});

test("matches and records", () => {
  const { deck, version } = LIB.save(null, base);
  const m1 = LIB.saveMatch(null, { deck, deckver: version, result: "win", first: true, oppLegend: "OGN-249", date: "2026-11-01T10:00:00Z" });
  LIB.saveMatch(null, { deck, deckver: version, result: "loss", first: false, oppLegend: "OGN-249", date: "2026-11-02T10:00:00Z" });
  LIB.saveMatch(null, { deck, deckver: version, result: "draw", first: true, oppLegend: "OGN-251", date: "2026-11-03T10:00:00Z" });
  const ms = LIB.matches(deck);
  assert.equal(ms[0].result, "draw"); // newest first
  const r = plain(record(ms));
  assert.deepEqual([r.win, r.loss, r.draw, r.n], [1, 1, 1, 3]);
  assert.equal(r.pct, 0.5);
  assert.deepEqual(plain(recordBy(ms, (m) => m.oppLegend)).map((x) => [x.key, x.n]), [["OGN-249", 2], ["OGN-251", 1]]);
  LIB.saveMatch(m1, { notes: "they flooded" });
  assert.equal(G("STORE").get("match", m1).notes, "they flooded");
  assert.equal(G("STORE").get("match", m1).result, "win"); // the rest kept
});

test("cardIdOf: a legend from the table as any printing", () => {
  const cardIdOf = G("cardIdOf");
  assert.equal(cardIdOf("OGN-251"), "OGN-251");
  assert.equal(cardIdOf("ogn-030a"), "OGN-030");
  assert.equal(cardIdOf(null), null);
  assert.equal(cardIdOf("XYZ-1"), "XYZ-1");
});

test("missing cards against the collection, any printing counting", () => {
  COLL.set("OGN-030a", 2); // two Jinx, Demolitionist in the alt art
  COLL.set("OGN-007", 6);
  const m = Object.fromEntries(missing(base).map((x) => [x.card.name, [x.need, x.have]]));
  assert.deepEqual(m["Jinx, Demolitionist"], [3, 2]);
  assert.equal(m["Fury Rune"], undefined);
  assert.deepEqual(m["Chaos Rune"], [6, 0]);
});

test("a game: points by kind, undo, turns, winner, best of 3", () => {
  const GAME = G("GAME");
  const { deck } = LIB.save(null, base);
  let g = GAME.start({ deck, first: true, target: 3, bo: 3 });
  assert.equal(GAME.mine(g), true);
  g = GAME.point(g, "me", "conquer");
  g = GAME.point(g, "opp", "hold");
  g = GAME.nextTurn(g);
  assert.equal(GAME.mine(g), false);
  g = GAME.point(g, "me", "hold");
  g = GAME.point(g, "opp", "extra", -1); // nothing to take away
  assert.equal(GAME.total(g, "me"), 2);
  g = GAME.point(g, "me", "extra");
  assert.equal(GAME.winner(g), "me");
  g = GAME.undo(g);
  assert.equal(GAME.winner(g), null);
  g = GAME.undo(g); g = GAME.undo(g); // the hold, then the turn
  assert.equal(g.turn, 1);
  assert.deepEqual(plain(g.me), { conquer: 1, hold: 0, extra: 0 });
  const m = plain(GAME.toMatch(g, "loss"));
  assert.equal(m.deck, deck);
  assert.equal(m.game, 1);
  assert.deepEqual(m.log.map((l) => l.kind), ["conquer", "hold"]);
  // lost game 1: game 2, I go first; won game 2 and 3: done
  const g2 = GAME.next(g, "loss", "m1");
  assert.equal(g2.game, 2);
  assert.equal(g2.first, true);
  assert.deepEqual(plain(g2.wins), { me: 0, opp: 1 });
  assert.equal(GAME.total(g2, "me"), 0);
  const g3 = GAME.next(g2, "win", "m2");
  assert.equal(g3.game, 3);
  assert.equal(g3.first, false);
  assert.equal(GAME.next(g3, "win", "m3"), null);
  assert.equal(GAME.next(GAME.start({ deck, bo: 1 }), "win", "x"), null);
});
