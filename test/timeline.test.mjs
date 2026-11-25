// The timeline: what was done, undone on its own: node --test test/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const ctx = vm.createContext({ console });
ctx.window = ctx;
const ls = new Map();
ctx.localStorage = { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), key: (i) => [...ls.keys()][i], get length() { return ls.size; } };
for (const f of ["web/settings.js", "web/cards.js", "web/query.js", "web/store.js", "web/deck.js", "web/collection.js", "web/timeline.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), ctx, { filename: f });
const [COLL, ASIDE, FILING, STORE, CARDS, FILE, TIMELINE] = ["COLL", "ASIDE", "FILING", "STORE", "CARDS", "FILE", "TIMELINE"].map((n) => vm.runInContext(n, ctx));
const plain = (x) => JSON.parse(JSON.stringify(x));
const [a, b] = CARDS.filter((c) => c.type === "Unit" && !c.supertype && c.rarity === "Common" && !c.printings[0].foil).map((c) => c.id);

const scan = (...items) => TIMELINE.record("add", "Scanned", () => { COLL.apply(items); const f = { items: FILE.get().items, done: [] }; for (const i of items) FILING.put(f, i); FILE.set(f); });
const tick = (i, aside) => TIMELINE.record("tick", "", () => { const f = FILE.get(); FILING.tick(f, f.items[i], aside); FILE.set(f); });
const allFiled = () => TIMELINE.record("file", "All filed", () => { const f = FILE.get(); for (let i; (i = f.items[0]); ) if (!FILING.tick(f, i, false) && !FILING.tick(f, i, true)) f.items.shift(); f.done = []; FILE.set(f); });
const all = () => plain({ coll: STORE.all("coll").map((r) => [r.id, r.data]), aside: STORE.all("aside").map((r) => [r.id, r.data]), file: { items: FILE.get().items, done: FILE.get().done.map((d) => d.k) } });

beforeEach(() => { STORE.wipe(); ls.clear(); });

test("All filed by accident: undone, and the list, the ticks and the spares are back; done again", () => {
  COLL.add(a, 3, "zh");
  scan({ id: a, n: 2, ver: "" }, { id: b, n: 5, ver: "zh" });
  tick(1, true);
  const before = all();
  const k = allFiled();
  const after = all();
  assert.equal(after.file.items.length, 0);
  assert.equal(ASIDE.v(a, "zh"), 2);
  TIMELINE.toggle(k);
  assert.deepEqual(all(), before);
  TIMELINE.toggle(k, true); // a toast's Undo, pressed late
  assert.deepEqual(all(), before);
  TIMELINE.toggle(k);
  assert.deepEqual(all(), after);
});

test("an older event undone keeps what came after", () => {
  const k = scan({ id: a, n: 1, ver: "" });
  scan({ id: b, n: 2, ver: "zh" }, { id: a, n: 1, ver: "" });
  TIMELINE.toggle(k);
  assert.deepEqual([COLL.n(a), COLL.n(b)], [1, 2]);
  assert.deepEqual(plain(FILE.get().items), [{ id: a, n: 1, ver: "" }, { id: b, n: 2, ver: "zh" }]);
});

test("undone where some of it is gone: done again gives back only what it took", () => {
  const k = scan({ id: a, n: 3, ver: "" });
  COLL.add(a, -2);
  TIMELINE.toggle(k);
  assert.equal(COLL.n(a), 0);
  TIMELINE.toggle(k);
  assert.equal(COLL.n(a), 1);
});

test("a tick is undone once, from the list or the timeline", () => {
  scan({ id: a, n: 1, ver: "" });
  const k = tick(0, false), d = FILE.get().done[0];
  assert.equal(TIMELINE.ofTick(d.k).k, k);
  TIMELINE.toggle(k);
  assert.equal(TIMELINE.ofTick(d.k), undefined);
  assert.deepEqual(all().file, { items: [{ id: a, n: 1, ver: "" }], done: [] });
});

test("spares that were sold", () => {
  COLL.add(a, 5);
  ASIDE.add(a, "", 2);
  const before = all();
  const k = TIMELINE.record("edit", "sold", () => { ASIDE.add(a, "", -2); COLL.add(a, -2); });
  assert.deepEqual([COLL.n(a), ASIDE.v(a, "")], [3, 0]);
  TIMELINE.toggle(k);
  assert.deepEqual(all(), before);
});

test("+ and − on a card one after another are one entry, none if they cancel", () => {
  const add = (id, n, v = "") => TIMELINE.record("count", "", () => COLL.add(id, n, v));
  add(a, 1); add(a, 1); add(a, 1, "zh"); add(b, 1);
  assert.deepEqual(plain(TIMELINE.all().map((e) => e.d.coll)), [{ [a]: { "": 2, zh: 1 } }, { [b]: { "": 1 } }]);
  add(b, -1);
  assert.equal(TIMELINE.all().length, 1);
  assert.equal(TIMELINE.record("edit", "nothing", () => {}), null);
});

test("a batch from before the timeline, on the list again", () => {
  COLL.apply([{ id: a, n: 5, ver: "zh" }, { id: b, n: 1, ver: "" }]);
  ASIDE.add(a, "zh", 2); // what All filed put there
  const [x] = TIMELINE.batches();
  assert.deepEqual(plain(x.ids).sort(), [a, b].sort());
  const k = TIMELINE.record("file", "again", () => TIMELINE.refile(x.ids));
  assert.deepEqual(plain(FILE.get().items).sort((p, q) => q.n - p.n), [{ id: a, n: 3, ver: "zh", guess: true }, { id: b, n: 1, ver: "" }].sort((p, q) => q.n - p.n));
  assert.deepEqual([COLL.n(a), ASIDE.v(a, "zh")], [5, 0]);
  const f = FILE.get();
  FILING.edit(f, { id: a, n: 3, ver: "zh", guess: true }, a, { zh: 2 }); // a guess corrected leaves the counts
  assert.equal(COLL.n(a), 5);
  TIMELINE.toggle(k);
  assert.deepEqual([FILE.get().items.length, ASIDE.v(a, "zh")], [0, 2]);
});

test("another account's entries aren't offered", () => {
  STORE.setOwner("one");
  scan({ id: a, n: 1, ver: "" });
  STORE.setOwner("two");
  assert.equal(TIMELINE.all().length, 0);
});
