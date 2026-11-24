"use strict";
// What the Decks and Play pages share: names and records, the legend picker, the sheet for a game (log, finish, edit).
// Needs ui.js, query.js and library.js first.

const domainIcons = (c) => (c?.domains || []).map((d) => `<img class="ic" src="icons/${d.toLowerCase()}.webp" alt="${esc(d)}" title="${esc(d)}">`).join("");
const legendName = (id) => { const c = cardOf(id); return c ? c.name : id ? "?" : "—"; };
// the opponent's list as the table sent it (a deck code) or as typed, written out
const listText = (s) => { if (!s) return ""; if (/^[A-Z2-7]{8,}=*$/i.test(s.trim())) { try { return deckText(readDeck(s.trim())); } catch { /* */ } } return s; };
const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const recordText = (r) => r.n ? `${r.win}–${r.loss}${r.draw ? `–${r.draw}` : ""}` : "no games";
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const LEGEND_LIST = [...LEGENDS].sort((a, b) => ((a.champion || "") + a.name).localeCompare((b.champion || "") + b.name));
const legendTitle = (l) => l.name.replace(/^.*?,\s*/, "");
const toLocalInput = (iso) => { const d = iso ? new Date(iso) : new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const KINDS = ["conquer", "hold", "extra"];
const KIND_LABEL = { conquer: "Conquer", hold: "Hold", extra: "Extra" };
const artStyle = (c) => { const img = cardImg(c); return `${domainStyle(c)}${img ? `;background-image:url('${esc(img)}')` : ""}`; };
const decksToPick = (also) => LIB.decks().filter((d) => d.status !== "archived" || d.id === also)
  .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.name.localeCompare(b.name));

// what was typed in earlier games, most used first
function usual(values, max = 8) {
  const n = new Map();
  for (const v of values) if (v) n.set(v, (n.get(v) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, max).map(([v]) => v);
}
const usualTags = () => usual(LIB.matches().slice(0, 200).flatMap((m) => m.tags || []), 10);
const usualNames = () => usual(LIB.matches().slice(0, 100).map((m) => m.oppName), 6);
const usualEvents = () => usual(LIB.matches().slice(0, 100).map((m) => m.event), 6);

// ---------- the legend picker ----------

// a form field: a button with the legend's art, the card id in a hidden input
function legendField(name, id, label = "Opponent's legend") {
  return `<div class="field"><span>${esc(label)}</span><button type="button" class="pick" data-pick-legend="${esc(name)}">${pickFace(id)}</button><input type="hidden" name="${esc(name)}" value="${esc(cardIdOf(id) || "")}"></div>`;
}
function pickFace(id) {
  const c = cardOf(id);
  return `${c ? `<span class="art" style="${artStyle(c)}"></span>` : `<span class="art none">?</span>`}<span class="txt"><b>${c ? esc(c.champion || c.name) : "Unknown"}</b><small>${c ? esc(legendTitle(c)) : "tap to choose"}</small></span><span class="doms">${domainIcons(c)}</span><span aria-hidden="true">›</span>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pick-legend]");
  if (!b) return;
  const input = b.closest("form").elements[b.dataset.pickLegend];
  pickLegend(input.value, (id) => { input.value = id; b.innerHTML = pickFace(id); input.dispatchEvent(new Event("change", { bubbles: true })); b.focus(); });
});
function pickLegend(current, done) {
  const recent = [...new Set(LIB.matches().map((m) => cardIdOf(m.oppLegend)).filter((id) => CARD_BY_ID.has(id)))].slice(0, 6).map((id) => CARD_BY_ID.get(id));
  const tile = (l) => `<button type="button" class="legend-tile" data-id="${esc(l.id)}" aria-pressed="${l.id === current}"><span class="art" style="${artStyle(l)}"></span><b>${esc(l.champion || l.name)}</b><small>${esc(legendTitle(l))}</small></button>`;
  const d = sheet({ title: "Opponent's legend", cls: "wide tall", html: `<input type="search" class="find" placeholder="Champion, title or domain" aria-label="Find a legend" autocomplete="off" spellcheck="false"><div class="legends"></div>` });
  const draw = () => {
    const words = $(".find", d).value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hits = LEGEND_LIST.filter((l) => words.every((w) => `${l.champion} ${l.name} ${l.domains.join(" ")}`.toLowerCase().includes(w)));
    $(".legends", d).innerHTML = (words.length ? "" : `${recent.length ? `<h3>Recent</h3><div class="legend-grid">${recent.map(tile).join("")}</div>` : ""}<h3>All</h3>`)
      + `<div class="legend-grid">${words.length ? "" : `<button type="button" class="legend-tile" data-id="" aria-pressed="${!current}"><span class="art none">?</span><b>Unknown</b><small>choose later</small></button>`}${hits.map(tile).join("")}</div>`
      + (hits.length ? "" : `<p class="empty">No legend like that.</p>`);
  };
  $(".find", d).oninput = draw;
  const take = (id) => { d.close(); done(id); };
  $(".find", d).onkeydown = (e) => { if (e.key === "Enter" && e.target.value.trim()) { e.preventDefault(); const t = $(".legend-tile", d); if (t) take(t.dataset.id); } };
  $(".legends", d).onclick = (e) => { const t = e.target.closest("[data-id]"); if (t) take(t.dataset.id); };
  draw();
  if (matchMedia("(hover: hover)").matches) $(".find", d).focus(); // on a phone the keyboard would cover the pictures
}

// ---------- the sheet for a game ----------
// m: the match (or {deck, …} for a new one); done(id|null) after it was saved or deleted.
// opts for the end of a counted game: {title, save: (fields) => …, discard: () => …, cancelled: () => …}
function matchDialog(m, done = () => {}, opts = {}) {
  const decks = decksToPick(m.deck);
  const versionOptions = (deck, sel) => LIB.versions(deck).map((v) => `<option value="${esc(v.id)}"${v.id === sel ? " selected" : ""}>v${v.n} · ${day(v.created)}</option>`).reverse().join("") || `<option value="">–</option>`;
  // a game whose deck is gone (or was never known) keeps it that way unless another is chosen
  const lost = m.deck && decks.some((d) => d.id === m.deck) ? "" : `<option value="${esc(m.deck || "")}" selected>${m.deck ? "deleted deck" : "no deck"}</option>`;
  const side = (who, title) => `<fieldset class="side-score"><legend>${title} <output></output></legend>${KINDS.map((k) => `<div><span>${KIND_LABEL[k]}</span>${stepper(`${who}-${k}`, m[who]?.[k] ?? 0, { max: 30, label: `${title} ${k}` })}</div>`).join("")}</fieldset>`;
  let finished = false;
  const dlg = sheet({ title: opts.title || (m.id ? "Game" : "Log a game"), cls: "match-sheet wide", onClose: () => { if (!finished) opts.cancelled?.(); }, html: `<form>
      ${m.source === "tts" ? `<p class="note">From the Tabletop Simulator table.</p>` : ""}
      ${seg("Result", "result", [["win", "Win"], ["loss", "Loss"], ["draw", "Draw"]], m.result)}
      ${legendField("oppLegend", m.oppLegend)}
      <details class="more-fields"><summary>Score <output class="sum"></output></summary><div class="scores">${side("me", "Me")}${side("opp", "Opponent")}</div></details>
      <div class="field"><span>Tags</span>${tagInput("tags", m.tags || [], usualTags())}</div>
      <label class="field"><span>Notes</span><textarea name="notes" rows="4" placeholder="How did it go? What would you do differently?">${esc(m.notes)}</textarea></label>
      <details class="more-fields"><summary>More</summary><div class="fields">
        <label class="field"><span>My deck</span><select name="deck">${lost}${decks.map((d) => `<option value="${esc(d.id)}"${d.id === m.deck ? " selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Version</span><select name="deckver">${versionOptions(m.deck, m.deckver || LIB.deck(m.deck)?.version)}</select></label>
        ${seg("Went first", "first", [["true", "Me"], ["false", "Them"], ["", "?"]], m.first ?? "")}
        ${seg("Game", "game", [["", "single"], [1, "1"], [2, "2"], [3, "3"]], m.game ?? "")}
        <div><label class="field"><span>Opponent</span><input name="oppName" value="${esc(m.oppName)}" placeholder="name" autocomplete="off"></label>${fillChips("oppName", usualNames())}</div>
        <div><label class="field"><span>Event</span><input name="event" value="${esc(m.event)}" placeholder="e.g. Nexus Night" autocomplete="off"></label>${fillChips("event", usualEvents())}</div>
        <label class="field"><span>When</span><input type="datetime-local" name="date" value="${toLocalInput(m.date)}" required></label>
      </div></details>
      ${m.oppList ? `<details class="more-fields"><summary>Opponent's list</summary><pre>${esc(listText(m.oppList))}</pre></details>` : ""}
      <div class="row end sticky">${m.id || opts.discard ? `<button type="button" class="btn text danger-text del">${m.id ? "Delete" : "Don't save"}</button>` : ""}<span class="grow"></span><button class="btn filled big">Save</button></div>
    </form>` });
  const f = $("form", dlg), dateBefore = f.date.value;
  const sums = () => {
    const [me, opp] = ["me", "opp"].map((w) => KINDS.reduce((n, k) => n + (parseInt(f.elements[`${w}-${k}`].value) || 0), 0));
    f.querySelectorAll(".side-score output").forEach((o, i) => (o.textContent = i ? opp : me));
    $(".sum", f).textContent = `${me}–${opp}`;
  };
  f.addEventListener("change", sums);
  f.addEventListener("input", sums);
  sums();
  f.deck.onchange = () => { f.deckver.innerHTML = versionOptions(f.deck.value, LIB.deck(f.deck.value)?.version); };
  const del = $(".del", dlg);
  if (del) del.onclick = async () => {
    if (m.id) {
      const old = STORE.get("match", m.id);
      finished = true;
      LIB.removeMatch(m.id);
      dlg.close();
      done(null);
      toast("Game deleted", { undo: () => { STORE.put("match", m.id, old); done(m.id); } });
    } else if (await ask("Throw this game away?", { yes: "Don't save", danger: true })) { finished = true; dlg.close(); opts.discard(); }
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    const num = (k) => Math.max(0, parseInt(f.elements[k].value) || 0);
    if (opts.save && !f.result.value) { toast("Choose a result first"); return; }
    const fields = {
      deck: f.deck.value || null, deckver: f.deckver.value || null, oppLegend: f.oppLegend.value || null, oppName: f.oppName.value.trim(),
      event: f.event.value.trim(), result: f.result.value || null,
      first: f.first.value === "" ? null : f.first.value === "true", game: f.game.value ? +f.game.value : null,
      me: Object.fromEntries(KINDS.map((k) => [k, num(`me-${k}`)])), opp: Object.fromEntries(KINDS.map((k) => [k, num(`opp-${k}`)])),
      tags: splitTags(f.tags.value), notes: f.notes.value, needsNotes: false,
    };
    // unchanged, the time keeps its seconds (they order games played in the same minute)
    if (!m.date || f.date.value !== dateBefore) fields.date = f.date.value === dateBefore ? new Date().toISOString() : new Date(f.date.value).toISOString();
    finished = true;
    dlg.close();
    if (opts.save) { opts.save(fields); return; }
    done(LIB.saveMatch(m.id, fields));
  };
  return dlg;
}
