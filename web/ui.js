"use strict";
// Bits the Decks and Play pages share: escaping, card pictures, the legend picker, the match dialog.
// Needs query.js and library.js first.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const $ = (s, root = document) => root.querySelector(s);
const cardImg = (c) => c && (c.printings.find((p) => p.id === c.id)?.img || c.printings.find((p) => p.img)?.img);
const domainIcons = (c) => (c?.domains || []).map((d) => `<img class="ic" src="icons/${d.toLowerCase()}.webp" alt="${esc(d)}" title="${esc(d)}">`).join("");
const legendName = (id) => { const c = CARD_BY_ID.get(id); return c ? c.name : id ? "?" : "—"; };
const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const recordText = (r) => r.n ? `${r.win}–${r.loss}${r.draw ? `–${r.draw}` : ""}` : "no games";
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const LEGEND_LIST = [...LEGENDS].sort((a, b) => (a.champion + a.name).localeCompare(b.champion + b.name));
const legendOptions = (sel) => `<option value="">unknown legend</option>${LEGEND_LIST.map((l) => `<option value="${esc(l.id)}"${l.id === sel ? " selected" : ""}>${esc(l.champion)} · ${esc(l.name.replace(/^.*?,\s*/, ""))}</option>`).join("")}`;
const toLocalInput = (iso) => { const d = iso ? new Date(iso) : new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const splitTags = (s) => [...new Set(String(s).split(",").map((t) => t.trim()).filter(Boolean))];
const KINDS = ["conquer", "hold", "extra"];

// The dialog to log a match or change one. m: the match (or {deck, …} for a new one); done(id|null) after save or delete.
function matchDialog(m, done = () => {}) {
  let dlg = document.getElementById("match-dlg");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "match-dlg";
    dlg.className = "form-dlg";
    document.body.append(dlg);
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }
  const decks = LIB.decks().filter((d) => d.status !== "archived" || d.id === m.deck).sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.name.localeCompare(b.name));
  const versions = m.deck ? LIB.versions(m.deck) : [];
  const side = (who) => KINDS.map((k) => `<label>${k}<input type="number" min="0" max="30" name="${who}-${k}" value="${m[who]?.[k] ?? 0}"></label>`).join("");
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${m.id ? "Match" : "Log a match"} <button type="button" class="x" aria-label="Close">✕</button></h2>
      ${m.source === "tts" ? `<p class="note">From the Tabletop Simulator table.</p>` : ""}
      <div class="grid2">
        <label>Deck <select name="deck">${decks.map((d) => `<option value="${esc(d.id)}"${d.id === m.deck ? " selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
        <label>Version <select name="deckver">${versions.map((v) => `<option value="${esc(v.id)}"${v.id === (m.deckver || LIB.deck(m.deck)?.version) ? " selected" : ""}>v${v.n} · ${day(v.created)}</option>`).join("") || "<option value=''>–</option>"}</select></label>
        <label>Opponent's legend <select name="oppLegend">${legendOptions(m.oppLegend)}</select></label>
        <label>Opponent <input name="oppName" value="${esc(m.oppName)}" placeholder="name"></label>
        <label>When <input type="datetime-local" name="date" value="${toLocalInput(m.date)}"></label>
        <label>Event <input name="event" value="${esc(m.event)}" placeholder="e.g. Nexus Night, testing"></label>
      </div>
      <fieldset class="seg"><legend>Result</legend>${["win", "loss", "draw"].map((r) => `<label><input type="radio" name="result" value="${r}"${m.result === r ? " checked" : ""}>${r}</label>`).join("")}</fieldset>
      <fieldset class="seg"><legend>I went</legend>${[["first", "true"], ["second", "false"], ["?", ""]].map(([l, v]) => `<label><input type="radio" name="first" value="${v}"${String(m.first ?? "") === v ? " checked" : ""}>${l}</label>`).join("")}
        <label class="game">game <select name="game">${["", 1, 2, 3].map((g) => `<option${g === (m.game ?? "") ? " selected" : ""}>${g}</option>`).join("")}</select></label></fieldset>
      <div class="score"><div><b>Me</b>${side("me")}</div><div><b>Opponent</b>${side("opp")}</div></div>
      <label>Tags <input name="tags" value="${esc((m.tags || []).join(", "))}" placeholder="comma separated, e.g. mulligan, misplay"></label>
      <label>Notes <textarea name="notes" rows="5" placeholder="How did it go?">${esc(m.notes)}</textarea></label>
      ${m.oppList ? `<details><summary>Opponent's list</summary><pre>${esc(m.oppList)}</pre></details>` : ""}
      <div class="row">${m.id ? `<button type="button" class="del">Delete</button>` : ""}<span class="grow"></span><button type="submit" class="primary">Save</button></div>
    </form>`;
  const f = dlg.querySelector("form");
  f.deck.onchange = () => {
    const vs = LIB.versions(f.deck.value), cur = LIB.deck(f.deck.value)?.version;
    f.deckver.innerHTML = vs.map((v) => `<option value="${esc(v.id)}"${v.id === cur ? " selected" : ""}>v${v.n} · ${day(v.created)}</option>`).join("");
  };
  dlg.querySelector(".x").onclick = () => dlg.close();
  const del = dlg.querySelector(".del");
  if (del) del.onclick = () => { if (confirm("Delete this match?")) { LIB.removeMatch(m.id); dlg.close(); done(null); } };
  f.onsubmit = (e) => {
    e.preventDefault();
    const num = (k) => Math.max(0, parseInt(f[k].value) || 0);
    const fields = {
      deck: f.deck.value, deckver: f.deckver.value || null, oppLegend: f.oppLegend.value || null, oppName: f.oppName.value.trim(),
      date: new Date(f.date.value).toISOString(), event: f.event.value.trim(), result: f.result.value || null,
      first: f.first.value === "" ? null : f.first.value === "true", game: f.game.value ? +f.game.value : null,
      me: Object.fromEntries(KINDS.map((k) => [k, num(`me-${k}`)])), opp: Object.fromEntries(KINDS.map((k) => [k, num(`opp-${k}`)])),
      tags: splitTags(f.tags.value), notes: f.notes.value, needsNotes: false,
    };
    const id = LIB.saveMatch(m.id, fields);
    dlg.close();
    done(id);
  };
  dlg.showModal();
}
