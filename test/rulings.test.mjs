// Foil as printed, errata and ruling notes: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const el = { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null };
const ctx = vm.createContext({ console, URL, document: el });
ctx.window = ctx;
for (const f of ["settings", "ui", "cards", "query", "store", "deck", "collection", "cardtext", "rulings"]) vm.runInContext(readFileSync(new URL(`web/${f}.js`, root), "utf8"), ctx, { filename: f });
const G = (n) => vm.runInContext(n, ctx);
const COLL = G("COLL"), STORE = G("STORE"), autoVer = G("autoVer"), CARDS = G("CARDS");
const prints = CARDS.flatMap((c) => c.printings), of = (f) => prints.find((p) => p.foil === f).id;
const raw = (id) => JSON.parse(JSON.stringify(STORE.get("coll", id)));

test("foil as the printing exists", () => {
  const only = of("only"), no = of("no"), both = of(undefined);
  assert.equal(autoVer(only), "foil"); assert.equal(autoVer(only, "zh"), "zh-foil"); assert.equal(autoVer(only, "foil"), "foil");
  assert.equal(autoVer(no, "foil"), ""); assert.equal(autoVer(no, "zh-foil"), "zh");
  assert.equal(autoVer(both), ""); assert.equal(autoVer(both, "foil"), "foil"); assert.equal(autoVer(both, "ko"), "ko");
  // nearly every rare and epic is foil only
  const hi = prints.filter((p) => ["Rare", "Epic"].includes(p.rarity) && !p.kind);
  assert.ok(hi.filter((p) => p.foil === "only").length > hi.length * 0.9);
});

test("pasted lists and totals take the version that exists, unless said", () => {
  const only = of("only");
  COLL.apply(G("parseBulk")(`${only}`).items);
  assert.deepEqual(raw(only), { n: 1, x: { foil: 1 } });
  COLL.set(only, 3);
  assert.deepEqual(raw(only), { n: 3, x: { foil: 3 } });
  COLL.add(only, 1, "zh"); // by hand anything goes
  assert.equal(COLL.v(only, "zh"), 1);
  assert.deepEqual(Array.from(G("wrongFoils")(), (x) => [x.id, x.n, x.from, x.to]), [[only, 1, "zh", "zh-foil"]]);
});

test("errata: marked, their header gone from the text", () => {
  const e = CARDS.filter((c) => c.errata);
  assert.ok(e.length >= 60);
  for (const c of CARDS) assert.doesNotMatch(c.text, /Card Errata Text/, c.name);
  assert.equal(G("run")("is:errata").count, e.length);
  assert.match(G("errataLine")(e[0]), /errata/);
  assert.equal(G("errataLine")(CARDS.find((c) => !c.errata)), "");
});

test("notes: per card, newest first, harmless to show", () => {
  const c = CARDS.find((x) => x.name === "Sky Splitter");
  STORE.put("ruling", "a", { card: c.id, text: "<img src=x onerror=1>\nsecond", url: "javascript:alert(1)", created: "2026-11-01T00:00:00Z" });
  STORE.put("ruling", "b", { card: c.id, text: "newer", url: "https://www.example.org/x?a=1&b=\"2", created: "2026-11-02T00:00:00Z" });
  assert.deepEqual(Array.from(G("rulingsOf")(c.id), (r) => r.id), ["b", "a"]);
  const h = G("rulingsHtml")(c);
  assert.doesNotMatch(h, /<img|href="javascript/);
  assert.match(h, /&lt;img/); assert.match(h, /example\.org/);
  assert.equal(G("run")("is:ruling").count, 1);
  assert.match(h, /runeweave\.com\/card\/sky-splitter"/);
  assert.match(G("rulingsHtml")(CARDS.find((x) => x.name.startsWith("Kai'Sa, Daughter"))), /card\/daughter-of-the-void"/);
  STORE.del("ruling", "a"); STORE.del("ruling", "b");
  assert.equal(G("run")("is:ruling").count, 0);
});
