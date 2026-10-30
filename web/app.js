"use strict";
const S = window.SETTINGS;
const { cards: CARDS, sets: SETS, synced } = window.DATA;

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
  has: "has",
  for: "for", legend: "for",
};
const DIRECTIVES = ["sort", "group", "order", "show", "view"];
// has:legend / has:unit / has:signature = the card's champion has such a card
const HAS_ROLE = { legend: 0, unit: 1, units: 1, signature: 2, signatures: 2 };
const CHAMP_ROLES = new Map();
for (const c of CARDS) if (c.champion) {
  if (!CHAMP_ROLES.has(c.champion)) CHAMP_ROLES.set(c.champion, new Set());
  CHAMP_ROLES.get(c.champion).add(c.role);
}
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
  if (r.supertype === "Token") return false;
  if (r.supertype === "Signature" && r.champion !== l.champion) return false;
  return r.domains.every((d) => l.domains.includes(d));
}

const IS = {
  alt: (r) => r.prints.some((p) => p.alt),
  overnumbered: (r) => r.prints.some((p) => p.overnumbered),
  promo: (r) => r.prints.some((p) => p.promo),
  metal: (r) => r.prints.some((p) => p.kind === "Metal"),
  sigprint: (r) => r.prints.some((p) => p.signature),
  reprint: (r) => new Set(r.printings.map((p) => p.set)).size > 1,
  token: (r) => r.supertype === "Token",
  champion: (r) => !!r.champion,
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

function tokenize(q) {
  const toks = [], dirs = {}, errors = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(" || c === ")") { toks.push({ k: c }); i++; continue; }
    if (c === "-" && q[i + 1] && !/\s/.test(q[i + 1])) { toks.push({ k: "not" }); i++; continue; }
    TERM.lastIndex = i;
    const m = TERM.exec(q);
    if (m && (FIELDS[m[1]] || DIRECTIVES.includes(m[1]))) {
      i = TERM.lastIndex;
      const [, f, op, raw] = m;
      if (DIRECTIVES.includes(f)) { dirs[f] = raw.toLowerCase(); continue; }
      try {
        const t = { k: "term", f: FIELDS[f], op, v: parseValue(raw), src: m[0] };
        if (t.f === "for") {
          t.legends = legendsFor(t.v);
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
  return { toks, dirs, errors };
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
  return r._kw || (r._kw = [...new Set([...r.alltext.matchAll(/\[([A-Za-z][A-Za-z ]*?)(?: \d+)?\]/g)].map((m) => m[1].toLowerCase()))]);
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
  if (f === "energy" || f === "might" || f === "power") return numMatch(r[f], op, v);
  if (f === "num") return r.prints.some((p) => numMatch(p.num, op, v));
  if (f === "domain") return domainMatch(r, op, v);
  if (f === "for") return node.legends.some((l) => playable(r, l));
  if (f === "has") {
    const yes = !!r.champion && CHAMP_ROLES.get(r.champion).has(HAS_ROLE[v.s]);
    return op === "!=" ? !yes : yes;
  }
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

function run(q) {
  const { toks, dirs, errors } = tokenize(q.trim() || S.defaultQuery);
  const tree = parse(toks);
  const expand = dirs.show ? dirs.show.startsWith("print") : !S.foldPrintings;
  let list = (expand ? EXPANDED : FOLDED).filter((r) => test(tree, r));
  if (S.hideTokensAndRunes && !/token|rune|basic/i.test(q)) list = list.filter((r) => r.supertype !== "Token" && r.type !== "Rune");

  const group = dirs.group && GROUPS[dirs.group] ? dirs.group : null;
  if (dirs.group && !group) errors.push(`can't group by "${dirs.group}" (champion, type, domain, set, rarity)`);
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
  return { sections, count: list.length, tree, dirs, errors, view: dirs.view || view };
}

// ---------- rendering ----------

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let view = localStorage.getItem("rb-view") || S.view;

function richText(t) {
  return esc(t)
    .replace(/:rb_energy_(\d+):/g, '<span class="ic energy">$1</span>')
    .replace(/:rb_might:/g, '<span class="ic might" title="Might">⚔</span>')
    .replace(/:rb_exhaust:/g, '<span class="ic exhaust" title="Exhaust">⟳</span>')
    .replace(/:rb_rune_rainbow:/g, '<span class="ic rune any" title="Any rune"></span>')
    .replace(/:rb_rune_(\w+):/g, (_, d) => `<span class="ic rune" style="--c:var(--${d})" title="${d}"></span>`)
    .replace(/\[(&gt;)+\]/g, "▶")
    .replace(/\[([A-Za-z][A-Za-z ]*?(?: \d+)?)\]/g, '<b class="kw">$1</b>')
    .replace(/\n/g, "<br>");
}

const dots = (ds) => ds.map((d) => `<span class="dot" style="--c:var(--${d.toLowerCase()})" title="${d}"></span>`).join("");
const qlink = (q, text) => `<a href="#${encodeURIComponent(q)}">${esc(text)}</a>`;
const quote = (s) => /\s/.test(s) ? `"${s}"` : s;

function imgSrc(r) { return r.p.img || r.printings.find((p) => p.img)?.img; }

function gridSection(rows) {
  return `<div class="grid">${rows.map((r, i) => {
    const src = imgSrc(r);
    return `<button class="card${r.landscape ? " land" : ""}" data-i="${i}" title="${esc(r.name)}">${src ? `<img loading="lazy" src="${esc(src)}" alt="${esc(r.name)}">` : `<span class="noimg">${esc(r.name)}</span>`}${r.printings.length > 1 && !r._exp ? `<span class="nprint">${r.printings.length}</span>` : ""}</button>`;
  }).join("")}</div>`;
}

const COLS = [
  ["name", "Name"], ["champion", "Champion"], ["type", "Type"], ["domain", "Domains"],
  ["energy", "E"], ["might", "M"], ["power", "P"], ["rarity", "Rarity"], ["set", "Set"], [null, "Text"],
];
function listSection(rows) {
  return `<table class="list"><thead><tr>${COLS.map(([k, l]) => `<th${k ? ` data-sort="${k}" title="click: sort by this, shift-click: add as next key"` : ""}>${l}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr data-i="${i}">
    <td class="nm">${esc(r.name)}${r.role != null ? ` <small class="role">${["L", "C", "S", ""][r.role]}</small>` : ""}</td>
    <td>${esc(r.champion || "")}</td>
    <td>${esc(r.type)}${r.supertype ? ` <small>${esc(r.supertype)}</small>` : ""}</td>
    <td>${dots(r.domains)}</td>
    <td class="n">${r.energy ?? ""}</td><td class="n">${r.might ?? ""}</td><td class="n">${r.power ?? ""}</td>
    <td>${esc(r.p.rarity)}</td><td>${esc(r.p.set)}&nbsp;${r.p.num ?? ""}</td>
    <td class="tx">${richText(r.text)}</td></tr>`).join("")}</tbody></table>`;
}

function explain(n, top) {
  if (n.or) { const s = n.or.map((x) => explain(x)).join(' <b class="op">or</b> '); return top ? s : `( ${s} )`; }
  if (n.and) { const s = n.and.map((x) => explain(x)).join(" "); return n.and.length > 1 && !top ? `( ${s} )` : s; }
  if (n.not) return `<b class="op">not</b> ${explain(n.not)}`;
  return `<span class="chip">${esc(`${n.f === "any" ? "name/text" : n.f} ${n.op} ${n.v.shown}`)}</span>`;
}

function chips(res) {
  const out = [explain(res.tree, true)];
  for (const [k, v] of Object.entries(res.dirs)) out.push(`<span class="chip dir">${k}: ${esc(v)}</span>`);
  for (const e of res.errors) out.push(`<span class="chip err">${esc(e)}</span>`);
  return out.join("");
}

let current = null;
function render() {
  const q = $("#q").value;
  const res = (current = run(q));
  $("#chips").innerHTML = chips(res);
  $("#count").textContent = `${res.count} ${res.dirs.show?.startsWith("print") ? "printings" : "cards"}`;
  document.body.dataset.view = res.view;
  $("#view").textContent = res.view === "grid" ? "☰" : "▦";
  $("#results").innerHTML = res.sections.map((s, si) => {
    s.rows.forEach((r) => (r._exp = !!res.dirs.show));
    let body;
    if (s.group === "champion" && s.label !== "No champion") {
      // one sub-row per role: legend / champion units / signatures / other
      const byRole = [0, 1, 2, 3].map((role) => s.rows.map((r, i) => [r, i]).filter(([r]) => r.role === role)).filter((x) => x.length);
      body = byRole.map((pairs) => `<div class="role-row" data-s="${si}"><h3>${ROLE_NAMES[pairs[0][0].role]}</h3>${(res.view === "grid" ? gridSection : listSection)(pairs.map(([r]) => r)).replace(/data-i="(\d+)"/g, (_, j) => `data-i="${pairs[j][1]}"`)}</div>`).join("");
    } else {
      body = `<div data-s="${si}">${(res.view === "grid" ? gridSection : listSection)(s.rows)}</div>`;
    }
    const head = s.label == null ? "" : `<h2>${s.group === "champion" && s.label !== "No champion" ? qlink(`champ="${s.label}" group:champion`, s.label) : esc(s.label)} <small>${s.rows.length}</small></h2>`;
    return `<section style="--w:${S.cardWidth}px">${head}${body}</section>`;
  }).join("") || `<p class="empty">No cards match.</p>`;
}

function detail(r) {
  const d = $("#detail");
  const show = (p) => {
    d.querySelector(".big").innerHTML = p.img ? `<img src="${esc(p.img)}" alt="">` : "";
    d.querySelectorAll(".pr").forEach((b) => b.classList.toggle("on", b.dataset.id === p.id + p.kind));
  };
  const stats = [["Energy", r.energy], ["Might", r.might], ["Power", r.power]].filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(" · ");
  d.querySelector(".info").innerHTML = `
    <h2>${esc(r.name)}</h2>
    <p class="line">${dots(r.domains)} ${esc([r.supertype, r.type].filter(Boolean).join(" "))}${stats ? ` · ${stats}` : ""}</p>
    <div class="tx">${richText(r.text)}</div>
    ${r.flavour ? `<p class="flav">${esc(r.flavour)}</p>` : ""}
    <p class="tags">${r.champion ? `Champion: ${qlink(`champ="${r.champion}" group:champion`, r.champion)} · ` : ""}${r.tags.filter((t) => t !== r.champion).map((t) => qlink(`tag="${t}"`, t)).join(", ")}</p>
    <h3>Printings</h3>
    <div class="prints">${r.printings.map((p) => `<button class="pr" data-id="${esc(p.id + p.kind)}">${esc(p.set)} ${p.num ?? ""} · ${esc(p.rarity)}${p.kind ? ` · ${esc(p.kind)}` : ""}${p.artist ? `<small>${esc(p.artist)}</small>` : ""}</button>`).join("")}</div>`;
  d.querySelectorAll(".pr").forEach((b, i) => (b.onclick = () => show(r.printings[i])));
  d.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => d.close()));
  show(r.p);
  d.showModal();
}

// ---------- wiring ----------

function setQuery(q, push) {
  $("#q").value = q;
  const h = "#" + encodeURIComponent(q);
  if (push) history.pushState(null, "", h); else history.replaceState(null, "", h);
  render();
}

function sortBy(key, append) {
  const q = $("#q").value;
  const m = q.match(/(?:^|\s)sort:(\S*)/);
  let keys = m ? m[1].split(",").filter(Boolean) : [];
  if (append) {
    keys = keys.filter((k) => k.replace(/^-/, "") !== key).concat(key);
  } else {
    keys = [keys[0] === key ? "-" + key : key];
  }
  const rest = q.replace(/(?:^|\s)sort:\S*/, "").trim();
  setQuery(`${rest} sort:${keys.join(",")}`.trim(), true);
}

let timer;
$("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => setQuery($("#q").value, false), 150); });
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(timer); setQuery($("#q").value, true); } });
$("#view").addEventListener("click", () => {
  view = view === "grid" ? "list" : "grid";
  localStorage.setItem("rb-view", view);
  setQuery($("#q").value.replace(/(?:^|\s)view:\S*/, "").trim(), false);
});
$("#results").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (th) return sortBy(th.dataset.sort, e.shiftKey);
  const el = e.target.closest("[data-i]");
  if (!el || e.target.closest("a")) return;
  const s = el.closest("[data-s]").dataset.s;
  detail(current.sections[s].rows[el.dataset.i]);
});
$("#detail").addEventListener("click", (e) => { if (e.target.id === "detail") e.target.close(); });
window.addEventListener("hashchange", () => { $("#q").value = decodeURIComponent(location.hash.slice(1)); render(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); $("#q").select(); }
});

$("#synced").textContent = `${CARDS.length} cards · synced ${synced.slice(0, 10)}`;
$("#q").value = decodeURIComponent(location.hash.slice(1));
render();
