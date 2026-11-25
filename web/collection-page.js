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

// ---------- copies counted as a version their printing doesn't exist in ----------

function foilNote() {
  let dismissed = [];
  try { dismissed = JSON.parse(localStorage.getItem("rb-foil-ok")) || []; } catch { /* */ }
  const wrong = wrongFoils().filter((x) => !dismissed.includes(`${x.id} ${x.from}`)), n = wrong.reduce((s, x) => s + x.n, 0);
  const box = $("#foil-note");
  box.hidden = !n;
  if (!n) return;
  box.innerHTML = `<span><b>${n}</b> cop${n === 1 ? "y is" : "ies are"} counted as a version that isn't made, mostly foil-only cards as non-foil.</span><button type="button" class="btn text leave">Leave them</button><button type="button" class="btn tonal fix">Correct them</button>`;
  $(".leave", box).onclick = () => { remember("rb-foil-ok", JSON.stringify([...dismissed, ...wrong.map((x) => `${x.id} ${x.from}`)])); foilNote(); };
  $(".fix", box).onclick = () => {
    const before = new Map(wrong.map((x) => [x.id, STORE.get("coll", x.id)]));
    for (const x of wrong) { COLL.add(x.id, x.n, x.to); COLL.add(x.id, -x.n, x.from); }
    binder();
    toast(`${n} corrected`, { undo: () => { for (const [id, r] of before) STORE.put("coll", id, r); binder(); } });
  };
}

// ---------- Add ----------

// what was just scanned, until it's filed in the box: the list in filing order, to tick off (FILING in collection.js)
const FILE_KEY = "rb-filing";
const toFile = () => { let f = null; try { f = JSON.parse(localStorage.getItem(FILE_KEY)); } catch { /* */ } return FILING.read(f); };
const setToFile = (f) => { try { if (f.items.length || f.done.length) localStorage.setItem(FILE_KEY, JSON.stringify(f)); else localStorage.removeItem(FILE_KEY); } catch { /* */ } showFile(); };
function showFile() {
  const n = toFile().items.reduce((s, i) => s + i.n, 0);
  $("#file").hidden = !n;
  $("#file").textContent = `File ${n}`;
}
// everything as it is now, to come back to with undo
function keepState(ids) {
  const file = toFile(), recs = ["coll", "aside"].flatMap((kind) => [...new Set(ids)].map((id) => [kind, id, STORE.get(kind, id)]));
  return () => {
    for (const [kind, id, r] of recs) if (r) STORE.put(kind, id, r); else STORE.del(kind, id);
    setToFile(file);
  };
}
const copies = (n, what = "") => `${n} ${what}${what ? " " : ""}cop${n === 1 ? "y" : "ies"}`;
// {zh: 2, foil: 1} -> "2 Chinese and 1 English foil"
const verList = (counts) => Object.entries(counts).map(([v, n]) => `${n} ${VERSIONS[v]}`).join(" and ");
const cardRow = (x, { key, small, tick = "", pressed = false }) => `<button type="button" class="list-row" data-k="${esc(key)}" aria-pressed="${pressed}">${x.p.img ? `<img src="${esc(x.p.img)}" alt="" loading="lazy" draggable="false">` : ""}<span class="txt"><b>${x.n > 1 ? `${x.n}× ` : ""}${esc(x.card.name)} <small>${esc(x.id)} · ${VERSIONS[x.ver || ""]}</small></b>${small}</span>${tick ? `<span class="tick" aria-hidden="true">${tick}</span>` : ""}</button>`;
// the rows of a list, [[key, html, cls]], keeping those that stay as they are, so pictures don't flash and the list
// doesn't jump
function drawRows(ul, rows) {
  const scroller = ul.closest(".sheet-body"), top = scroller.scrollTop, old = new Map([...ul.children].map((li) => [li.dataset.row, li]));
  const focus = [...ul.children].findIndex((li) => li.contains(document.activeElement));
  ul.replaceChildren(...rows.map(([key, html, cls = ""]) => {
    let li = old.get(key);
    if (!li || li.html !== html) { li = document.createElement("li"); li.dataset.row = key; li.html = html; li.innerHTML = html; }
    li.className = cls;
    return li;
  }));
  scroller.scrollTop = top;
  if (focus >= 0) [...ul.children].slice(focus).map((li) => $("button", li)).find(Boolean)?.focus({ preventScroll: true });
}

// n copies of a version, corrected: which printing, how many of which version, and whether every copy is kept.
// onSave(printing id, {ver: n})
function editCopies({ id, n, ver }, onSave) {
  const { card } = PRINTS.get(id.toUpperCase());
  let to = id, counts = { [ver || ""]: n };
  const d = sheet({ title: card.name, html: `<form>
    ${card.printings.length > 1 ? `<label class="field"><span>Printing</span><select name="printing">${card.printings.map((p) => `<option value="${esc(p.id)}"${p.id === id ? " selected" : ""}>${esc(p.id)}${p.kind ? ` · ${esc(p.kind)}` : ""}</option>`).join("")}</select></label>` : `<p class="note">${esc(id)}</p>`}
    <div class="edit-vers"></div>
    <div><label class="chip-check keep"><input type="checkbox" name="keep"${KEEP.all(card) ? " checked" : ""}><span>Keep every copy</span></label><p class="note">Otherwise more than ${KEEP.size(card)} are spares.</p></div>
    <div class="row end"><button type="button" class="btn text danger-text gone">Take off</button><button class="btn filled">Save</button></div></form>` });
  const f = $("form", d), read = () => { for (const i of f.querySelectorAll(".edit-vers input")) counts[i.name.slice(1)] = Math.max(0, parseInt(i.value) || 0); };
  const draw = () => {
    const langs = [...new Set([...myLangs(), ...Object.keys(counts).filter((v) => counts[v]).map(langOf)])];
    const vers = langs.flatMap((l) => [verOf(l), verOf(l, true)]).filter((v) => counts[v] || autoVer(to, v) === v);
    $(".edit-vers", d).innerHTML = vers.map((v) => `<div><span>${VERSIONS[v]}</span>${stepper(`v${v}`, counts[v] || 0, { label: VERSIONS[v] })}</div>`).join("");
  };
  draw();
  f.printing?.addEventListener("change", () => {
    read();
    const fixed = PRINTS.get(to.toUpperCase()).p.foil, moved = {};
    to = f.printing.value;
    for (const [v, c] of Object.entries(counts)) if (c) { const x = autoVer(to, verOf(langOf(v), fixed ? isFoil(addAs) : isFoil(v))); moved[x] = (moved[x] || 0) + c; }
    counts = moved;
    draw();
  });
  const done = () => { if (f.keep.checked !== KEEP.all(card)) KEEP.setAll(card, f.keep.checked); d.close(); onSave(to, Object.fromEntries(Object.entries(counts).filter(([, c]) => c))); };
  f.onsubmit = (e) => { e.preventDefault(); read(); done(); };
  $(".gone", d).onclick = () => { counts = {}; done(); };
}

function fileSheet() {
  const f = toFile();
  let rows = new Map(); // key -> {item, aside} | {done}
  const d = sheet({ title: "File these", cls: "wide tall", onClose: showFile, html: `<p class="note">In the order of your box. Tap a card once it's in, hold it to change it.</p><ul class="file-list"></ul><div class="row end sticky"><button type="button" class="btn tonal all">All filed</button></div>` });
  const ul = $(".file-list", d);
  function draw() {
    rows = new Map();
    const list = [], s = sortOut(f.items), part = (i, aside, n) => ({ item: i, id: i.id, ver: i.ver, n, aside });
    const into = filing(f.items.flatMap((i, k) => (s[k].box ? [{ ...part(i, false, s[k].box), out: s[k].out }] : [])), boxedIds(f.items));
    const aside = filing(f.items.flatMap((i, k) => (s[k].aside ? [{ ...part(i, true, s[k].aside), out: s[k].box ? {} : s[k].out }] : [])), []);
    let last = "";
    const add = (x, head, small) => {
      const key = `${x.id} ${x.ver || ""} ${x.aside ? "aside" : "box"}`, out = Object.keys(x.out).length ? `<small class="take-out">take out ${verList(x.out)}</small>` : "";
      if (head !== last) list.push([`head ${head}`, head, "pile-head"]);
      last = head;
      rows.set(key, x);
      list.push([key, cardRow(x, { key, small: small + out, tick: "✓" })]);
    };
    for (const x of into) add(x, pileOf(x.card, x.p), `<small class="place">${placeText(x)}</small>`);
    for (const x of aside) add(x, "<b>Spares</b> · put aside", "");
    if (!list.length) list.push(["none", "Everything is filed.", "empty"]);
    if (f.done.length) list.push(["head done", `<b>Filed</b> · ${f.done.reduce((n, x) => n + x.n, 0)}`, "pile-head"]);
    for (const x of f.done) {
      const hit = PRINTS.get(x.id.toUpperCase());
      if (!hit) continue;
      rows.set(x.k, { done: x });
      list.push([x.k, cardRow({ ...x, ...hit }, { key: x.k, small: x.aside ? `<small class="place">spare</small>` : "", tick: "✓", pressed: true })]);
    }
    $(".all", d).disabled = !f.items.length;
    drawRows(ul, list);
  }
  const changed = () => { setToFile(f); draw(); };
  // f is kept by the handlers: what undo brings back goes into it
  const undoing = (restore) => () => { restore(); Object.assign(f, toFile()); draw(); };
  ul.addEventListener("click", (e) => {
    const x = rows.get(e.target.closest("[data-k]")?.dataset.k);
    if (!x) return;
    if (x.done) { FILING.untick(f, x.done); return changed(); }
    const undo = undoing(keepState([x.id]));
    FILING.tick(f, x.item, x.aside);
    changed();
    toast(`${x.card.name} ${x.aside ? "put aside" : "filed"}`, { undo });
  });
  onHold(ul, "[data-k]", (el) => {
    const x = rows.get(el.dataset.k);
    if (!x) return;
    const from = x.done || x, was = { id: from.id, n: from.n, ver: from.ver || "" };
    editCopies(was, (to, counts) => {
      const same = to === was.id && Object.keys(counts).length === 1 && counts[was.ver] === was.n;
      if (same) return draw(); // maybe kept now, so not a spare
      const restore = keepState([was.id, to]);
      if (x.done) FILING.untick(f, x.done);
      FILING.edit(f, was, to, counts);
      changed();
      toast(!Object.keys(counts).length ? "Taken off" : x.done ? "Changed, to be filed again" : "Changed", { undo: undoing(restore) });
    });
  });
  $(".all", d).onclick = () => {
    const undo = keepState(f.items.map((i) => i.id)), n = f.items.reduce((s, i) => s + i.n, 0);
    for (let i; (i = f.items[0]); ) if (!FILING.tick(f, i, false) && !FILING.tick(f, i, true)) f.items.shift();
    f.done = [];
    setToFile(f);
    d.close();
    toast(`${n} filed`, { undo });
  };
  draw();
}
$("#file").onclick = fileSheet;
showFile();

// ---------- spares ----------

// what is beyond a playset: still in the box, put aside, or aside and wanted back
let sparesTimer;
function showSpares() {
  clearTimeout(sparesTimer);
  sparesTimer = setTimeout(() => {
    const { out, aside } = spares(toFile().items), n = [...out, ...aside].reduce((s, x) => s + x.n, 0);
    $("#spares").hidden = !n;
    $("#spares").textContent = `${n} spare${n === 1 ? "" : "s"}`;
  }, 60);
}
function sparesSheet() {
  const size = S.playset || {};
  const d = sheet({ title: "Spares", cls: "wide tall", html: `<p class="note">Copies beyond ${size.other ?? 3} of a printing (legends and battlefields ${size.Legend ?? 1}). Hold a card to change it, take off what's sold, or keep every copy.</p>
    <form>${seg("Keep first", "first", [["foil", "Foils"], ["plain", "Non-foils"]], KEEP.foilFirst() ? "foil" : "plain")}</form>
    <ul class="file-list"></ul><div class="row end sticky"><button type="button" class="btn tonal copy">Copy the list</button></div>` });
  const ul = $(".file-list", d);
  let rows = new Map(), r;
  const total = (l) => l.reduce((n, x) => n + x.n, 0);
  function draw() {
    r = spares(toFile().items);
    rows = new Map();
    const list = [];
    for (const [kind, head] of [["out", "Take out of the box"], ["back", "Put back in the box"], ["aside", "Put aside"]]) {
      if (!r[kind].length) continue;
      list.push([`head ${kind}`, `<span><b>${head}</b> · ${total(r[kind])}</span>${kind === "aside" ? "" : `<button type="button" class="btn text every" data-kind="${kind}">All done</button>`}`, "pile-head"]);
      for (const x of r[kind]) {
        const key = `${kind} ${x.id} ${x.ver}`;
        rows.set(key, { ...x, kind });
        list.push([key, cardRow(x, { key, small: "", tick: kind === "aside" ? "" : "✓" })]);
      }
    }
    if (!list.length) list.push(["none", "No spares.", "empty"]);
    $(".copy", d).disabled = !r.aside.length && !r.out.length;
    drawRows(ul, list);
  }
  const move = (list, kind) => {
    const restore = keepState(list.map((x) => x.id)), n = total(list);
    for (const x of list) ASIDE.add(x.id, x.ver, kind === "out" ? x.n : -x.n);
    draw();
    toast(`${copies(n)} ${kind === "out" ? "put aside" : "put back"}`, { undo: () => { restore(); draw(); } });
  };
  ul.addEventListener("click", (e) => {
    const all = e.target.closest(".every"), x = rows.get(e.target.closest("[data-k]")?.dataset.k);
    if (all) return move(r[all.dataset.kind], all.dataset.kind);
    if (x && x.kind !== "aside") move([x], x.kind);
  });
  onHold(ul, "[data-k]", (el) => {
    const x = rows.get(el.dataset.k);
    if (x) editCopies(x, (to, counts) => {
      if (to === x.id && Object.keys(counts).length === 1 && counts[x.ver] === x.n) return draw();
      const restore = keepState([x.id, to]), aside = x.kind !== "out";
      if (aside) ASIDE.add(x.id, x.ver, -x.n);
      COLL.add(x.id, -x.n, x.ver);
      for (const [v, c] of Object.entries(counts)) { COLL.add(to, c, v); if (aside) ASIDE.add(to, v, c); }
      draw();
      toast(Object.keys(counts).length ? "Changed" : "Taken off", { undo: () => { restore(); draw(); } });
    });
  });
  $("form", d).addEventListener("change", (e) => { KEEP.setFoilFirst(e.target.value === "foil"); draw(); });
  // as "Paste a list" reads it; what's aside, and what's beyond a playset but still in the box
  $(".copy", d).onclick = async () => {
    const sum = new Map();
    for (const x of [...r.aside, ...r.out]) { const k = `${x.id} ${x.ver}`, o = sum.get(k); if (o) o.n += x.n; else sum.set(k, { ...x }); }
    const text = [...sum.values()].map((x) => `${x.n} ${x.card.name} (${x.id})${langOf(x.ver) === "en" ? "" : ` ${langOf(x.ver)}`}${isFoil(x.ver) ? " foil" : ""}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Couldn't copy"); }
  };
  draw();
}
$("#spares").onclick = sparesSheet;

const openScan = initScan((items) => {
  COLL.apply(items);
  // what an earlier batch still has to file stays on the list
  const f = { items: toFile().items, done: [] };
  for (const i of items) FILING.put(f, i);
  setToFile(f);
}, () => toFile().items);
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
    const ver = isFoil(e.ver) ? e.ver : autoVer(e.id, e.ver ?? addAs), before = COLL.n(e.id), n = COLL.add(e.id, e.n, ver), src = e.p.img || imgSrc({ p: e.p, printings: e.card.printings });
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
        const now = replace && i.ver == null ? COLL.n(i.id) : COLL.v(i.id, i.ver ?? autoVer(i.id)), after = Math.max(0, replace ? i.n : now + i.n);
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
STORE.on((kinds) => { if (kinds.has("coll")) { totals(); foilNote(); } if (["coll", "aside", "keep"].some((k) => kinds.has(k))) showSpares(); });

$("#synced").textContent = `${CARDS.length} cards · synced ${synced.slice(0, 10)}`;
if (!BINDER.has(set)) set = SET_LIST[0];
for (const r of $("#show-form").elements) if (r.name === "show") r.checked = r.value === show;
totals();
binder();
foilNote();
showSpares();
fromHash();
