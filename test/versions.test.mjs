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
