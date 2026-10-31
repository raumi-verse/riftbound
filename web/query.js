"use strict";
// The query engine: parsing, filtering, sorting, grouping. No DOM, so test/ can run it in node.
const S = window.SETTINGS;
const { cards: CARDS, sets: SETS, synced, keywords: KW_ICONS = {} } = window.DATA;

const TYPE_ORDER = ["Legend", "Unit", "Spell", "Gear", "Battlefield", "Rune"];
const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Epic", "Showcase", "Promo"];
const SET_ORDER = SETS.map((s) => s.id);
const ROLE_NAMES = ["Legend", "Champion units", "Signatures", "Other cards with the tag"];

// ---------- query language ----------

const FIELDS = {
  n: "name", name: "name",
  t: "type", type: "type",
  st: "super", super: "super", supertype: "super",
  d: "domain", domain: "domain",
  r: "rarity", rarity: "rarity",
  s: "set", set: "set",
  tag: "tag",
  ch: "champion", champ: "champion", champion: "champion",
  o: "text", text: "text",
  kw: "keyword", keyword: "keyword",
  a: "artist", artist: "artist",
  f: "flavour", flavor: "flavour", flavour: "flavour",
  e: "energy", energy: "energy", cost: "energy",
  m: "might", might: "might",
  p: "power", power: "power",
  num: "num", cn: "num",
  is: "is",
  for: "for", legend: "for",
};
const DIRECTIVES = ["sort", "group", "order", "show", "view"];
// has: filters groups (needs group:): keep a group if one of its cards matches. Short forms below,
// anything else in brackets: has:(t:legend d:fury). Card properties are is:.
const HAS_SHORT = { legend: "t:legend", unit: "st:champion t:unit", units: "st:champion t:unit", signature: "st:signature", signatures: "st:signature", banned: "is:banned" };
// for:jinx = cards a deck with that legend may contain: the legend itself, nothing outside its
// domains, signatures only of its champion, no tokens. Champion name or part of the legend's name.
const LEGENDS = CARDS.filter((c) => c.type === "Legend");
function legendsFor(v) {
  if (v.re) return LEGENDS.filter((l) => v.re.test(l.name));
  const byChamp = LEGENDS.filter((l) => l.champion.toLowerCase() === v.s);
  return byChamp.length ? byChamp : LEGENDS.filter((l) => l.name.toLowerCase().includes(v.s));
}
function playable(r, l) {
  if (r.type === "Legend") return r.id === l.id;
  if (r.supertype === "Token" || r.banned) return false;
  if (r.supertype === "Signature" && r.champion !== l.champion) return false;
  return r.domains.every((d) => l.domains.includes(d));
}

const IS = {
  alt: (r) => r.prints.some((p) => p.alt),
  overnumbered: (r) => r.prints.some((p) => p.overnumbered),
  promo: (r) => r.prints.some((p) => p.promo),
  sigprint: (r) => r.prints.some((p) => p.signature),
  reprint: (r) => new Set(r.printings.map((p) => p.set)).size > 1,
  token: (r) => r.supertype === "Token",
  legend: (r) => r.type === "Legend",
  champion: (r) => r.supertype === "Champion", // champion units
  signature: (r) => r.supertype === "Signature",
  linked: (r) => !!r.champion, // belongs to a champion (legend, units, signatures, tagged cards)
  banned: (r) => !!r.banned,
  landscape: (r) => r.landscape,
};
const TERM = /([a-z]+)(!=|<=|>=|:|=|<|>)("[^"]*"?|\/(?:\\.|[^/])*\/?|[^\s()]*)/y;

function parseValue(v) {
  if (v.length > 1 && v[0] === "/") {
    const body = v.endsWith("/") ? v.slice(1, -1) : v.slice(1);
    return { re: new RegExp(body, "i"), shown: `/${body}/` };
  }
  if (v[0] === '"') v = v.replace(/^"|"$/g, "");
  return { s: v.toLowerCase(), shown: v };
}

// q[j] is "(": the text up to its ")" and the index after it
function bracket(q, j) {
  let depth = 0, k = j;
  for (; k < q.length; k++) { if (q[k] === "(") depth++; else if (q[k] === ")" && --depth === 0) break; }
  return [q.slice(j + 1, k), k + 1];
}

// A card query inside a field, judged against all cards: for:( … ) the legends it matches,
// champ:( … ) the champions that have a card it matches.
const SUBQUERY = /(for|legend|ch|champ|champion)(!=|:|=)\(/y;
function subquery(f, raw, errors) {
  const sub = tokenize(raw);
  errors.push(...sub.errors);
  if (sub.has.length || Object.keys(sub.dirs).length) errors.push(`${f}:( … ) only takes card terms, no has:, sort:, group: …`);
  const tree = parse(sub.toks);
  if (f === "for") return { legends: FOLDED.filter((r) => r.type === "Legend" && test(tree, r)) };
  return { champs: new Set(FOLDED.filter((r) => r.champion && test(tree, r)).map((r) => r.champion)) };
}

function tokenize(q) {
  const toks = [], dirs = {}, errors = [], has = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(" || c === ")") { toks.push({ k: c }); i++; continue; }
    if (c === "-" && q[i + 1] && !/\s/.test(q[i + 1])) { toks.push({ k: "not" }); i++; continue; }
    const hm = /has([:=])/y;
    hm.lastIndex = i;
    if (hm.exec(q)) {
      // has:legend or has:( … ): a group filter, kept out of the card query
      let j = hm.lastIndex, raw;
      if (q[j] === "(") {
        [raw, i] = bracket(q, j);
      } else {
        raw = q.slice(j).match(/^[^\s()]*/)[0];
        i = j + raw.length;
        raw = HAS_SHORT[raw.toLowerCase()] || (raw ? (errors.push(`has:${raw}? use has:legend, unit, signature, banned or has:( … )`), "") : "");
      }
      const neg = toks.length && toks[toks.length - 1].k === "not" ? !!toks.pop() : false;
      const sub = tokenize(raw);
      errors.push(...sub.errors);
      if (raw) has.push({ neg, tree: parse(sub.toks), shown: raw });
      continue;
    }
    SUBQUERY.lastIndex = i;
    const sm = SUBQUERY.exec(q);
    if (sm) {
      const f = FIELDS[sm[1]], [raw, end] = bracket(q, SUBQUERY.lastIndex - 1);
      i = end;
      const t = { k: "term", f, op: sm[2], v: { shown: `(${raw})` }, ...subquery(f, raw, errors) };
      const found = f === "for" ? t.legends.map((l) => l.name) : [...t.champs];
      if (!found.length) errors.push(`no ${f === "for" ? "legend" : "champion"} matches ${f}:(${raw})`);
      else t.v.shown += found.length <= 3 ? `: ${found.join(" / ")}` : `: ${found.length} ${f === "for" ? "legends" : "champions"}`;
      toks.push(t);
      continue;
    }
    TERM.lastIndex = i;
    const m = TERM.exec(q);
    if (m && (FIELDS[m[1]] || DIRECTIVES.includes(m[1]))) {
      i = TERM.lastIndex;
      const [, f, op, raw] = m;
      if (DIRECTIVES.includes(f)) { dirs[f] = raw.toLowerCase(); continue; }
      try {
        const t = { k: "term", f: FIELDS[f], op, v: parseValue(raw), src: m[0] };
        // a|b|c: any of them
        if (!t.v.re && t.v.s.includes("|")) t.alts = t.v.s.split("|").filter(Boolean).map((s) => ({ s, shown: s }));
        if (t.f === "for") {
          t.legends = [...new Set((t.alts || [t.v]).flatMap(legendsFor))];
          if (!t.legends.length) errors.push(`no legend matches "${t.v.shown}"`);
          else t.v.shown = t.legends.map((l) => l.name).join(" / ");
        }
        toks.push(t);
      }
      catch (e) { errors.push(`bad regex in ${m[0]}`); }
      continue;
    }
    if (m) {
      errors.push(`unknown field "${m[1]}"`);
      i = TERM.lastIndex;
      continue;
    }
    let word;
    const rest = q.slice(i);
    const qm = rest.match(/^"[^"]*"?/) || rest.match(/^\/(?:\\.|[^/])*\/?/) || rest.match(/^[^\s()]+/);
    word = qm[0];
    i += word.length;
    if (word.toLowerCase() === "or") { toks.push({ k: "or" }); continue; }
    if (word.toLowerCase() === "and") continue;
    try { toks.push({ k: "term", f: "any", op: ":", v: parseValue(word), src: word }); }
    catch (e) { errors.push(`bad regex ${word}`); }
  }
  return { toks, dirs, errors, has };
}

// expr = and ("or" and)* ; and = unary+ ; unary = "-" unary | "(" expr ")" | term
function parse(toks) {
  let i = 0;
  const peek = () => toks[i];
  function expr() {
    const parts = [and()];
    while (peek() && peek().k === "or") { i++; parts.push(and()); }
    return parts.length === 1 ? parts[0] : { or: parts };
  }
  function and() {
    const parts = [];
    while (peek() && peek().k !== "or" && peek().k !== ")") parts.push(unary());
    return { and: parts };
  }
  function unary() {
    const t = toks[i++];
    if (t.k === "not") return peek() ? { not: unary() } : { and: [] };
    if (t.k === "(") { const e = expr(); if (peek() && peek().k === ")") i++; return e; }
    return t;
  }
  const e = expr();
  while (i < toks.length) i++; // stray ")" are ignored
  return e;
}

function keywords(r) {
  return r._kw || (r._kw = [...new Set([...r.alltext.matchAll(/\[([A-Za-z][A-Za-z -]*?)(?: \d+)?\]/g)].map((m) => m[1].toLowerCase()))]);
}

function fieldValues(r, f) {
  switch (f) {
    case "name": return [r.name];
    case "type": return [r.type];
    case "super": return [r.supertype || ""];
    case "rarity": return r.prints.map((p) => p.rarity);
    case "set": return r.prints.map((p) => p.set);
    case "tag": return r.tags;
    case "champion": return [r.champion || ""];
    case "text": return [r.alltext];
    case "keyword": return keywords(r);
    case "artist": return r.prints.map((p) => p.artist || "");
    case "flavour": return [r.flavour || ""];
    case "any": return [r.name, r.alltext, r.champion || ""];
  }
}

const EXACT = new Set(["champion", "set"]);
function strMatch(vals, op, v, f) {
  const hit = (x) => {
    if (v.re) return v.re.test(x);
    x = x.toLowerCase();
    return op === ":" && !EXACT.has(f) ? x.includes(v.s) : x === v.s;
  };
  const any = vals.some(hit);
  return op === "!=" ? !any : any;
}

function numMatch(x, op, v) {
  if (x != null && (op === ":" || op === "=") && /^\d+\+$/.test(v.s)) return x >= parseInt(v.s); // e:7+
  const n = Number(v.s);
  if (x == null || Number.isNaN(n)) return false;
  switch (op) {
    case ":": case "=": return x === n;
    case "!=": return x !== n;
    case "<": return x < n;
    case "<=": return x <= n;
    case ">": return x > n;
    case ">=": return x >= n;
  }
}

function domainMatch(r, op, v) {
  if (v.re) return r.domains.some((d) => v.re.test(d));
  const want = v.s.split(/[,+]/).filter(Boolean);
  if (want.some((w) => w === "colorless" || w === "none")) return r.domains.length === 0;
  const names = want.map((w) => S.domainOrder.find((d) => d.toLowerCase().startsWith(w)) || w);
  const has = (d) => r.domains.includes(d);
  switch (op) {
    case ":": return names.every(has);
    case "=": return names.length === r.domains.length && names.every(has);
    case "!=": return !(names.length === r.domains.length && names.every(has));
    case "<=": return r.domains.every((d) => names.includes(d));
    case ">=": return names.every(has);
    default: return false;
  }
}

function test(node, r) {
  if (node.or) return node.or.some((n) => test(n, r));
  if (node.and) return node.and.every((n) => test(n, r));
  if (node.not) return !test(node.not, r);
  const { f, op, v } = node;
  if (f === "for") return node.legends.some((l) => playable(r, l)) !== (op === "!=");
  if (node.champs) return node.champs.has(r.champion) !== (op === "!=");
  if (node.alts) {
    const neg = op === "!=";
    const any = node.alts.some((a) => test({ ...node, op: neg ? "=" : op, v: a, alts: null }, r));
    return neg ? !any : any;
  }
  if (f === "energy" || f === "might" || f === "power") return numMatch(r[f], op, v);
  if (f === "num") return r.prints.some((p) => numMatch(p.num, op, v));
  if (f === "domain") return domainMatch(r, op, v);
  if (f === "is") { const fn = IS[v.s]; return fn ? (op === "!=" ? !fn(r) : fn(r)) : false; }
  if (["<", "<=", ">", ">="].includes(op)) return false;
  return strMatch(fieldValues(r, f), op, v, f);
}

// ---------- sorting and grouping ----------

const domainKey = (r) => r.domains.length ? r.domains.map((d) => S.domainOrder.indexOf(d)).concat([99]) : [99];
const SORT_KEYS = {
  name: (r) => r.name.toLowerCase(),
  energy: (r) => r.energy ?? Infinity, e: (r) => r.energy ?? Infinity,
  might: (r) => r.might ?? Infinity, m: (r) => r.might ?? Infinity,
  power: (r) => r.power ?? Infinity, p: (r) => r.power ?? Infinity,
  type: (r) => TYPE_ORDER.indexOf(r.type),
  domain: domainKey, d: domainKey,
  rarity: (r) => RARITY_ORDER.indexOf(r.p.rarity),
  set: (r) => [SET_ORDER.indexOf(r.p.set), r.p.num ?? 0],
  num: (r) => [SET_ORDER.indexOf(r.p.set), r.p.num ?? 0],
  champion: (r) => r.champion ? r.champion.toLowerCase() : "￿",
  role: (r) => r.role ?? 9,
};

function cmp(a, b) {
  if (Array.isArray(a)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const c = cmp(a[i] ?? -1, b[i] ?? -1);
      if (c) return c;
    }
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorter(spec, errors, table = SORT_KEYS) {
  const keys = spec.split(",").filter(Boolean).map((k) => {
    const desc = k.startsWith("-");
    const name = k.replace(/^-/, "");
    if (!table[name]) { errors.push(`unknown sort key "${name}"`); return null; }
    return { fn: table[name], desc };
  }).filter(Boolean);
  return (a, b) => {
    for (const { fn, desc } of keys) {
      const c = cmp(fn(a), fn(b));
      if (c) return desc ? -c : c;
    }
    return 0;
  };
}

const GROUPS = {
  champion: { key: (r) => r.champion || "", label: (k) => k || "No champion", order: (k) => [k ? 0 : 1, k] },
  type: { key: (r) => r.type, label: (k) => k, order: (k) => TYPE_ORDER.indexOf(k) },
  domain: { key: (r) => r.domains.join(" + ") || "Colorless", label: (k) => k, order: (k) => domainKey({ domains: k === "Colorless" ? [] : k.split(" + ") }) },
  set: { key: (r) => r.p.set, label: (k) => SETS.find((s) => s.id === k)?.name || k, order: (k) => SET_ORDER.indexOf(k) },
  rarity: { key: (r) => r.p.rarity, label: (k) => k, order: (k) => RARITY_ORDER.indexOf(k) },
};

// ---------- running a query ----------

function rows(expand) {
  if (!expand) return CARDS.map((c) => ({ ...c, prints: c.printings, p: c.printings[0] }));
  return CARDS.flatMap((c) => c.printings.map((p) => ({ ...c, prints: [p], p, rarity: p.rarity })));
}
const FOLDED = rows(false), EXPANDED = rows(true);

function run(q, view = S.view) {
  const { toks, dirs, errors, has } = tokenize(q.trim() || S.defaultQuery);
  const tree = parse(toks);
  const expand = dirs.show ? dirs.show.startsWith("print") : !S.foldPrintings;
  let all = expand ? EXPANDED : FOLDED;
  if (S.hideTokensAndRunes && !/token|rune|basic/i.test(q)) all = all.filter((r) => r.supertype !== "Token" && r.type !== "Rune");
  let list = all.filter((r) => test(tree, r));

  const group = dirs.group && GROUPS[dirs.group] ? dirs.group : null;
  if (dirs.group && !group) errors.push(`can't group by "${dirs.group}" (champion, type, domain, set, rarity)`);
  if (has.length && !group) errors.push("has: filters groups, add group:champion (or another group:)");
  if (has.length && group) {
    // judged on the whole group, not only the cards the rest of the query left
    const g = GROUPS[group], members = new Map();
    for (const r of all) {
      const k = g.key(r);
      if (!members.has(k)) members.set(k, []);
      members.get(k).push(r);
    }
    const keep = new Set([...members].filter(([k, rs]) => (group !== "champion" || k) &&
      has.every((h) => rs.some((r) => test(h.tree, r)) !== h.neg)).map(([k]) => k));
    list = list.filter((r) => keep.has(g.key(r)));
  }
  let spec = dirs.sort || S.defaultSort;
  if (group === "champion") spec = "role," + (dirs.sort || S.championSort);
  list.sort(sorter(spec, errors));

  let sections = [{ label: null, rows: list }];
  if (group) {
    const g = GROUPS[group], by = new Map();
    for (const r of list) {
      const k = g.key(r);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    sections = [...by.keys()].sort((a, b) => cmp(g.order(a), g.order(b))).map((k) => ({ key: k, label: g.label(k), rows: by.get(k), group }));
    if (dirs.order) {
      // order: sorts the groups: by name, by size, or by any card key of the group's first card
      // (in group:champion that's the legend, so order:domain sorts champions by their legend's domains)
      const table = { name: (s) => s.label.toLowerCase(), count: (s) => s.rows.length };
      for (const [k, fn] of Object.entries(SORT_KEYS)) table[k] ??= (s) => fn(s.rows[0]);
      const by = sorter(dirs.order, errors, table);
      const last = (s) => (s.group === "champion" && !s.key ? 1 : 0); // "No champion" stays at the end
      sections.sort((a, b) => last(a) - last(b) || by(a, b));
    }
  }
  return { sections, count: list.length, tree, has, dirs, errors, view: dirs.view || view };
}

// ---------- query terms for the filter bar ----------
// The filter bar's buttons only write terms into the query (the query stays the one truth) and show what's in it.
// Each control owns the first top-level term of its field, e.g. d:fury|chaos or e:2|3|8+.

const TERM_FIELDS = {
  domain: ["d|domain", "<=|=|:"], energy: ["e|energy|cost", "=|:"], type: ["t|type", "=|:"],
  rarity: ["r|rarity", "=|:"], set: ["s|set", "=|:"], keyword: ["kw|keyword", "=|:"], for: ["for|legend", "=|:"],
  sort: ["sort", ":"], group: ["group", ":"],
};
const termRe = (key) => new RegExp(`(^|\\s)(${TERM_FIELDS[key][0]})(${TERM_FIELDS[key][1]})("[^"]*"|[^\\s()"]+)(?=\\s|$)`, "gi");
function readTerm(q, key) {
  const m = termRe(key).exec(q);
  return m ? { op: m[3], raw: m[4].replace(/^"|"$/g, "").toLowerCase() } : null;
}
function writeTerm(q, key, term) {
  q = q.replace(termRe(key), "$1").replace(/\s{2,}/g, " ").trim();
  return term ? `${q} ${term}`.trim() : q;
}

const DOMAINS = S.domainOrder.map((d) => d.toLowerCase());

// mode: any d:fury|chaos · all d:fury,chaos · within d<=fury,chaos; a single domain keeps the given mode
function readDomains(q, fallbackMode = "any") {
  const t = readTerm(q, "domain");
  if (!t) return { mode: fallbackMode, vals: [] };
  const mode = t.op === "<=" ? "within" : t.raw.includes(",") ? "all" : t.raw.includes("|") ? "any" : fallbackMode;
  return { mode, vals: t.raw.split(/[,|+]/).filter(Boolean).map((w) => w === "none" ? "colorless" : DOMAINS.find((d) => d.startsWith(w)) || w) };
}
function writeDomains(q, mode, vals) {
  if (!vals.length) return writeTerm(q, "domain", "");
  return writeTerm(q, "domain", mode === "within" ? `d<=${vals.join(",")}` : `d:${vals.join(mode === "all" ? "," : "|")}`);
}
const readList = (q, key) => readTerm(q, key)?.raw.split("|").filter(Boolean) || [];
const quoteVal = (v) => /[\s|]/.test(v) ? `"${v}"` : v;
