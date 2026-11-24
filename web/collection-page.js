"use strict";
// The collection page: totals, how full each set is, the binder of one set, and Add (scan, quick entry, a pasted
// list). #OGN opens a set. Needs cardview.js, collection.js and scan.js first.

// every printing, by the set it was printed for, in number order
const BINDER = new Map();
for (const r of EXPANDED) {
  if (r.supertype === "Token") continue;
  if (!BINDER.has(r.p.set)) BINDER.set(r.p.set, []);
  BINDER.get(r.p.set).push({ ...r, _exp: true });
}
for (const list of BINDER.values()) list.sort((a, b) => (a.p.num ?? 999) - (b.p.num ?? 999) || a.p.id.localeCompare(b.p.id));
const setName = (id) => SETS.find((s) => s.id === id)?.name || id;
const SET_LIST = [...BINDER.keys()].sort((a, b) => SET_ORDER.indexOf(a) - SET_ORDER.indexOf(b));
const recall = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
// the biggest set is the first choice
let set = recall("rb-set", [...SET_LIST].sort((a, b) => BINDER.get(b).length - BINDER.get(a).length)[0]);
let show = recall("rb-binder", "all");
let shown = []; // the tiles' rows

function totals() {
  const all = STORE.all("coll").filter((r) => r.data.n > 0);
  const copies = all.reduce((n, r) => n + r.data.n, 0);
  const cards = new Set(all.map((r) => PRINTS.get(r.id.toUpperCase())?.card.id).filter(Boolean)).size;
  $("#totals").innerHTML = `<span><b>${copies}</b> card${copies === 1 ? "" : "s"}</span><span><b>${cards}</b> different</span><span><b>${all.length}</b> printing${all.length === 1 ? "" : "s"}</span>`;
  $("#sets").innerHTML = SET_LIST.map((s) => {
    const list = BINDER.get(s), have = list.filter((r) => COLL.n(r.p.id)).length;
    return `<button type="button" class="set-tile" data-set="${esc(s)}" aria-pressed="${s === set}"><b>${esc(setName(s))}</b><small>${have} / ${list.length}</small><span class="bar"><i style="width:${100 * have / list.length}%"></i></span></button>`;
  }).join("");
}
function binder() {
  const name = $("#name").value.trim().toLowerCase();
  const from = name ? SET_LIST.flatMap((s) => BINDER.get(s)).filter((r) => r.name.toLowerCase().includes(name) || r.p.id.toLowerCase().startsWith(name)) : BINDER.get(set) || [];
  shown = from.filter((r) => show === "all" || (COLL.n(r.p.id) > 0) === (show === "owned"));
  const what = { all: "printings", owned: "printings you have", missing: "printings missing" }[show];
  $("#results").innerHTML = `<section style="--w:${S.cardWidth}px"><h2>${esc(name ? `“${$("#name").value.trim()}”` : setName(set))} <small>${shown.length} ${what}</small></h2>${shown.length ? gridSection(shown, true)
    : `<p class="empty">${show === "owned" && !name ? "Nothing from this set yet. <b>Add cards</b> scans them, or tap + on a card under <b>All</b>." : "No cards here."}</p>`}</section>`;
}

$("#sets").addEventListener("click", (e) => {
  const b = e.target.closest("[data-set]");
  if (!b) return;
  $("#name").value = "";
  if (location.hash === `#${b.dataset.set}`) { pick(b.dataset.set); return; }
  location.hash = b.dataset.set;
});
function pick(s) {
  if (!BINDER.has(s)) return;
  set = s;
  remember("rb-set", s);
  $("#sets").querySelectorAll("[data-set]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.set === s));
  binder();
}
const fromHash = () => { const s = decodeURIComponent(location.hash.slice(1)).toUpperCase(); if (s) pick(s); };
window.addEventListener("hashchange", fromHash);

$("#show-form").addEventListener("change", (e) => { show = e.target.value; remember("rb-binder", show); binder(); });
let nameTimer;
$("#name").addEventListener("input", () => { clearTimeout(nameTimer); nameTimer = setTimeout(binder, 150); });

let at = 0;
onStep = (d) => { if (shown[at + d]) open(at + d); };
function open(i) { at = i; showCard(shown[i], `${i + 1} / ${shown.length}`); }
$("#results").addEventListener("click", (e) => { const el = e.target.closest("[data-i]"); if (el) open(Number(el.dataset.i)); });

// hover a card and press + or −
let hovered = null;
$("#results").addEventListener("mouseover", (e) => { hovered = e.target.closest("[data-id]")?.dataset.id ?? null; });
$("#results").addEventListener("mouseleave", () => { hovered = null; });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !e.target.closest("input, textarea, select") && !$("dialog[open]")) { e.preventDefault(); $("#name").focus(); return; }
  if (!hovered || $("dialog[open]") || e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
  const d = { "+": 1, "=": 1, "-": -1, "_": -1 }[e.key];
  if (d) { e.preventDefault(); $(`#results [data-own="${CSS.escape(hovered)}"] [data-d="${d}"]`)?.click(); }
});

// the version that + and scanning count, one choice for both
addAs = recall("rb-add-as", "");
if (!(addAs in VERSIONS)) addAs = "";
const asForms = document.querySelectorAll("form.as");
function showAs() { for (const f of asForms) { f.lang.value = langOf(addAs); f.foil.checked = isFoil(addAs); } }
for (const f of asForms) {
  f.addEventListener("submit", (e) => e.preventDefault());
  f.addEventListener("change", () => { addAs = verOf(f.lang.value, f.foil.checked); remember("rb-add-as", addAs); showAs(); });
}
showAs();

// ---------- Add ----------

// what was just scanned, until it's filed in the box: the list in filing order, to tick off
const FILE_KEY = "rb-filing"; // {items: [{id, n, ver}], done: [index]}
const toFile = () => { try { return JSON.parse(localStorage.getItem(FILE_KEY)); } catch { return null; } };
const setToFile = (f) => { try { if (f) localStorage.setItem(FILE_KEY, JSON.stringify(f)); else localStorage.removeItem(FILE_KEY); } catch { /* */ } showFile(); };
function showFile() {
  const f = toFile(), left = f ? f.items.length - f.done.length : 0;
  $("#file").hidden = !left;
  $("#file").textContent = `File ${left}`;
}
function fileSheet() {
  const f = toFile();
  if (!f) return;
  // the box as it was before this batch, so a new card isn't "already there"
  const mine = new Map();
  for (const i of f.items) mine.set(i.id, (mine.get(i.id) || 0) + i.n);
  const list = filing(f.items.map((i, at) => ({ ...i, at })), STORE.all("coll").filter((r) => r.data.n > (mine.get(r.id) || 0)).map((r) => r.id));
  let last = "";
  const d = sheet({ title: "File these", cls: "wide tall", onClose: showFile, html: `<p class="note">In the order of your box. Tap a card once it's in.</p><ul class="file-list">${list.map((x) => {
    const pl = pileOf(x.card, x.p), head = pl !== last ? `<li class="pile-head">${pl}</li>` : "";
    last = pl;
    return `${head}<li><button type="button" class="list-row" data-at="${x.at}" aria-pressed="${f.done.includes(x.at)}">${x.p.img ? `<img src="${esc(x.p.img)}" alt="" loading="lazy">` : ""}<span class="txt"><b>${x.n > 1 ? `${x.n}× ` : ""}${esc(x.card.name)} <small>${esc(x.id)} · ${VERSIONS[x.ver || ""]}</small></b><small class="place">${placeText(x)}</small></span><span class="tick" aria-hidden="true">✓</span></button></li>`;
  }).join("")}</ul><div class="row end sticky"><button type="button" class="btn tonal all">All filed</button></div>` });
  d.addEventListener("click", (e) => {
    const b = e.target.closest("[data-at]");
    if (!b) return;
    const at = Number(b.dataset.at), on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", on);
    f.done = on ? [...f.done, at] : f.done.filter((x) => x !== at);
    setToFile(f);
  });
  $(".all", d).onclick = () => { setToFile(null); d.close(); };
}
$("#file").onclick = fileSheet;
showFile();

const openScan = initScan((items) => {
  COLL.apply(items);
  // what an earlier batch still has to file stays on the list
  const f = toFile(), rest = f ? f.items.filter((_, i) => !f.done.includes(i)) : [];
  for (const i of items) { const same = rest.find((x) => x.id === i.id && (x.ver || "") === (i.ver || "")); if (same) same.n += i.n; else rest.push({ ...i }); }
  setToFile({ items: rest, done: [] });
});
let lastSet = null;
$("#add").onclick = () => {
  const d = sheet({ title: "Add cards", cls: "add-sheet", html: `
    <button type="button" class="list-row scan"><span class="lead" aria-hidden="true">📷</span><span><b>Scan</b><small>Hold cards in front of the camera, one after another</small></span></button>
    <button type="button" class="list-row quick"><span class="lead" aria-hidden="true">⌨</span><span><b>Quick entry</b><small>Type numbers: ogn 42, then 43, 44 …</small></span></button>
    <button type="button" class="list-row paste"><span class="lead" aria-hidden="true">📋</span><span><b>Paste a list</b><small>Names, printing ids, a CSV or a deck code</small></span></button>` });
  const go = (cls, fn) => { $(cls, d).onclick = () => { d.close(); fn(); }; };
  go(".scan", openScan); go(".quick", quickEntry); go(".paste", pasteList);
};

// one printing per Enter; a number alone reuses the last set
function quickEntry() {
  const d = sheet({ title: "Quick entry", html: `<form><label class="field"><span>Set and number</span><input name="e" class="mono" placeholder="ogn 42" spellcheck="false" autocomplete="off" autocapitalize="off" enterkeyhint="done"></label></form>
    <div class="entry-out" aria-live="polite"><p class="note"><code>OGN-042a x2</code> two of an alt art · <code>42</code> same set as before · <code>-ogn 42</code> takes one off · <code>ogn 42 zh foil</code> Chinese, foil (else: ${VERSIONS[addAs]}, as chosen on the page)</p></div>` });
  const out = $(".entry-out", d), inp = $("input", d);
  inp.focus();
  $("form", d).onsubmit = (ev) => {
    ev.preventDefault();
    const e = parseEntry(inp.value, lastSet);
    if (e.error != null) { if (e.error) out.innerHTML = `<p class="err">${esc(e.error)}</p>`; return; }
    const ver = e.ver ?? addAs, before = COLL.n(e.id), n = COLL.add(e.id, e.n, ver), src = e.p.img || imgSrc({ p: e.p, printings: e.card.printings });
    lastSet = e.set;
    inp.value = "";
    out.innerHTML = `<div class="entered">${src ? `<img src="${esc(src)}" alt="">` : ""}<span><b>${esc(e.card.name)}</b><small>${esc(e.id)}${e.p.kind ? ` · ${esc(e.p.kind)}` : ""} · ${VERSIONS[ver]}</small><span class="now">${n - before > 0 ? "+" : ""}${n - before} · you have <b>${n}</b></span></span><button type="button" class="btn tonal">Undo</button></div>`;
    $("button", out).onclick = () => { COLL.add(e.id, before - n, ver); out.innerHTML = `<p class="note">Undone: ${esc(e.card.name)}</p>`; inp.focus(); };
  };
}

function pasteList() {
  const d = sheet({ title: "Paste a list", cls: "wide", html: `<form>
    <p class="note">One per line: <code>ogn 42 3</code>, <code>OGN-042a</code>, <code>3 Jinx, Demolitionist</code> (its first printing), <code>1 Jinx, Demolitionist (OGN-030a)</code>, each with <code>zh</code> and <code>foil</code> at the end for those;
      a CSV with an <code>id</code> column and <code>own</code> or <code>count</code> (the search page's export); or a deck code (one of each card in it).</p>
    <textarea name="t" rows="7" class="mono" spellcheck="false" autocomplete="off" aria-label="The list"></textarea>
    ${seg("Counts", "mode", [["add", "Add to mine"], ["set", "Replace mine"]], "add")}
    <div class="pv"></div>
    <div class="row end"><button class="btn filled" disabled>Apply</button></div></form>` });
  const f = $("form", d);
  let pasted = null, t;
  const preview = () => {
    pasted = parseBulk(f.t.value);
    const replace = f.mode.value === "set", { items, problems } = pasted;
    $(".pv", d).innerHTML = (problems.length ? `<ul class="problems">${problems.slice(0, 20).map((p) => `<li>${esc(p)}</li>`).join("")}${problems.length > 20 ? `<li>… ${problems.length - 20} more</li>` : ""}</ul>` : "")
      + (items.length ? `<p>${items.length} printings, ${items.reduce((n, i) => n + i.n, 0)} cards</p><table class="gf-table">${items.map((i) => {
        const now = replace && i.ver == null ? COLL.n(i.id) : COLL.v(i.id, i.ver || ""), after = Math.max(0, replace ? i.n : now + i.n);
        return `<tr><td>${esc(i.card.name)} <small>${esc(i.id)}${i.ver ? ` · ${VERSIONS[i.ver]}` : ""}</small></td><td class="n">${now} → <b>${after}</b></td></tr>`;
      }).join("")}</table>` : "");
    $(".btn.filled", d).disabled = !items.length;
  };
  f.t.oninput = () => { clearTimeout(t); t = setTimeout(preview, 250); };
  f.addEventListener("change", preview);
  f.onsubmit = (e) => {
    e.preventDefault();
    clearTimeout(t);
    preview();
    if (!pasted.items.length) return;
    const before = new Map(pasted.items.map((i) => [i.id, STORE.get("coll", i.id)]));
    COLL.apply(pasted.items, f.mode.value);
    d.close();
    toast(`${pasted.items.length} printing${pasted.items.length === 1 ? "" : "s"} ${f.mode.value === "set" ? "set" : "added"}`, { undo: () => { for (const [id, r] of before) if (r) STORE.put("coll", id, r); else STORE.del("coll", id); } });
  };
  f.t.focus();
}

// a tile's own count updates in cardview.js; the list itself only where it filters, and not while tapping + on it
STORE.on((kinds) => { if (kinds.has("coll")) totals(); });

$("#synced").textContent = `${CARDS.length} cards · synced ${synced.slice(0, 10)}`;
if (!BINDER.has(set)) set = SET_LIST[0];
for (const r of $("#show-form").elements) if (r.name === "show") r.checked = r.value === show;
totals();
binder();
fromHash();
