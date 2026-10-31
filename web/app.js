"use strict";
// The page: rendering, filter bar, card dialog, wiring. The query engine is query.js.

// ---------- rendering ----------

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let view = localStorage.getItem("rb-view") || S.view;

// the game's symbols, in web/icons/ (sync.py downloads them)
const icon = (file, alt, cls = "") => `<img class="ic${cls ? " " + cls : ""}" src="icons/${file}" alt="${esc(alt)}" title="${esc(alt)}">`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const ICONS = {
  domain: (d) => icon(`${d.toLowerCase()}.webp`, cap(d.toLowerCase())),
  energy: (n) => icon(`${n}.svg`, `${n} energy`, "en"),
  might: () => icon("might.webp", "Might"),
  exhaust: () => icon("tap.webp", "Exhaust"),
  rune: () => icon("rune.webp", "Any rune"),
  type: (t) => ["legend", "unit", "spell", "gear", "battlefield", "rune"].includes(t.split(" ")[0].toLowerCase()) ? icon(`type-${t.split(" ")[0].toLowerCase()}.webp`, t, "ty") : "",
  rarity: (r) => ["common", "uncommon", "rare", "epic", "showcase"].includes(r.toLowerCase()) ? icon(`rarity-${r.toLowerCase()}.webp`, r, "ra") : "",
};
// A keyword's reminder text: the most common "(…)" right after it on the cards, "assault 2" and "assault" apart
const REMINDERS = (() => {
  const counts = {};
  for (const c of CARDS) for (const [, k, t] of c.alltext.matchAll(/\[([A-Za-z][A-Za-z -]*?(?: \d+)?)\] ?\(([^)]+)\)/g)) {
    const key = k.toLowerCase(), text = t[0].toUpperCase() + t.slice(1);
    ((counts[key] ??= {})[text] = (counts[key][text] || 0) + 1);
  }
  return Object.fromEntries(Object.entries(counts).map(([k, ts]) => [k, Object.entries(ts).sort((a, b) => b[1] - a[1])[0][0]]));
})();

// The reminder for a keyword on card r: none if the card prints it, else the usual one with its runes in the
// card's domain (Accelerate costs a rune of the card's domain)
function reminder(low, base, r) {
  if (r && [...r.alltext.matchAll(/\[([A-Za-z][A-Za-z -]*?(?: \d+)?)\] ?\(/g)].some((m) => m[1].toLowerCase() === low)) return null;
  const t = REMINDERS[low] || REMINDERS[base];
  if (!t || !r) return t;
  return t.replace(/:rb_rune_(?!rainbow)\w+:/g, r.domains.length === 1 ? `:rb_rune_${r.domains[0].toLowerCase()}:` : ":rb_rune_rainbow:");
}
// [Assault 2]: its own banner, else the [Assault] banner and the number, else bold text; hover or focus shows
// the reminder text. r: the card (for its reminders); null for no tooltips.
function keywordBadge(k, r) {
  const low = k.toLowerCase(), [, base, n] = low.match(/^(.*?)(?: (\d+))?$/);
  const tip = r !== null && reminder(low, base, r);
  const title = tip ? "" : ` title="${esc(k)}"`;
  const badge = KW_ICONS[low] ? `<img class="kwb" src="${KW_ICONS[low]}" alt="[${esc(k)}]"${title}>`
    : KW_ICONS[base] ? `<img class="kwb" src="${KW_ICONS[base]}" alt="[${esc(k)}]"${title}><b class="kwn">${n}</b>`
    : `<b class="kw">${esc(k)}</b>`;
  return tip ? `<span class="kwt" tabindex="0">${badge}<span class="tip"><b>${esc(k)}</b> ${richText(tip, null)}</span></span>` : badge;
}
function richText(t, r) {
  return esc(t)
    .replace(/:rb_energy_(\d+):/g, (_, n) => ICONS.energy(n))
    .replace(/:rb_might:/g, ICONS.might)
    .replace(/:rb_exhaust:/g, ICONS.exhaust)
    .replace(/:rb_rune_rainbow:/g, ICONS.rune)
    .replace(/:rb_rune_(\w+):/g, (_, d) => ICONS.domain(d))
    .replace(/\[(&gt;)+\]/g, "▶")
    .replace(/\[([A-Za-z][A-Za-z -]*?(?: \d+)?)\]/g, (_, k) => keywordBadge(k, r))
    .replace(/\n/g, "<br>");
}

const dots = (ds) => ds.map(ICONS.domain).join("");
// power is paid in runes of the card's domain; with two domains the split isn't in the data
const powerIcons = (r) => !r.power ? "" : r.domains.length === 1 ? ICONS.domain(r.domains[0]).repeat(r.power) : `${r.power}${ICONS.rune()}`;
const cost = (r) => [r.energy != null ? ICONS.energy(r.energy) : "", powerIcons(r)].join("");
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
  ["energy", "E"], ["might", ICONS.might()], ["power", ICONS.rune()], ["rarity", "Rarity"], ["set", "Set"], [null, "Text"],
];
function listSection(rows) {
  return `<table class="list"><thead><tr>${COLS.map(([k, l]) => `<th${k ? ` data-sort="${k}" title="click: sort by this, shift-click: add as next key"` : ""}>${l}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr data-i="${i}">
    <td class="nm">${esc(r.name)}${r.role != null ? ` <small class="role">${["L", "C", "S", ""][r.role]}</small>` : ""}</td>
    <td>${esc(r.champion || "")}</td>
    <td>${ICONS.type(r.type)} ${esc(r.type)}${r.supertype ? ` <small>${esc(r.supertype)}</small>` : ""}</td>
    <td>${dots(r.domains)}</td>
    <td class="n">${r.energy != null && HAS_STAT.energy(r) ? ICONS.energy(r.energy) : ""}</td><td class="n">${/Unit/.test(r.type) ? r.might ?? "" : ""}</td><td class="n">${powerIcons(r)}</td>
    <td>${ICONS.rarity(r.p.rarity)} ${esc(r.p.rarity)}</td><td>${esc(r.p.set)}&nbsp;${r.p.num ?? ""}</td>
    <td class="tx">${richText(r.text, r)}</td></tr>`).join("")}</tbody></table>`;
}

function explain(n, top) {
  if (n.or) { const s = n.or.map((x) => explain(x)).join(' <b class="op">or</b> '); return top ? s : `( ${s} )`; }
  if (n.and) { const s = n.and.map((x) => explain(x)).join(" "); return n.and.length > 1 && !top ? `( ${s} )` : s; }
  if (n.not) return `<b class="op">not</b> ${explain(n.not)}`;
  return `<span class="chip">${esc(`${n.f === "any" ? "name/text" : n.f} ${n.op} ${n.v.shown}`)}</span>`;
}

// energy 1–12 · avg 4.4 · median 4 · might 0–12 · avg 4.2 · median 4 (90 units)
function statLine(st) {
  const num = (x) => String(Math.round(x * 10) / 10);
  const part = (f, s) => `${f} ${s.min === s.max ? s.min : `${s.min}–${s.max}`} · avg ${num(s.avg)} · median ${num(s.median)}`;
  const parts = Object.entries(st).map(([f, s]) => part(f, s));
  if (!parts.length) return "";
  const n = st.might ? ` (${st.might.n} unit${st.might.n === 1 ? "" : "s"})` : "";
  return `<span class="stats" title="over the cards found, each card once; energy without legends, battlefields and runes, might of units only">${esc(parts.join(" · ") + n)}</span>`;
}

function chips(res) {
  const out = [explain(res.tree, true)];
  for (const h of res.has) out.push(`<span class="chip dir">${h.neg ? "groups without" : "groups with"}: ${esc(h.shown)}</span>`);
  for (const [k, v] of Object.entries(res.dirs)) out.push(`<span class="chip dir">${k}: ${esc(v)}</span>`);
  for (const e of res.errors) out.push(`<span class="chip err">${esc(e)}</span>`);
  out.push(statLine(stats(res.sections.flatMap((s) => s.rows))));
  return out.join("");
}

let current = null;
function render() {
  const q = $("#q").value;
  syncFilters(q);
  const res = (current = run(q, view));
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

// The dialog shows current.sections[si].rows[i]; ←/→ step through the results in page order. A card picked
// from the champion strip is shown in place, the arrows go on from the result it was opened from.
let at = null;
function step(delta) {
  const flat = current.sections.flatMap((s, si) => s.rows.map((_, i) => [si, i]));
  const k = flat.findIndex(([si, i]) => si === at.si && i === at.i);
  const next = flat[k + delta];
  if (next) detail(...next);
}
function detail(si, i) {
  at = { si, i };
  const flat = current.sections.reduce((n, s, j) => n + (j < si ? s.rows.length : 0), 0) + i;
  showCard(current.sections[si].rows[i], `${flat + 1} / ${current.count}`);
}
const ROLE_SHORT = ["Legend", "Champion", "Signature"];
function showCard(r, pos) {
  const d = $("#detail");
  const show = (p) => {
    const img = p.img ? `<img src="${esc(p.img)}" alt="">` : "";
    d.querySelector(".big").innerHTML = img && r.landscape ? `<span class="rot">${img}</span>` : img;
    d.querySelectorAll(".pr").forEach((b) => b.classList.toggle("on", b.dataset.id === p.id + p.kind));
  };
  const stats = !HAS_STAT.energy(r) ? "" : [cost(r), /Unit/.test(r.type) && r.might != null ? `${ICONS.might()} ${r.might}` : ""].filter(Boolean).join(" · ");
  d.querySelector(".info").innerHTML = `
    <nav class="step"><button type="button" data-step="-1" title="Previous (←)">‹</button><span>${pos || ""}</span><button type="button" data-step="1" title="Next (→)">›</button><button type="button" class="close" title="Close (Esc)">✕</button></nav>
    <h2>${esc(r.name)}</h2>
    <p class="line">${dots(r.domains)} ${ICONS.type(r.type)} ${esc([r.supertype, r.type].filter(Boolean).join(" "))}${stats ? ` · ${stats}` : ""}</p>
    ${r.banned ? `<p class="banned">Banned since ${esc(r.banned.slice(0, 10))}</p>` : ""}
    <div class="tx">${richText(r.text, r)}</div>
    ${r.flavour ? `<p class="flav">${esc(r.flavour)}</p>` : ""}
    <p class="tags">${r.champion ? `Champion: ${qlink(`champ="${r.champion}" group:champion`, r.champion)} · ` : ""}${r.tags.filter((t) => t !== r.champion).map((t) => qlink(`tag="${t}"`, t)).join(", ")}</p>
    ${r.type === "Legend" ? `<p class="tags">${qlink(`for:"${r.name}" group:type`, "Everything this legend's deck may play")}</p>` : ""}
    ${sameChampion(r)}
    <h3>Printings</h3>
    <div class="prints">${r.printings.map((p) => `<button class="pr" data-id="${esc(p.id + p.kind)}">${ICONS.rarity(p.rarity)} ${esc(p.set)} ${p.num ?? ""} · ${esc(p.rarity)}${p.kind ? ` · ${esc(p.kind)}` : ""}${p.artist ? `<small>${esc(p.artist)}</small>` : ""}</button>`).join("")}</div>`;
  d.querySelectorAll(".pr").forEach((b, i) => (b.onclick = () => show(r.printings[i])));
  d.querySelectorAll(".same button").forEach((b) => (b.onclick = () => showCard(FOLDED.find((c) => c.id === b.dataset.id), "")));
  d.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => step(Number(b.dataset.step))));
  d.querySelector(".close").onclick = () => d.close();
  d.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => d.close()));
  d.querySelector(".big").classList.toggle("land", !!r.landscape);
  show(r.p);
  if (!d.open) d.showModal();
}
// the champion's legend, units and signatures as small pictures
function sameChampion(r) {
  if (!r.champion) return "";
  const others = FOLDED.filter((c) => c.champion === r.champion && c.role <= 2 && c.id !== r.id)
    .sort(sorter("role,energy,name", []));
  if (!others.length) return "";
  return `<h3>${esc(r.champion)}</h3><div class="same">${others.map((c) => {
    const src = imgSrc(c);
    return `<button type="button" data-id="${esc(c.id)}" title="${esc(`${c.name} · ${ROLE_SHORT[c.role]}`)}"${c.landscape ? ' class="land"' : ""}>${src ? `<img loading="lazy" src="${esc(src)}" alt="${esc(c.name)}">` : esc(c.name)}</button>`;
  }).join("")}</div>`;
}

// ---------- filter bar ----------

const ENERGIES = ["0", "1", "2", "3", "4", "5", "6", "7+"];
const TYPES = ["legend", "unit", "spell", "gear", "battlefield", "rune"];
const RARITIES = ["common", "uncommon", "rare", "epic", "showcase"];
let domainMode = "any"; // any: d:fury|chaos · all: d:fury,chaos · within: d<=fury,chaos

const allKeywords = [...new Set(CARDS.flatMap(keywords))].sort();
const legendOptions = [...LEGENDS].sort((a, b) => cmp(a.champion + a.name, b.champion + b.name));
const SORTS = [["", "default sort"], ["energy", "energy ↑"], ["-energy", "energy ↓"], ["might", "might ↑"], ["-might", "might ↓"],
  ["name", "name"], ["domain,energy", "domain"], ["rarity", "rarity"], ["set", "set & number"]];
const GROUPINGS = [["", "no groups"], ["champion", "by champion"], ["type", "by type"], ["domain", "by domain"], ["set", "by set"], ["rarity", "by rarity"]];

const toggle = (f, v, html, title) => `<button type="button" class="tg" data-f="${f}" data-v="${esc(v)}" title="${esc(title)}">${html}</button>`;
function buildFilters() {
  const opts = (list, label) => list.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  $("#filters").innerHTML = `
    <div class="fg">${DOMAINS.map((d) => toggle("domain", d, ICONS.domain(d), cap(d))).join("")}${toggle("domain", "colorless", icon("colorless.svg", "Colorless"), "Colorless")}
      <select data-f="dmode" title="any: has one of them · all: has all of them · within: playable in a deck of these domains">
        <option value="any">any of</option><option value="all">all of</option><option value="within">within</option></select></div>
    <div class="fg">${ENERGIES.map((e) => toggle("energy", e, `<span class="en-b">${ICONS.energy(e.replace("+", ""))}${e.endsWith("+") ? "+" : ""}</span>`, `Energy ${e}`)).join("")}</div>
    <div class="fg">${TYPES.map((t) => toggle("type", t, ICONS.type(t), cap(t))).join("")}</div>
    <div class="fg">${RARITIES.map((r) => toggle("rarity", r, ICONS.rarity(r), cap(r))).join("")}</div>
    <div class="fg">
      <select data-f="for" title="Only cards a deck with this legend may play">${opts([["", "any legend"], ...legendOptions.map((l) => [l.name.toLowerCase(), l.name])])}</select>
      <select data-f="keyword">${opts([["", "any keyword"], ...allKeywords.map((k) => [k, cap(k)])])}</select>
      <select data-f="set">${opts([["", "any set"], ...SETS.map((x) => [x.id.toLowerCase(), `${x.id} · ${x.name}`])])}</select>
      <select data-f="sort">${opts(SORTS)}</select>
      <select data-f="group">${opts(GROUPINGS)}</select>
      <button type="button" class="clear" title="Clear the search">✕</button>
    </div>`;
}

function syncFilters(q) {
  const dom = readDomains(q, domainMode);
  $("#filters [data-f=dmode]").value = dom.mode;
  const on = { domain: dom.vals, energy: readList(q, "energy"), type: readList(q, "type"), rarity: readList(q, "rarity") };
  $("#filters").querySelectorAll(".tg").forEach((b) => b.classList.toggle("on", on[b.dataset.f].includes(b.dataset.v)));
  for (const f of ["for", "keyword", "set", "sort", "group"]) {
    const sel = $(`#filters select[data-f=${f}]`), v = readTerm(q, f)?.raw ?? "";
    if (v && ![...sel.options].some((o) => o.value === v)) sel.add(new Option(v, v)); // typed by hand
    sel.value = v;
  }
}

$("#filters").addEventListener("click", (e) => {
  const q = $("#q").value;
  if (e.target.closest(".clear")) return setQuery("", true);
  const b = e.target.closest(".tg");
  if (!b) return;
  const { f, v } = b.dataset;
  if (f === "domain") {
    const { mode, vals } = readDomains(q, domainMode);
    domainMode = mode;
    return setQuery(writeDomains(q, mode, vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v]), true);
  }
  const vals = readList(q, f);
  const next = vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v];
  setQuery(writeTerm(q, f, next.length ? `${{ energy: "e", type: "t", rarity: "r" }[f]}:${next.join("|")}` : ""), true);
});
$("#filters").addEventListener("change", (e) => {
  const sel = e.target.closest("select");
  if (!sel) return;
  const q = $("#q").value, f = sel.dataset.f, v = sel.value;
  if (f === "dmode") {
    domainMode = v;
    return setQuery(writeDomains(q, v, readDomains(q, domainMode).vals), true);
  }
  const name = { for: "for", keyword: "kw", set: "set", sort: "sort", group: "group" }[f];
  setQuery(writeTerm(q, f, v ? `${name}:${quoteVal(v)}` : ""), true);
});
// the results as names, ids, a link back to them or a CSV; the button says what it did for a moment
$("#export .menu").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-export]");
  if (!b || !current) return;
  const kind = b.dataset.export, text = exportList(current, kind), label = b.textContent;
  const n = kind === "names" ? text.split("\n").filter(Boolean).length : current.count;
  try {
    if (kind === "csv") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
      a.download = "riftbound-cards.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      b.textContent = `Downloaded ${n} rows`;
    } else {
      await navigator.clipboard.writeText(kind === "link" ? `${location.href.split("#")[0]}#${encodeURIComponent(text)}` : text);
      b.textContent = `Copied ${n}`;
    }
  } catch (err) { b.textContent = "Couldn't copy"; }
  setTimeout(() => { b.textContent = label; $("#export").open = false; }, 1200);
});
$("#filter-toggle").addEventListener("click", () => {
  const hidden = document.body.toggleAttribute("data-nofilters");
  localStorage.setItem("rb-filters", hidden ? "off" : "on");
});

// ---------- suggestions ----------
// ↑/↓ pick, Tab or click accepts (Enter too once one is picked), Esc closes. A field name accepted
// goes straight on to its values.

const sug = { items: [], from: 0, to: 0, sel: -1 };
function showSuggestions() {
  const q = $("#q"), box = $("#suggest");
  Object.assign(sug, suggest(q.value, q.selectionStart), { sel: -1 });
  if (!sug.items.length || document.activeElement !== q) { box.hidden = true; return; }
  box.innerHTML = sug.items.map((it, i) => `<li data-i="${i}">${esc(it.label)}${it.hint ? ` <small>${esc(it.hint)}</small>` : ""}</li>`).join("");
  Object.assign(box.style, { left: `${q.offsetLeft}px`, top: `${q.offsetTop + q.offsetHeight + 4}px`, minWidth: `${Math.min(q.offsetWidth, 360)}px` });
  box.hidden = false;
}
function pickSuggestion(i) {
  sug.sel = (i + sug.items.length) % sug.items.length;
  $("#suggest").querySelectorAll("li").forEach((li, j) => li.classList.toggle("on", j === sug.sel));
}
function acceptSuggestion(i) {
  const q = $("#q"), it = sug.items[i], v = q.value;
  const next = v.slice(0, sug.from) + it.insert + v.slice(sug.to);
  const caret = sug.from + it.insert.length;
  setQuery(next, false);
  q.setSelectionRange(caret, caret);
  showSuggestions();
}
$("#q").addEventListener("keydown", (e) => {
  if ($("#suggest").hidden) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); pickSuggestion(sug.sel + (e.key === "ArrowDown" ? 1 : sug.sel < 0 ? 0 : -1)); }
  else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); acceptSuggestion(Math.max(sug.sel, 0)); }
  else if (e.key === "Enter" && sug.sel >= 0) { e.preventDefault(); e.stopImmediatePropagation(); acceptSuggestion(sug.sel); }
  else if (e.key === "Escape") { e.preventDefault(); $("#suggest").hidden = true; }
});
$("#q").addEventListener("input", showSuggestions);
$("#q").addEventListener("click", showSuggestions);
$("#q").addEventListener("blur", () => { $("#suggest").hidden = true; });
$("#suggest").addEventListener("mousedown", (e) => { // mousedown keeps the focus in the search
  const li = e.target.closest("li");
  if (li) { e.preventDefault(); acceptSuggestion(Number(li.dataset.i)); }
});

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
  detail(Number(s), Number(el.dataset.i));
});
$("#detail").addEventListener("click", (e) => { if (e.target.id === "detail") e.target.close(); });
$("#detail").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); step(e.key === "ArrowLeft" ? -1 : 1); }
});
window.addEventListener("hashchange", () => { $("#q").value = decodeURIComponent(location.hash.slice(1)); render(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); $("#q").select(); }
});

buildFilters();
// on a phone the filters start folded away, unless the Filters button opened them before
const filtersDefault = S.showFilters === false || matchMedia("(max-width: 700px)").matches ? "off" : "on";
if ((localStorage.getItem("rb-filters") || filtersDefault) === "off") document.body.setAttribute("data-nofilters", "");
$("#synced").textContent = `${CARDS.length} cards · synced ${synced.slice(0, 10)}`;
$("#q").value = decodeURIComponent(location.hash.slice(1));
render();

// offline use on the website (sw.js); file:// has no service workers
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js");
