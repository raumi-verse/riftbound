// Playsets, spares and the list being filed: node --test test/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const ctx = vm.createContext({ console });
ctx.window = ctx;
for (const f of ["web/settings.js", "web/cards.js", "web/query.js", "web/store.js", "web/deck.js", "web/collection.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), ctx, { filename: f });
const G = (n) => vm.runInContext(n, ctx);
const [COLL, ASIDE, KEEP, FILING, STORE, CARDS, sortOut, spares] = ["COLL", "ASIDE", "KEEP", "FILING", "STORE", "CARDS", "sortOut", "spares"].map(G);
const plain = (x) => JSON.parse(JSON.stringify(x));
const both = CARDS.find((c) => c.type === "Unit" && !c.supertype && c.rarity === "Common" && !c.printings[0].foil).id; // foil and not
const legend = CARDS.find((c) => c.type === "Legend").id, battlefield = CARDS.find((c) => c.type === "Battlefield" && !c.supertype).id;
const spiderling = CARDS.find((c) => c.name === "Spiderling").id;
const card = (id) => CARDS.find((c) => c.id === id);
const add = (id, counts) => { for (const [v, n] of Object.entries(counts)) COLL.add(id, n, v === "en" ? "" : v); };
const batch = (...items) => { const f = { items: [], done: [] }; for (const [id, ver, n] of items) { COLL.add(id, n, ver); FILING.put(f, { id, n, ver }); } return f; };

beforeEach(() => STORE.wipe());

test("the playset: 3, 1 of legends and battlefields, all of Spiderling and tokens", () => {
  assert.equal(KEEP.limit(card(both)), 3);
  assert.equal(KEEP.limit(card(legend)), 1);
  assert.equal(KEEP.limit(card(battlefield)), 1);
  assert.equal(KEEP.limit(card(spiderling)), Infinity);
  KEEP.setAll(card(both), true);
  assert.equal(KEEP.limit(card(both)), Infinity);
  KEEP.setAll(card(both), false);
  assert.equal(STORE.get("keep", both), null); // the rule's own answer isn't kept
  KEEP.setAll(card(spiderling), false);
  assert.equal(KEEP.limit(card(spiderling)), 3);
});

test("English, English foil, Chinese, Chinese foil; or the foils first", () => {
  assert.deepEqual(plain(KEEP.order()).slice(0, 4), ["", "foil", "zh", "zh-foil"]);
  add(both, { en: 2, foil: 2, zh: 1 });
  assert.deepEqual(plain(spares().out.map((x) => [x.ver, x.n])), [["foil", 1], ["zh", 1]]);
  KEEP.setFoilFirst(true);
  assert.deepEqual(plain(KEEP.order()).slice(0, 4), ["foil", "", "zh-foil", "zh"]);
});

test("a batch: the first 3 into the box, the rest aside", () => {
  add(both, { zh: 2 });
  const f = batch([both, "zh", 2]);
  assert.deepEqual(plain(sortOut(f.items)), [{ box: 1, aside: 1, out: {} }]);
  assert.equal(FILING.tick(f, f.items[0], true).n, 1);
  assert.equal(ASIDE.v(both, "zh"), 1);
  assert.deepEqual(plain(f.items), [{ id: both, n: 1, ver: "zh" }]);
  FILING.tick(f, f.items[0], false);
  assert.equal(f.items.length, 0);
  assert.equal(spares().out.length, 0);
  assert.deepEqual(plain(spares().aside.map((x) => [x.id, x.ver, x.n])), [[both, "zh", 1]]);
  assert.equal(COLL.n(both), 4); // spares still count as yours
});

test("better copies push others out of the box; whatever is ticked first", () => {
  for (const zhFirst of [true, false]) {
    STORE.wipe();
    add(both, { zh: 1 });
    const f = batch([both, "zh", 2], [both, "", 2]);
    assert.deepEqual(plain(sortOut(f.items)), [{ box: 0, aside: 2, out: {} }, { box: 2, aside: 0, out: {} }]);
    const [zh, en] = f.items;
    if (zhFirst) FILING.tick(f, zh, true);
    assert.deepEqual(plain(FILING.tick(f, en, false).out), {}); // the box has just the one
    if (!zhFirst) FILING.tick(f, zh, true);
    assert.deepEqual([ASIDE.v(both, "zh"), ASIDE.v(both, "")], [2, 0]);
    assert.deepEqual([spares().out.length, spares().back.length], [0, 0]);
  }
  STORE.wipe();
  add(both, { zh: 3 });
  const f = batch([both, "foil", 2]);
  assert.deepEqual(plain(sortOut(f.items)), [{ box: 2, aside: 0, out: { zh: 2 } }]);
  const d = FILING.tick(f, f.items[0], false);
  assert.equal(ASIDE.v(both, "zh"), 2);
  FILING.untick(f, d);
  assert.equal(ASIDE.v(both, "zh"), 0);
  assert.deepEqual(plain(f), { items: [{ id: both, n: 2, ver: "foil" }], done: [] });
});

test("cards still in the scan's tally, not counted yet", () => {
  add(both, { en: 2 });
  const t = (ver) => ({ id: both, n: 1, ver, isNew: true });
  assert.deepEqual(plain(sortOut([t(""), t(""), t("zh")]).map((r) => r.box)), [1, 0, 0]);
  assert.deepEqual(plain(sortOut([{ id: legend, n: 1, ver: "foil", isNew: true }, { id: legend, n: 1, ver: "foil", isNew: true }]).map((r) => r.box)), [1, 0]);
});

test("correcting an entry moves the copies", () => {
  const f = batch([both, "", 3]);
  FILING.edit(f, { id: both, n: 3, ver: "" }, both, { "": 1, zh: 2 });
  assert.deepEqual(plain(f.items), [{ id: both, n: 1, ver: "" }, { id: both, n: 2, ver: "zh" }]);
  assert.deepEqual([COLL.v(both, ""), COLL.v(both, "zh"), COLL.n(both)], [1, 2, 3]);
  FILING.edit(f, { id: both, n: 2, ver: "zh" }, spiderling, { zh: 2 });
  assert.deepEqual([COLL.n(both), COLL.n(spiderling)], [1, 2]);
  FILING.edit(f, { id: both, n: 1, ver: "" }, both, {});
  assert.equal(COLL.n(both), 0);
  assert.deepEqual(plain(f.items), [{ id: spiderling, n: 2, ver: "zh" }]);
});

test("keeping every copy brings spares back; sold ones don't come back", () => {
  add(both, { en: 5 });
  assert.equal(spares().out[0].n, 2);
  ASIDE.add(both, "", 2);
  assert.equal(spares().out.length, 0);
  KEEP.setAll(card(both), true);
  assert.equal(spares().back[0].n, 2);
  KEEP.setAll(card(both), false);
  COLL.set(both, 0);
  COLL.set(both, 3);
  assert.equal(ASIDE.v(both, ""), 0);
});

test("a list saved before spares were", () => {
  const f = plain(FILING.read({ items: [{ id: both, n: 1, ver: "" }, { id: legend, n: 1, ver: "foil" }], done: [1] }));
  assert.deepEqual(f.items, [{ id: both, n: 1, ver: "" }]);
  assert.equal(f.done[0].id, legend);
  assert.deepEqual(plain(FILING.read(null)), { items: [], done: [] });
});
