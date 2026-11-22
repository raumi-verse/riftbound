// The scan matcher on what Tesseract really read from card pictures (in a browser, at camera-like sizes): node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const ctx = vm.createContext({ console });
ctx.window = ctx;
for (const f of ["web/settings.js", "web/cards.js", "web/query.js", "web/store.js", "web/collection.js", "web/scan.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), ctx, { filename: f });
const G = (n) => vm.runInContext(n, ctx);
const readCollector = G("readCollector"), matchName = G("matchName"), matchScan = G("matchScan");
const plain = (x) => JSON.parse(JSON.stringify(x));

test("collector lines as OCR reads them: the set from its size, misread letters and digits", () => {
  const one = (s) => plain(readCollector(s))[0];
  assert.deepEqual(one("OGN • 030a/298"), { set: "OGN", num: "030", suffix: "a" });
  assert.deepEqual(one("oon - 030/298 2"), { set: "OGN", num: "030", suffix: "" });
  assert.deepEqual(one("hE - 251/298"), { set: "OGN", num: "251", suffix: "" });
  assert.deepEqual(one("so 007/221"), { set: "SFD", num: "007", suffix: "" });
  assert.deepEqual(one("5 * 007/221"), { set: "SFD", num: "007", suffix: "" });
  assert.deepEqual(one("ne 050/219"), { set: "UNL", num: "050", suffix: "" });
  assert.deepEqual(one("- N - 168/166 SEN"), { set: "VEN", num: "168", suffix: "" });
  assert.deepEqual(one("OGN · 3OO*/298"), { set: "OGN", num: "300", suffix: "*" });
  assert.deepEqual(one("Be 120/298"), { set: "OGN", num: "120", suffix: "" });
  assert.deepEqual(plain(readCollector("ig")), []);
  assert.deepEqual(plain(readCollector("RE")), []);
});

test("names in the OCR'd band of the card", () => {
  const nm = (s) => matchName(s)?.card.name ?? null;
  assert.equal(nm("© CHAMPION UNIT _— \nJinx\nDEMOLITIONIST\n- AcceLERATE (You maypay @ as an"), "Jinx, Demolitionist");
  assert.equal(nm("©) SIGNATURE S| JIN.\nSuper ee Death Rocket!\nDeal 5 to a unit | When vo"), "Super Mega Death Rocket!");
  assert.equal(nm("& — UNIT | NOXUS | DRAGON\nBlazing Scorcher\nACCELERATE JALTNIET Ed 0% 4"), "Blazing Scorcher");
  assert.equal(nm("— : | GEAR + EQUIPMENT\n— LastRites >\nEup — Recycle 2 cards from yourtr"), "Last Rites");
  assert.equal(nm("UNIT BANDLE CITY ~ MECH\nGem Jammer\nWhen you play me, give a unit /GANK"), "Gem Jammer");
  assert.equal(nm("TT ~ LEGEND + VoLI 4\nI= Rele BN:"), null);
});

test("matchScan: the number decides the printing, the name confirms or stands in", () => {
  const m = (collector, name = "") => { const r = matchScan({ collector, name }); return r && `${r.id} ${r.how}${r.sure ? " sure" : ""}`; };
  assert.equal(m("oo - 030a/298", "Jinx\nDEMOLITIONIST"), "OGN-030a number sure");
  assert.equal(m("OGN • 300*/298"), "OGN-300* number sure");
  assert.equal(m("so 007/221", "Gem Jammer"), "SFD-007 number sure");
  assert.equal(m("ig", "Jinx\nDEMOLITIONIST"), "OGN-030 name");
  assert.equal(m("RE", "I= Rele BN:"), null);
  assert.equal(m("be - 120/298", "Super Mega Death Rocket!"), "OGN-252 name"); // a clear name beats a doubtful number
});

test("nameCandidates: loose, best first, the part before the comma counts", () => {
  const nameCandidates = G("nameCandidates");
  const c = (s) => nameCandidates(s).map((x) => x.name);
  assert.ok(c("QR 2 Jinx u may e enter").includes("Jinx, Demolitionist"));
  assert.ok(c("QR 2 Jinx u may e enter").every((n) => /jinx/i.test(n)));
  assert.equal(c("UNIT BANDLE CITY MECH\nGem Jammer\nWhen you play")[0], "Gem Jammer");
  assert.ok(c("x").length === 0);
});
