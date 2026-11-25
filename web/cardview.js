"use strict";
// Cards on the page: tiles, − n + for a printing, the card dialog (#detail). For the search and
// the collection page. Needs ui.js, query.js, store.js, collection.js, timeline.js, cardtext.js
// and rulings.js first.

const SEARCH = document.body.dataset.page === "cards" ? "" : "index.html"; // where a query link goes
let onStep = () => {}; // ‹ › and ←/→ in the card dialog; the page sets it

const qlink = (q, text) => `<a href="${SEARCH}#${encodeURIComponent(q)}">${esc(text)}</a>`;
const quote = (s) => /\s/.test(s) ? `"${s}"` : s;

function imgSrc(r) { return r.p.img || r.printings.find((p) => p.img)?.img; }
// − n + for one printing; the buttons are spans because they sit inside the card's button
// which version − and + count: chosen on the collection page, plain English elsewhere
let addAs = "";
const versNote = (id) => Object.keys(VERSIONS).filter((k) => k && COLL.v(id, k)).map((k) => `${COLL.v(id, k)} ${VER_SHORT[k]}`).join(" · ");
// the languages to offer: settings' and the one chosen now
const myLangs = () => [...(S.languages || ["en", "zh"]), langOf(addAs)];
// every version of a printing on its own, in the card dialog
const versionRows = (id) => `<div class="versions" data-id="${esc(id)}">${Object.entries(VERSIONS).filter(([k]) => COLL.v(id, k) || (myLangs().includes(langOf(k)) && k === autoVer(id, k))).map(([k, l]) => `<span class="ver"><span>${l}</span><span class="own" data-own="${esc(id)}" data-ver="${k}"><span role="button" data-d="-1" title="One less">−</span><b>${COLL.v(id, k)}</b><span role="button" data-d="1" title="One more">+</span></span></span>`).join("")}</div>`;
const ownCtl = (id) => {
  const n = COLL.n(id);
  return `<span class="own${n ? "" : " none"}" data-own="${esc(id)}"><span role="button" tabindex="-1" data-d="-1" title="One less">−</span><b>${n}</b><span class="vers">${versNote(id)}</span><span role="button" tabindex="-1" data-d="1" title="One more (hover and press +)">+</span></span>`;
};

// how many of the cards a tile stands for you have: one printing, or any of the folded card's
const haveN = (r) => r._exp ? COLL.n(r.p.id) : r.printings.reduce((n, p) => n + COLL.n(p.id), 0);
const haveBadge = (n) => (n ? `<span class="have" title="You have ${n}">×${n}</span>` : "");

function gridSection(rows, binder = false) {
  return `<div class="grid">${rows.map((r, i) => {
    const src = imgSrc(r);
    return `<button class="card${r.landscape ? " land" : ""}${binder && !COLL.n(r.p.id) ? " unowned" : ""}" data-i="${i}" data-id="${esc(r.p.id)}" title="${esc(r.name)}">${src ? `<img loading="lazy" src="${esc(src)}" alt="${esc(r.name)}">` : `<span class="noimg">${esc(r.name)}</span>`}${r.errata && !binder ? `<span class="errata-b" title="Errata: ${esc(r.errata)}">errata</span>` : ""}${r.printings.length > 1 && !r._exp ? `<span class="nprint">${r.printings.length}</span>` : ""}${binder ? ownCtl(r.p.id) : haveBadge(haveN(r))}</button>`;
  }).join("")}</div>`;
}

// whether copies beyond a playset are spares
const keepCheck = (card) => `<label class="chip-check keep"><input type="checkbox" name="keep" data-keep="${esc(card.id)}"${KEEP.all(card) ? " checked" : ""}><span>Keep every copy</span></label>`;
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
    ${errataLine(r)}
    <div class="tx">${richText(r.text, r)}</div>
    ${r.flavour ? `<p class="flav">${esc(r.flavour)}</p>` : ""}
    <p class="tags">${r.champion ? `Champion: ${qlink(`champ="${r.champion}" group:champion`, r.champion)} · ` : ""}${r.tags.filter((t) => t !== r.champion).map((t) => qlink(`tag="${t}"`, t)).join(", ")}</p>
    ${r.type === "Legend" ? `<p class="tags">${qlink(`for:"${r.name}" group:type`, "Everything this legend's deck may play")}</p>` : ""}
    <div class="rulings" data-rulings="${esc(r.id)}">${rulingsHtml(r)}</div>
    <div class="rulings" data-site="${esc(r.id)}"></div>
    ${sameChampion(r)}
    <h3>Printings <small>your copies</small></h3>
    ${keepCheck(r)}
    <div class="prints">${r.printings.map((p) => `<div class="prw"><button class="pr" data-id="${esc(p.id + p.kind)}">${ICONS.rarity(p.rarity)} ${esc(p.set)} ${p.num ?? ""} · ${esc(p.rarity)}${p.kind ? ` · ${esc(p.kind)}` : ""}${p.artist ? `<small>${esc(p.artist)}</small>` : ""}</button>${versionRows(p.id)}</div>`).join("")}</div>`;
  d.querySelectorAll(".pr").forEach((b, i) => (b.onclick = () => show(r.printings[i])));
  d.querySelectorAll(".same button").forEach((b) => (b.onclick = () => showCard(FOLDED.find((c) => c.id === b.dataset.id), "")));
  d.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => onStep(Number(b.dataset.step))));
  d.querySelector(".close").onclick = () => d.close();
  d.querySelectorAll("a:not([target])").forEach((a) => a.addEventListener("click", () => d.close()));
  d.querySelector(".big").classList.toggle("land", !!r.landscape);
  show(r.p);
  if (!d.open) d.showModal();
  loadSite(d);
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

$("#detail").addEventListener("click", (e) => { if (e.target.id === "detail") e.target.close(); });
$("#detail").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onStep(e.key === "ArrowLeft" ? -1 : 1); }
});

$("#detail").addEventListener("change", (e) => {
  const id = e.target.dataset?.keep;
  if (id) KEEP.setAll(CARDS.find((c) => c.id === id), e.target.checked);
});

// − / + anywhere, and the counts follow the store (this tab, another tab, another device)
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-own] [data-d]");
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const { own: id, ver } = b.closest("[data-own]").dataset, d = Number(b.dataset.d);
  // a tile's − takes the chosen version, or else one you do have
  const as = autoVer(id, addAs), v = ver ?? (d > 0 || COLL.v(id, as) ? as : Object.keys(VERSIONS).find((k) => COLL.v(id, k)) ?? as);
  TIMELINE.record("count", "", () => COLL.add(id, d, v));
}, true);
STORE.on((kinds) => {
  if (!kinds.has("coll")) return;
  document.querySelectorAll("[data-own]").forEach((el) => {
    const { own: id, ver } = el.dataset, n = ver === undefined ? COLL.n(id) : COLL.v(id, ver);
    $("b", el).textContent = n;
    const note = $(".vers", el);
    if (note) note.textContent = versNote(id);
    el.classList.toggle("none", !n);
    if (ver === undefined) el.closest(".card")?.classList.toggle("unowned", !n);
  });
});
