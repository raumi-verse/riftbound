"use strict";
// Errata and your own notes on how a card is ruled. A note is a record of its own (kind "ruling": {card, text, url,
// created}), so notes made on two devices both stay. Needs ui.js, query.js, store.js and cardtext.js first.
//
//   rulingsOf(cardId) -> [{id, card, text, url, created}] newest first     errataLine(card), rulingsHtml(card) -> HTML
//   cardRulings(card)  a card's text, errata and notes in a sheet           rulingsSheet(cards)  those of a deck, and any card's
//   <div data-rulings="cardId"> is kept up to date and its buttons work anywhere

const RULE_CARDS = new Map(CARDS.map((c) => [c.id, c]));
const rulingsOf = (card) => STORE.all("ruling").map(({ id, data }) => ({ id, ...data })).filter((r) => r.card === card)
  .sort((a, b) => (b.created || "").localeCompare(a.created || ""));
// only links that open a page, never javascript: and the like
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

function officialLink(c) {
  const site = S.rulingsSite;
  if (!site?.list) return "";
  const slug = (n) => n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const sure = site.card && !["Signature", "Token", "Basic"].includes(c.supertype) && c.type !== "Rune";
  const url = sure ? site.card.replace("{name}", slug(c.type === "Legend" ? c.name.replace(/^.*?,\s*/, "") : c.name)) : site.list;
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${sure ? "" : "All "}${sure ? "Rulings" : "rulings"} on ${esc(site.name)} ↗</a>`;
}
const errataLine = (c) => (c.errata ? `<p class="errata-line"><span class="errata-b">errata</span> ${esc(c.errata)}. This is the current text; the printed card may say something else.</p>` : "");

function rulingsHtml(c) {
  const notes = rulingsOf(c.id);
  return `<h3>Rulings</h3>${notes.length ? `<ul class="ruling-list">${notes.map((r) => {
    const url = r.url && safeUrl(r.url);
    return `<li data-ruling="${esc(r.id)}"><p>${esc(r.text).replace(/\n/g, "<br>")}</p><small>${r.created ? new Date(r.created).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""}${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener">${esc(new URL(url).hostname.replace(/^www\./, ""))} ↗</a>` : r.url ? ` · ${esc(r.url)}` : ""}</small><button type="button" class="btn text" data-ruling-edit>Edit</button></li>`;
  }).join("")}</ul>` : ""}<div class="row"><button type="button" class="btn tonal" data-ruling-new>＋ Note a ruling</button>${officialLink(c)}</div>`;
}

// write one down, or change it
function rulingForm(card, r = null) {
  const d = sheet({ title: card.name, html: `<form class="fields">
    <label class="field"><span>Ruling</span><textarea name="text" rows="5" required placeholder="How does it work, and when did it matter?">${esc(r?.text || "")}</textarea></label>
    <label class="field"><span>Source</span><input name="url" value="${esc(r?.url || "")}" placeholder="a link, or who said it" autocomplete="off"></label>
    <div class="row end">${r ? `<button type="button" class="btn text danger-text del">Delete</button><span class="grow"></span>` : ""}<button class="btn filled">Save</button></div></form>` });
  const f = $("form", d);
  f.text.focus();
  f.onsubmit = (e) => {
    e.preventDefault();
    const text = f.text.value.trim();
    if (!text) return;
    STORE.put("ruling", r?.id || STORE.uid(), { card: card.id, text, url: f.url.value.trim(), created: r?.created || new Date().toISOString() });
    d.close();
  };
  if (r) $(".del", d).onclick = () => {
    const { id, ...old } = r;
    STORE.del("ruling", id);
    d.close();
    toast("Ruling deleted", { undo: () => STORE.put("ruling", id, old) });
  };
}
document.addEventListener("click", (e) => {
  const box = e.target.closest("[data-rulings]"), card = box && RULE_CARDS.get(box.dataset.rulings);
  if (!card) return;
  if (e.target.closest("[data-ruling-new]")) rulingForm(card);
  const edit = e.target.closest("[data-ruling-edit]");
  if (edit) { const r = rulingsOf(card.id).find((x) => x.id === edit.closest("[data-ruling]").dataset.ruling); if (r) rulingForm(card, r); }
});

function cardRulings(c) {
  if (!c) return;
  const img = cardImg(c);
  sheet({ title: c.name, cls: "wide", html: `<div class="rule-card">${img ? `<img src="${esc(img)}" alt="">` : ""}<div><div class="tx">${errataLine(c)}${richText(c.text, c)}</div></div></div><div class="rulings" data-rulings="${esc(c.id)}">${rulingsHtml(c)}</div>` });
}

// the cards of a list that have errata or a note, and a search for any other
const cardsOfList = (list) => { const d = readDeck(list); return [...new Set([d.legend, d.champion, ...d.main, ...d.battlefields, ...d.runes, ...(d.side || [])].filter(Boolean))]; };
function rulingsSheet(cards) {
  const d = sheet({ title: "Rulings", cls: "wide tall", html: `<input type="search" class="find" placeholder="Any card" aria-label="Find a card" autocomplete="off" spellcheck="false"><div class="found"></div>` });
  const draw = () => {
    const q = $(".find", d).value.trim().toLowerCase();
    const hits = q ? CARDS.filter((c) => c.name.toLowerCase().includes(q)).sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q) || a.name.localeCompare(b.name)).slice(0, 30) : cards.filter((c) => c.errata || rulingsOf(c.id).length);
    $(".found", d).innerHTML = (q ? "" : `<h3>In this deck</h3>`) + (hits.map((c) => {
      const n = rulingsOf(c.id).length, img = cardImg(c);
      return `<button type="button" class="list-row" data-card-rulings="${esc(c.id)}"><span class="art"${img ? ` style="background-image:url('${esc(img)}')"` : ""}></span><span class="txt"><b>${esc(c.name)}</b><small>${[c.errata && `errata: ${esc(c.errata)}`, n && `${n} ruling${n === 1 ? "" : "s"} of yours`].filter(Boolean).join(" · ") || esc(c.type)}</small></span></button>`;
    }).join("") || `<p class="note">${q ? "No card like that." : "No errata or rulings for its cards. Search for a card to note one."}</p>`);
  };
  $(".find", d).oninput = draw;
  $(".found", d).onclick = (e) => { const b = e.target.closest("[data-card-rulings]"); if (b) cardRulings(RULE_CARDS.get(b.dataset.cardRulings)); };
  const off = STORE.on((kinds) => { if (kinds.has("ruling")) draw(); });
  d.addEventListener("close", off);
  draw();
}

// is:ruling, and what's open, follow the store
const loadRuled = () => { window.RULED = new Set(STORE.all("ruling").map((r) => r.data.card)); };
loadRuled();
STORE.on((kinds) => {
  if (!kinds.has("ruling")) return;
  loadRuled();
  document.querySelectorAll("[data-rulings]").forEach((el) => { const c = RULE_CARDS.get(el.dataset.rulings); if (c) el.innerHTML = rulingsHtml(c); });
});
