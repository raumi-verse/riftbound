"use strict";
// Errata, your own notes on how a card is ruled, and the rulings Joutes has. A note is a record of its own (kind "ruling": {card, text, url,
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

// ---------- rulings from Joutes ----------
// Community rulings and clarifications, from their open API, one card at a time and only when it's opened. Kept a day
// before asking again, and readable offline for a week; nothing of theirs is stored anywhere else.

// the first printing with a plain number, alt arts included (R01, SP1 and signed ones have no page there)
const siteId = (c) => (c.supertype === "Token" ? null : c.printings.find((x) => /^[A-Z]{3}-\d{3}[ab]?$/.test(x.id))?.id.replace("-", "") || null);
function siteLink(c) {
  const site = S.rulingsSite;
  if (!site?.list) return "";
  const id = site.card && siteId(c), url = id ? site.card.replace("{id}", id) : site.list;
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${id ? "All" : "Find it"} on ${esc(site.name)} ↗</a>`;
}

// their answer -> [{id, type, text, lang, source, date, outdated, plus, minus, by, also: [names]}] newest first
function readSite(d) {
  if (!Array.isArray(d?.erratas)) throw new Error("not the answer expected");
  const str = (x) => (typeof x === "string" ? x : "");
  return d.erratas.map((e) => {
    const en = e.originalLang === "en" || !e.originalLang ? null : (e.translations || []).find((t) => t.lang === "en" && t.details);
    return { id: str(e.id), type: ["errata", "clarification", "ruling"].includes(e.type) ? e.type : "ruling", text: str(en ? en.details : e.details), lang: en ? "en" : str(e.originalLang) || "en",
      source: str(e.source), date: str(e.errataDate) || str(e.createdAt), outdated: !!e.deprecatedAt, plus: Number(e.votes?.positive) || 0, minus: Number(e.votes?.negative) || 0,
      by: str(e.author?.displayName), also: (e.cards || []).map((c) => str(c?.name)).filter((n) => n && n !== d.name) };
  }).filter((e) => e.text).sort((a, b) => a.outdated - b.outdated || b.date.localeCompare(a.date));
}
const SITE_KEY = "rb-site-rulings", DAY = 86400e3; // {card id: {at, list}}, the newest 80
const siteCache = () => { try { return JSON.parse(localStorage.getItem(SITE_KEY)) || {}; } catch { return {}; } };
function keepSite(id, list) {
  const c = siteCache();
  c[id] = { at: Date.now(), list };
  const keys = Object.keys(c).sort((a, b) => c[b].at - c[a].at);
  for (const k of keys.slice(80)) delete c[k];
  try { localStorage.setItem(SITE_KEY, JSON.stringify(c)); } catch { /* full: not kept */ }
}
// -> {list, at, old} or null (off, no page there, or not reachable and not kept)
const asking = new Map();
async function siteRulings(c) {
  const id = S.rulingsSite?.api && siteId(c);
  if (!id) return null;
  const kept = siteCache()[c.id];
  if (kept && Date.now() - kept.at < DAY) return { ...kept, old: false };
  if (!asking.has(id)) asking.set(id, (async () => {
    const stop = new AbortController(), t = setTimeout(() => stop.abort(), 8000);
    try {
      const r = await fetch(S.rulingsSite.api.replace("{id}", id), { credentials: "omit", referrerPolicy: "origin", signal: stop.signal });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(String(r.status));
      return readSite(await r.json());
    } finally { clearTimeout(t); asking.delete(id); }
  })());
  try {
    const list = await asking.get(id);
    keepSite(c.id, list);
    return { list, at: Date.now(), old: false };
  } catch { return kept && Date.now() - kept.at < 7 * DAY ? { ...kept, old: true } : null; }
}

// their text (some Markdown: **bold**, [a card] or [keyword], [text](link)) as HTML, all else escaped
const CARD_NAMED = new Map(CARDS.map((c) => [c.name.toLowerCase(), c]));
function siteText(s) {
  const parts = [], hold = (html) => `${parts.push(html) - 1}`;
  const t = s.replace(/[]/g, "").replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, text, u) => (safeUrl(u) ? hold(`<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(text)}</a>`) : text))
    .replace(/\[([^\]\n]+)\]/g, (m, n) => { const c = CARD_NAMED.get(n.toLowerCase()); return c ? hold(`<button type="button" class="card-link" data-open-card="${esc(c.id)}">${esc(c.name)}</button>`) : m; });
  return richText(t, null).replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>").replace(/(\d+)/g, (m, i) => parts[i] ?? "");
}
const siteDay = (x) => (x && !Number.isNaN(Date.parse(x)) ? new Date(x).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
function siteHtml(c, got) {
  const name = esc(S.rulingsSite.name), item = (e) => {
    const url = safeUrl(e.source);
    return `<li class="${e.outdated ? "outdated" : ""}"><p><span class="chip">${e.type}</span>${e.outdated ? ` <span class="chip err">outdated</span>` : ""}${e.lang !== "en" ? ` <span class="chip">${esc(e.lang)}</span>` : ""} <small>${siteDay(e.date)}${e.by ? ` · ${esc(e.by)}` : ""}${e.plus || e.minus ? ` · +${e.plus} −${e.minus}` : ""}</small></p>
      <div class="site-text">${siteText(e.text)}</div>
      <p class="row">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(new URL(url).hostname.replace(/^www\./, ""))} ↗</a>` : ""}<button type="button" class="btn text" data-site-save="${esc(e.id)}">Save as my note</button></p></li>`;
  };
  const n = got ? got.list.filter((e) => !e.outdated).length : 0;
  return `<h3>Rulings on ${name}${n ? ` <small>${n}</small>` : ""}</h3>${got ? `${got.old ? `<p class="note">Not reachable now; as of ${siteDay(new Date(got.at).toISOString())}.</p>` : ""}${got.list.length ? `<ul class="ruling-list site-list">${got.list.map(item).join("")}</ul><p class="note">Community rulings, not official ones.</p>` : `<p class="note">None for this card.</p>`}` : ""}<p>${siteLink(c)}</p>`;
}
// fill an open card's <div data-site="card id">; a moment later, so stepping through cards asks for none of them
function loadSite(root, wait = 700) {
  const el = root.querySelector("[data-site]"), c = el && RULE_CARDS.get(el.dataset.site);
  if (!c || !S.rulingsSite?.list) return;
  const show = (got) => { if (el.isConnected && el.dataset.site === c.id) { el.siteList = got?.list; el.innerHTML = siteHtml(c, got); } };
  el.innerHTML = `<p>${siteLink(c)}</p>`;
  if (!S.rulingsSite.api || !siteId(c)) return;
  const kept = siteCache()[c.id], fresh = kept && Date.now() - kept.at < DAY;
  setTimeout(async () => { if (el.isConnected && el.closest("dialog")?.open) show(await siteRulings(c)); }, fresh ? 0 : wait);
}
document.addEventListener("click", (e) => {
  const open = e.target.closest("[data-open-card]");
  if (open) return cardRulings(RULE_CARDS.get(open.dataset.openCard));
  const b = e.target.closest("[data-site-save]"), box = b?.closest("[data-site]");
  const r = box?.siteList?.find((x) => x.id === b.dataset.siteSave);
  if (!r) return;
  const id = STORE.uid(), c = RULE_CARDS.get(box.dataset.site);
  STORE.put("ruling", id, { card: c.id, text: r.text.replace(/\*\*/g, ""), url: safeUrl(r.source) || S.rulingsSite.card.replace("{id}", siteId(c)), created: new Date().toISOString() });
  b.disabled = true;
  b.textContent = "Saved";
  toast("Saved as your note", { undo: () => { STORE.del("ruling", id); b.disabled = false; b.textContent = "Save as my note"; } });
});

const errataLine = (c) => (c.errata ? `<p class="errata-line"><span class="errata-b">errata</span> ${esc(c.errata)}. This is the current text; the printed card may say something else.</p>` : "");

function rulingsHtml(c) {
  const notes = rulingsOf(c.id);
  return `<h3>My rulings</h3>${notes.length ? `<ul class="ruling-list">${notes.map((r) => {
    const url = r.url && safeUrl(r.url);
    return `<li data-ruling="${esc(r.id)}"><p>${esc(r.text).replace(/\n/g, "<br>")}</p><small>${r.created ? new Date(r.created).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""}${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener">${esc(new URL(url).hostname.replace(/^www\./, ""))} ↗</a>` : r.url ? ` · ${esc(r.url)}` : ""}</small><button type="button" class="btn text" data-ruling-edit>Edit</button></li>`;
  }).join("")}</ul>` : ""}<div class="row"><button type="button" class="btn tonal" data-ruling-new>＋ Note a ruling</button></div>`;
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
  const d = sheet({ title: c.name, cls: "wide", html: `<div class="rule-card">${img ? `<img src="${esc(img)}" alt="">` : ""}<div><div class="tx">${errataLine(c)}${richText(c.text, c)}</div></div></div><div class="rulings" data-rulings="${esc(c.id)}">${rulingsHtml(c)}</div><div class="rulings" data-site="${esc(c.id)}"></div>` });
  loadSite(d, 0);
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
