"use strict";
// The Play page: start a game with a deck, count both sides' points (conquer, hold, extra) and the turns, and at the
// end save it as a match of the deck. The game in progress is the store record game/current, so a reload, switching
// apps or another device carries on with it. #deck=<id> picks the deck.

const root = $("#play");
const KEY_ID = "current";
const getGame = () => STORE.get("game", KEY_ID);
const setGame = (g) => (g ? STORE.put("game", KEY_ID, g) : STORE.del("game", KEY_ID));
let ending = null; // the result being saved: {winner}
let faceToFace = (() => { try { return (localStorage.getItem("rb-face") ?? String(!!S.playFaceToFace)) === "true"; } catch { return !!S.playFaceToFace; } })();

function render() {
  const g = getGame();
  document.body.classList.toggle("counting", !!g);
  if (!g) return setup();
  if (ending) return endScreen(g);
  counter(g);
}

// ---------- before a game ----------

function setup() {
  wake(false);
  const want = (location.hash.match(/deck=([^&]+)/) || [])[1];
  const decks = LIB.decks().filter((d) => d.status !== "archived" || d.id === want)
    .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.name.localeCompare(b.name));
  let last = {};
  try { last = JSON.parse(localStorage.getItem("rb-play-last")) || {}; } catch { /* */ }
  const sel = want || last.deck || decks[0]?.id;
  root.innerHTML = `<form class="setup card-form">
    <h1>New game</h1>
    ${decks.length ? "" : `<p class="note">No decks yet: make one on the <a href="decks.html">Decks</a> page first (a game is saved to its deck).</p>`}
    <label>My deck <select name="deck" required>${decks.map((d) => `<option value="${esc(d.id)}"${d.id === sel ? " selected" : ""}>${d.status === "pinned" ? "★ " : ""}${esc(d.name)}</option>`).join("")}</select></label>
    <label>Opponent's legend <select name="oppLegend">${legendOptions("")}</select></label>
    <div class="grid2"><label>Opponent <input name="oppName" placeholder="name" value="${esc(last.oppName || "")}"></label>
      <label>Event <input name="event" placeholder="e.g. Nexus Night" value="${esc(last.event || "")}"></label></div>
    <fieldset class="seg"><legend>Who goes first</legend>
      <label><input type="radio" name="first" value="true">me</label><label><input type="radio" name="first" value="false">them</label><label><input type="radio" name="first" value="" checked>?</label></fieldset>
    <div class="grid2"><label>Points to win <input type="number" name="target" min="1" max="30" value="${S.playTarget || 8}"></label>
      <label>Games <select name="bo"><option value="1">best of 1</option><option value="3"${last.bo === 3 ? " selected" : ""}>best of 3</option></select></label></div>
    <div class="row"><button type="button" class="log">Log a game played elsewhere</button><span class="grow"></span><button class="primary big"${decks.length ? "" : " disabled"}>Start</button></div>
  </form>`;
  const f = root.querySelector("form");
  f.querySelector(".log").onclick = () => f.deck.value && matchDialog({ deck: f.deck.value, deckver: LIB.deck(f.deck.value)?.version }, (id) => { if (id) location.href = `decks.html#d/${f.deck.value}`; });
  f.onsubmit = (e) => {
    e.preventDefault();
    const o = { deck: f.deck.value, oppLegend: f.oppLegend.value, oppName: f.oppName.value.trim(), event: f.event.value.trim(),
      first: f.first.value === "" ? null : f.first.value === "true", target: +f.target.value || 8, bo: +f.bo.value };
    try { localStorage.setItem("rb-play-last", JSON.stringify({ deck: o.deck, oppName: o.oppName, event: o.event, bo: o.bo })); } catch { /* */ }
    setGame(GAME.start(o));
    render();
  };
}

// ---------- the counter ----------

const LABEL = { conquer: "Conquer", hold: "Hold", extra: "Extra" };
function half(g, who) {
  const s = g[who], total = GAME.total(g, who);
  const name = who === "me" ? LIB.deck(g.deck)?.name || "Me" : g.oppName || legendName(g.oppLegend).replace(/,.*/, "") || "Opponent";
  const legend = CARD_BY_ID.get(who === "me" ? LIB.deck(g.deck)?.legend : g.oppLegend);
  return `<section class="side ${who}${GAME.winner(g) === who ? " won" : ""}" style="--p:${Math.min(1, total / g.target)}">
    ${cardImg(legend) ? `<span class="bg" style="background-image:url('${esc(cardImg(legend))}')"></span>` : ""}
    <div class="who">${esc(name)}${g.first != null && GAME.mine(g) === (who === "me") ? ` <span class="turnmark">${who === "me" ? "your" : "their"} turn</span>` : ""}</div>
    <div class="total">${total}<small>/${g.target}</small></div>
    <div class="parts">${KINDS.map((k) => `<span>${s[k]} ${k}</span>`).join(" · ")}</div>
    <div class="btns">${KINDS.map((k) => `<button type="button" data-who="${who}" data-kind="${k}">+1 ${LABEL[k]}</button>`).join("")}</div>
  </section>`;
}
function counter(g) {
  wake(true);
  root.innerHTML = `<div class="counter${faceToFace ? " face" : ""}">
    ${half(g, "opp")}
    <div class="mid">
      <button type="button" class="undo" title="Undo the last point or turn"${g.log.length ? "" : " disabled"}>↶ Undo</button>
      <button type="button" class="turn" title="Next turn">Turn ${g.turn} →</button>
      <span class="series">${g.bo > 1 ? `game ${g.game} · ${g.wins.me}–${g.wins.opp}` : ""}</span>
      <button type="button" class="flip" title="Turn the opponent's half to face them">⇅</button>
      <button type="button" class="end">End</button>
    </div>
    ${half(g, "me")}
  </div>`;
  root.querySelectorAll("[data-kind]").forEach((b) => (b.onclick = () => {
    const next = GAME.point(getGame(), b.dataset.who, b.dataset.kind);
    setGame(next);
    navigator.vibrate?.(15);
    if (GAME.winner(next)) { ending = { winner: GAME.winner(next) }; }
    render();
  }));
  root.querySelector(".undo").onclick = () => { setGame(GAME.undo(getGame())); render(); };
  root.querySelector(".turn").onclick = () => { setGame(GAME.nextTurn(getGame())); render(); };
  root.querySelector(".flip").onclick = () => { faceToFace = !faceToFace; try { localStorage.setItem("rb-face", String(faceToFace)); } catch { /* */ } render(); };
  root.querySelector(".end").onclick = () => { ending = { winner: GAME.winner(g) }; render(); };
}

// ---------- the end of a game ----------

function endScreen(g) {
  wake(false);
  const w = ending.winner, guess = w === "me" ? "win" : w === "opp" ? "loss" : "";
  root.innerHTML = `<form class="end-form card-form">
    <h1>${w === "me" ? "You won" : w === "opp" ? "You lost" : "End of the game"} <small>${GAME.total(g, "me")}–${GAME.total(g, "opp")}${g.bo > 1 ? ` · game ${g.game}` : ""}</small></h1>
    <fieldset class="seg"><legend>Result</legend>${["win", "loss", "draw"].map((r) => `<label><input type="radio" name="result" value="${r}"${r === guess ? " checked" : ""} required>${r}</label>`).join("")}</fieldset>
    <label>Opponent's legend <select name="oppLegend">${legendOptions(g.oppLegend)}</select></label>
    <label>Tags <input name="tags" placeholder="comma separated, e.g. mulligan, misplay"></label>
    <label>Notes <textarea name="notes" rows="6" placeholder="How did it go? What would you do differently?"></textarea></label>
    <div class="row"><button type="button" class="back">Back to the game</button><button type="button" class="drop danger">Don't save</button><span class="grow"></span><button class="primary big">Save</button></div>
  </form>`;
  const f = root.querySelector("form");
  f.querySelector(".back").onclick = () => { ending = null; render(); };
  f.querySelector(".drop").onclick = () => { if (confirm("Throw this game away?")) { ending = null; setGame(null); render(); } };
  f.onsubmit = (e) => {
    e.preventDefault();
    const result = f.result.value;
    const id = LIB.saveMatch(null, GAME.toMatch({ ...g, oppLegend: f.oppLegend.value || null }, result, { tags: splitTags(f.tags.value), notes: f.notes.value }));
    const next = GAME.next({ ...g, oppLegend: f.oppLegend.value || null }, result, id);
    ending = null;
    setGame(next);
    if (!next) { afterSeries(g.deck); return; }
    render();
  };
}
function afterSeries(deck) {
  root.innerHTML = `<div class="card-form done"><h1>Saved</h1>
    <div class="row"><a class="btn" href="decks.html#d/${esc(deck)}">See the deck</a><span class="grow"></span><button type="button" class="primary big again">New game</button></div></div>`;
  root.querySelector(".again").onclick = render;
}

// ---------- keeping the screen on while counting ----------
let lock = null;
async function wake(on) {
  try {
    if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => (lock = null)); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { /* not allowed now (hidden tab) */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && getGame() && !ending) wake(true); });

// the game changed elsewhere (another tab or device): show it, unless a form is being filled in here
STORE.on((kinds) => {
  if (!kinds.has("game") || ending) return;
  if (document.activeElement?.matches("input, textarea, select") && root.contains(document.activeElement)) return;
  render();
});
window.addEventListener("hashchange", () => { if (!getGame()) render(); });
render();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js");
