"use strict";
// Cards on the page: symbols, rules text, tiles, − n + for a printing, the card dialog (#detail). For the search and
// the collection page. Needs ui.js, query.js, store.js and collection.js first.

const SEARCH = document.body.dataset.page === "cards" ? "" : "index.html"; // where a query link goes
let onStep = () => {}; // ‹ › and ←/→ in the card dialog; the page sets it

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
const versionRows = (id) => `<div class="versions" data-id="${esc(id)}">${Object.entries(VERSIONS).filter(([k]) => myLangs().includes(langOf(k)) || COLL.v(id, k)).map(([k, l]) => `<span class="ver"><span>${l}</span><span class="own" data-own="${esc(id)}" data-ver="${k}"><span role="button" data-d="-1" title="One less">−</span><b>${COLL.v(id, k)}</b><span role="button" data-d="1" title="One more">+</span></span></span>`).join("")}</div>`;
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
    return `<button class="card${r.landscape ? " land" : ""}${binder && !COLL.n(r.p.id) ? " unowned" : ""}" data-i="${i}" data-id="${esc(r.p.id)}" title="${esc(r.name)}">${src ? `<img loading="lazy" src="${esc(src)}" alt="${esc(r.name)}">` : `<span class="noimg">${esc(r.name)}</span>`}${r.printings.length > 1 && !r._exp ? `<span class="nprint">${r.printings.length}</span>` : ""}${binder ? ownCtl(r.p.id) : haveBadge(haveN(r))}</button>`;
  }).join("")}</div>`;
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
    <h3>Printings <small>your copies</small></h3>
    <div class="prints">${r.printings.map((p) => `<div class="prw"><button class="pr" data-id="${esc(p.id + p.kind)}">${ICONS.rarity(p.rarity)} ${esc(p.set)} ${p.num ?? ""} · ${esc(p.rarity)}${p.kind ? ` · ${esc(p.kind)}` : ""}${p.artist ? `<small>${esc(p.artist)}</small>` : ""}</button>${versionRows(p.id)}</div>`).join("")}</div>`;
  d.querySelectorAll(".pr").forEach((b, i) => (b.onclick = () => show(r.printings[i])));
  d.querySelectorAll(".same button").forEach((b) => (b.onclick = () => showCard(FOLDED.find((c) => c.id === b.dataset.id), "")));
  d.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => onStep(Number(b.dataset.step))));
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

$("#detail").addEventListener("click", (e) => { if (e.target.id === "detail") e.target.close(); });
$("#detail").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onStep(e.key === "ArrowLeft" ? -1 : 1); }
});

// − / + anywhere, and the counts follow the store (this tab, another tab, another device)
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-own] [data-d]");
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const { own: id, ver } = b.closest("[data-own]").dataset, d = Number(b.dataset.d);
  // a tile's − takes the chosen version, or else one you do have
  const v = ver ?? (d > 0 || COLL.v(id, addAs) ? addAs : Object.keys(VERSIONS).find((k) => COLL.v(id, k)) ?? addAs);
  COLL.add(id, d, v);
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
