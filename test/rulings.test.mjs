// Foil as printed, errata and ruling notes: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const el = { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null };
const ctx = vm.createContext({ console, URL, document: el, setTimeout, clearTimeout, AbortController });
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
  STORE.del("ruling", "a"); STORE.del("ruling", "b");
  assert.equal(G("run")("is:ruling").count, 0);
});

// what their API answers (shortened)
const answer = { id: "SFD202", name: "Hostile Takeover", erratas: [
  { id: "1", cards: [{ name: "Hostile Takeover" }, { name: "Dragon Roost" }], type: "ruling", details: "**Q: a [Hostile Takeover] for 2[A]?**\n\n**A:** yes (359.3.e.16.) <script>x</script> [link](https://example.org/a) [bad](javascript:alert(1))", originalLang: "en", source: "https://x.com/a/1", errataDate: "2026-11-02T15:00:01.000Z", votes: { positive: 2, negative: 0 }, author: { displayName: "Nakasar" } },
  { id: "2", type: "clarification", details: "Bonjour", originalLang: "fr", translations: [{ lang: "en", details: "Hello" }], errataDate: "2026-08-14T00:00:00.000Z", deprecatedAt: "2026-09-01T00:00:00.000Z" },
  { id: "3", type: "clarification", details: "Hallo", originalLang: "de", source: "javascript:alert(1)", createdAt: "2026-01-14T00:00:00.000Z" }, { id: "4", type: "ruling" }, {}] };
test("rulings from Joutes: read and shown safely", () => {
  const c = CARDS.find((x) => x.name === "Hostile Takeover"), list = G("readSite")(answer);
  assert.deepEqual(Array.from(list, (e) => [e.id, e.text.slice(0, 5), e.lang, e.outdated]), [["1", "**Q: ", "en", false], ["3", "Hallo", "de", false], ["2", "Hello", "en", true]]);
  const h = G("siteHtml")(c, { list, at: Date.now(), old: false });
  assert.doesNotMatch(h, /<script|href="javascript/);
  assert.match(h, new RegExp(`data-open-card="${c.id}"`));
  assert.match(h, /<b>Q: a/); assert.match(h, /href="https:\/\/example\.org\/a"/); assert.match(h, /outdated/);
  assert.match(h, /cards\/SFD202"/);
  for (const bad of [null, {}, { erratas: 3 }, "x"]) assert.throws(() => G("readSite")(bad));
});
test("rulings from Joutes: only plain numbers, off when switched off, quiet when unreachable", async () => {
  for (const x of CARDS) { const id = G("siteId")(x); if (id) assert.match(id, /^[A-Z]{3}\d{3}[ab]?$/); }
  assert.ok(CARDS.filter((x) => G("siteId")(x)).length > 1080);
  const c = CARDS.find((x) => x.name === "Hostile Takeover"), asked = [];
  ctx.fetch = async (u) => { asked.push(u); return { ok: true, status: 200, json: async () => answer }; };
  assert.equal((await G("siteRulings")(c)).list.length, 3);
  assert.deepEqual(asked, ["https://www.joutes.app/api/games/riftbound/cards/SFD202"]);
  ctx.fetch = async () => { throw new Error("offline"); };
  assert.equal(await G("siteRulings")(CARDS.find((x) => x.name === "Sky Splitter")), null);
  ctx.fetch = async () => ({ ok: true, status: 200, json: async () => ({ changed: 1 }) });
  assert.equal(await G("siteRulings")(CARDS.find((x) => x.name === "Sky Splitter")), null);
  const S = G("S"), was = S.rulingsSite;
  ctx.fetch = async () => assert.fail("asked although off");
  S.rulingsSite = { ...was, api: "" };
  assert.equal(await G("siteRulings")(c), null);
  S.rulingsSite = was;
});
