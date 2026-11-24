// Foil and Chinese copies, and the scan's art comparison: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const ctx = vm.createContext({ console, atob });
ctx.window = ctx;
for (const f of ["settings", "cards", "query", "store", "deck", "collection", "scan", "art"]) vm.runInContext(readFileSync(new URL(`web/${f}.js`, root), "utf8"), ctx, { filename: f });
const G = (n) => vm.runInContext(n, ctx);
const COLL = G("COLL"), STORE = G("STORE"), parseEntry = G("parseEntry"), parseBulk = G("parseBulk"), artMatch = G("artMatch"), ix = G("readArt(window.ART_INDEX)");
const raw = (id) => JSON.parse(JSON.stringify(STORE.get("coll", id)));
const id = "OGN-007";

test("versions are counted apart, n is all of them", () => {
  STORE.put("coll", id, { n: 2 }); // as older pages wrote it: plain English
  COLL.add(id, 1, "zh"); COLL.add(id, 2, "zh-foil"); COLL.add(id, 1, "foil");
  assert.deepEqual(raw(id), { n: 6, x: { foil: 1, zh: 1, "zh-foil": 2 } });
  assert.equal(COLL.v(id), 2);
  COLL.add(id, -5, "zh");
  assert.deepEqual(raw(id), { n: 5, x: { foil: 1, "zh-foil": 2 } });
  COLL.set(id, 7); assert.equal(COLL.v(id), 4);
  COLL.set(id, 2); assert.deepEqual(raw(id), { n: 2, x: { "zh-foil": 2 } });
  COLL.set(id, 0); assert.equal(STORE.get("coll", id), null);
});

test("typed and pasted versions", () => {
  assert.equal(parseEntry("ogn 7 x2 zh foil").ver, "zh-foil");
  assert.equal(parseEntry("ogn 7 foil").ver, "foil");
  assert.equal(parseEntry("ogn 7 cn").ver, "zh");
  assert.equal(parseEntry("ogn 7 fr foil").ver, "fr-foil");
  assert.equal(parseEntry("ogn 7 korean").ver, "ko");
  assert.equal(parseEntry("ogn 7 en").ver, "");
  assert.equal(parseEntry("ogn 7").ver, undefined);
  const name = G("CARDS").find((c) => c.id === id).name;
  const { items, problems } = parseBulk(`ogn 7 2\nogn 7 3 zh\n1 ${name} foil\nOGN-007 zh`);
  assert.deepEqual([...problems], []);
  assert.deepEqual(Array.from(items, (i) => [i.id, i.n, i.ver]), [[id, 2, undefined], [id, 4, "zh"], [id, 1, "foil"]]);
  COLL.apply(items);
  assert.deepEqual(raw(id), { n: 7, x: { foil: 1, zh: 4 } });
});

test("the CSV export comes back as it was", () => {
  const csv = `name,id,own,foil,zh,zh-foil\nx,${id},7,1,4,0`;
  const before = raw(id);
  COLL.set(id, 0);
  COLL.apply(parseBulk(csv).items, "set");
  assert.deepEqual(raw(id), before);
});

// a frame showing a printing's tiny picture where the art belongs
function frame(i, glare) {
  const w = 186, h = 260, d = new Uint8ClampedArray(w * h * 4).fill(90);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = Math.floor(((x / w - 0.08) / 0.84) * ix.w), cy = Math.floor(((y / h - 0.1) / 0.42) * ix.h);
    if (cx < 0 || cy < 0 || cx >= ix.w || cy >= ix.h) continue;
    for (let c = 0; c < 3; c++) d[(y * w + x) * 4 + c] = glare && cx > 2 && cx < 9 ? 250 : ix.px[(i * ix.w * ix.h + cy * ix.w + cx) * 3 + c] * 0.8;
  }
  return artMatch(d, w, h, ix);
}
test("the art finds its printing, also under glare", () => {
  for (let i = 5; i < ix.ids.length; i += 97) for (const glare of [false, true]) {
    const m = frame(i, glare);
    assert.equal(ix.group[m.best], ix.group[i], `${ix.ids[i]} glare ${glare}`);
    assert.ok(!glare || m.clear < 0.75);
  }
});
test("no card, no match", () => {
  const m = artMatch(new Uint8ClampedArray(186 * 260 * 4).fill(120), 186, 260, ix);
  assert.ok(m.score[m.best] < 0.5);
});
test("every printing in the index exists", () => {
  for (const i of ix.ids) assert.ok(G("PRINTS").has(i.toUpperCase()), i);
});

test("text: the same is English, other strokes aren't, none says nothing", () => {
  const strokes = G("strokes"), textMatch = G("textMatch"), { w, h } = G("TEXT");
  const page = (seed, shift = 0, ink = 20) => {
    const d = new Uint8ClampedArray(w * h * 4).fill(230);
    let s = seed;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < 900; k++) {
      const x = Math.floor(20 + rnd() * 155) + shift, y = Math.floor(195 + rnd() * 100) + shift, len = 2 + Math.floor(rnd() * 5), up = rnd() < 0.5;
      for (let i = 0; i < len; i++) for (let c = 0; c < 3; c++) d[((y + (up ? i : 0)) * w + x + (up ? 0 : i)) * 4 + c] = ink;
    }
    return strokes(G("grey")(d));
  };
  const a = page(7);
  assert.ok(textMatch(page(7, 5), a) > G("LANGUAGE").english);
  assert.ok(textMatch(page(99), a) < G("LANGUAGE").other);
  assert.equal(textMatch(a, page(7, 0, 230)), null);
});

const CARDS = G("CARDS"), filing = G("filing");
const sorted = (cs) => { const by = G("sorter")("file", []); return [...cs].map((c) => ({ ...c, p: c.printings[0] })).sort(by); };
test("filing: main cards, then legends with their signatures, then battlefields", () => {
  const s = sorted(CARDS), pile = G("filePile");
  const piles = s.map((c) => pile(c));
  assert.deepEqual(piles, [...piles].sort());
  const legends = s.filter((c) => pile(c) === 1);
  // a champion's cards are one run, legends first
  const runs = legends.map((c) => c.champion).filter((c, i, a) => c !== a[i - 1]);
  assert.equal(runs.length, new Set(runs).size);
  for (const ch of runs) { const t = legends.filter((c) => c.champion === ch).map((c) => c.type === "Legend"); assert.deepEqual(t, [...t].sort((a, b) => b - a), ch); }
  const main = s.filter((c) => pile(c) === 0), D = G("SETTINGS").domainOrder, RA = G("RARITY_ORDER");
  for (let i = 1; i < main.length; i++) {
    const k = (c) => [c.domains.length ? D.indexOf(c.domains[0]) : 99, RA.indexOf(c.printings[0].rarity), c.energy ?? 999, c.power ?? 999];
    const a = k(main[i - 1]), b = k(main[i]), d = a.findIndex((x, j) => x !== b[j]);
    assert.ok(d < 0 || a[d] < b[d], `${main[i - 1].name} / ${main[i].name}`);
  }
});
test("filing: between which cards", () => {
  const m = sorted(CARDS).filter((c) => G("filePile")(c) === 0).slice(0, 6).map((c) => c.printings[0].id);
  const f = filing([{ id: m[3], n: 1 }, { id: m[1], n: 2, ver: "zh" }, { id: m[2], n: 1 }, { id: m[4], n: 1 }], [m[0], m[4], m[5]]);
  assert.deepEqual(Array.from(f, (x) => [x.id, x.after.id, x.before.id, x.already]),
    [[m[1], m[0], m[4], false], [m[2], m[1], m[4], false], [m[3], m[2], m[4], false], [m[4], m[3], m[5], true]]);
  const b = CARDS.find((c) => c.type === "Battlefield").printings[0].id;
  const alone = filing([{ id: b, n: 1 }], m)[0]; // nothing of another pile is a neighbour
  assert.equal(alone.after, null); assert.equal(alone.before, null);
});

test("which language a text is", () => {
  const l = G("languageOfText");
  assert.equal(l("对战斗中的所有敌方单位各造成2点伤害。"), "zh");
  assert.equal(l("전투 중인 모든 적 유닛에게 피해를 2 줍니다."), "ko");
  assert.equal(l("Infligez 2 à toutes les unités ennemies au combat. Vous pouvez jouer cette carte."), "fr");
  assert.equal(l("Deal 2 to all enemy units in combat. You may play this from your trash."), "en");
  assert.equal(l("~ |: 2"), null);
});
