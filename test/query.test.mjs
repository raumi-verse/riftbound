// The query engine on the real card data: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const ctx = vm.createContext({});
ctx.window = ctx;
for (const f of ["web/settings.js", "web/cards.js", "web/query.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), ctx, { filename: f });
// values from the vm have that realm's Array/Object prototypes; compare plain copies
const plain = (x) => JSON.parse(JSON.stringify(x));
const Q = (name) => {
  const v = vm.runInContext(name, ctx);
  return typeof v === "function" ? (...a) => { const r = v(...a); return typeof r === "object" && r && !r.sections ? plain(r) : r; } : v;
};
const run = Q("run"), playable = Q("playable");

const res = (q) => {
  const r = run(q);
  assert.deepEqual(plain(r.errors), [], `errors in ${q}`);
  return r;
};
const ids = (q) => res(q).sections.flatMap((s) => s.rows.map((r) => r.p.id + r.p.kind)).sort();
const same = (a, b) => {
  const x = ids(a);
  assert.ok(x.length > 0, `${a} finds nothing`);
  assert.deepEqual(x, ids(b), `${a}  ≠  ${b}`);
};

test("alternatives, ranges and negation agree with the long forms", () => {
  same("t:unit|gear", "t:unit or t:gear");
  same("t:unit e!=1|2|3", "t:unit -e:1|2|3");
  same("t:unit -e:1|2|3", "t:unit -(e:1 or e:2 or e:3)");
  same("t:unit e:7+", "t:unit e>=7");
  same("d:fury|chaos", "d:fury or d:chaos");
  same("kw:tank|shield", "kw:tank or kw:shield");
  same("for:jinx|viktor", "for:jinx or for:viktor");
});

test("subqueries", () => {
  same("champ:(t:legend d:calm)", "group:champion has:(t:legend d:calm)");
  same("champ!=(t:legend d:calm) is:linked", "-champ:(t:legend d:calm) is:linked");
  same("for:(t:legend champ=jinx)", "for:jinx");
  assert.match(run("champ:(kw:nothinglikethis)").errors[0], /no champion matches/);
  assert.match(run("champ:(t:legend sort:name)").errors.at(-1), /only takes card terms/);
});

test("for: is the cards the legend's deck may play", () => {
  const legend = Q("LEGENDS").find((l) => l.champion === "Jinx");
  const rows = res("for:jinx").sections[0].rows;
  assert.ok(rows.length > 50);
  for (const r of rows) assert.ok(playable(r, legend), r.name);
  assert.ok(!rows.some((r) => r.supertype === "Signature" && r.champion !== "Jinx"));
});

test("group:champion puts the legend first", () => {
  for (const s of res("group:champion has:legend").sections) {
    if (!s.key) continue;
    assert.equal(s.rows[0].type, "Legend", s.label);
    const roles = plain(s.rows.map((r) => r.role));
    assert.deepEqual(roles, [...roles].sort(), s.label);
  }
});

test("errors", () => {
  assert.match(run("foo:bar").errors[0], /unknown field "foo"/);
  assert.match(run("has:legend").errors[0], /has: filters groups/);
  assert.match(run("group:nope").errors[0], /can't group by/);
  assert.match(run("sort:nope").errors[0], /unknown sort key/);
  // a comparison without a number used to mean "> 0"
  for (const q of ["m>(t:unit)", "t:unit m>", "m>abc", "e:"]) assert.match(run(q).errors[0], /needs a number/, q);
  assert.equal(run("-m> t:unit").count, res("t:unit").count); // the term is dropped, with its "-"
  same("t:unit e:2|3|8+", "t:unit (e:2 or e:3 or e>=8)");
});

test("every example query in the README runs cleanly and finds cards", () => {
  const readme = readFileSync(new URL("README.md", root), "utf8");
  const examples = [...readme.matchAll(/^\| `(.+?)`(?: \/ `(.+?)`)? \|/gm)].flatMap((m) => m.slice(1).filter(Boolean)).map((q) => q.replace(/\\\|/g, "|"));
  assert.ok(examples.length >= 10);
  for (const q of examples) assert.ok(res(q).count > 0, q);
});

test("filter bar terms", () => {
  const [readTerm, writeTerm, readDomains, writeDomains, readList] = ["readTerm", "writeTerm", "readDomains", "writeDomains", "readList"].map(Q);
  for (const mode of ["any", "all", "within"]) {
    const q = writeDomains("t:unit", mode, ["fury", "chaos"]);
    assert.deepEqual(readDomains(q), { mode, vals: ["fury", "chaos"] }, q);
  }
  assert.equal(writeDomains("t:unit", "any", ["fury", "chaos"]), "t:unit d:fury|chaos");
  assert.equal(writeDomains("t:unit", "within", ["fury", "chaos"]), "t:unit d<=fury,chaos");
  assert.equal(writeDomains("d:fury t:unit", "any", []), "t:unit");
  assert.equal(readDomains("d:fury", "all").mode, "all");
  assert.deepEqual(readList("t:unit e:2|7+", "energy"), ["2", "7+"]);
  assert.equal(writeTerm("e:2 t:unit", "energy", "e:2|3"), "t:unit e:2|3");
  assert.equal(writeTerm("(t:spell or t:gear) d:fury", "type", "t:unit"), "(t:spell or t:gear) d:fury t:unit");
  assert.equal(writeTerm("-t:spell", "type", "t:unit"), "-t:spell t:unit");
  assert.deepEqual(readTerm('for:"jinx, loose cannon" x', "for"), { op: ":", raw: "jinx, loose cannon" });
});

test("suggestions", () => {
  const suggest = Q("suggest");
  const first = (q, caret) => suggest(q, caret).items[0]?.insert;
  assert.equal(first("dom"), "d:");
  assert.deepEqual(suggest("t").items.map((i) => i.insert).slice(0, 2), ["t:", "tag:"]);
  assert.equal(first("t:u"), "t:unit");
  assert.equal(first("d:fury|ch"), "d:fury|chaos");
  assert.equal(first("champ:lee"), 'champ:"Lee Sin"');
  assert.equal(first("kw:sho"), 'kw:"show off"');
  assert.equal(first("sort:energy,-mi"), "sort:energy,-might");
  assert.equal(first("has:le"), "has:legend");
  const sub = suggest("champ:(t:le");
  assert.deepEqual([sub.from, sub.to, sub.items[0].insert], [7, 11, "t:legend"]);
  const mid = suggest("t:un d:fury", 3); // caret inside the first term: it is replaced whole
  assert.deepEqual([mid.from, mid.to, mid.items[0].insert], [0, 4, "t:unit"]);
  assert.equal(suggest("t:unit").items.length, 0); // already complete
  assert.equal(suggest('o:"when you').items.length, 0); // no values for rules text
});

test("stats of the results", () => {
  const stats = Q("stats");
  const st = stats(res("t:unit d:calm").sections[0].rows);
  assert.equal(st.might.n, res("t:unit d:calm").count);
  assert.ok(st.might.min <= st.might.median && st.might.median <= st.might.max);
  // printings count once, spells don't count for might
  assert.deepEqual(stats(res("show:printings t:unit d:calm").sections[0].rows), st);
  const mixed = stats(res("d:calm").sections[0].rows);
  assert.equal(mixed.might.avg, stats(res("d:calm t:unit").sections[0].rows).might.avg);
  assert.equal(stats(res("t:legend").sections[0].rows).energy, undefined);
  assert.deepEqual(stats([]), {});
});

test("folded, a card shows the printing that matched", () => {
  const rows = (q) => res(q).sections.flatMap((s) => s.rows);
  for (const [q, ok] of [["r:showcase", (p) => p.rarity === "Showcase"], ["s:sfd", (p) => p.set === "SFD"], ["is:alt", (p) => p.alt]]) {
    const folded = rows(q);
    assert.ok(folded.every((r) => ok(r.p)), q);
    assert.equal(folded.length, new Set(rows(`${q} show:printings`).map((r) => r.id)).size, q);
    assert.ok(folded.every((r) => r.printings.length === r.prints.length), q); // the dialog still lists every printing
  }
});
