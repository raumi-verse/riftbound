"use strict";
// The Play page: start a game with a deck, count both sides' points (conquer, hold, extra) and the turns, and at the
// end save it as a match of the deck. The game in progress is the store record game/current, so a reload, switching
// apps or another device carries on with it. #deck=<id> picks the deck.

const root = $("#play");
const KEY_ID = "current";
const getGame = () => STORE.get("game", KEY_ID);
const setGame = (g) => (g ? STORE.put("game", KEY_ID, g) : STORE.del("game", KEY_ID)); // the store's change draws it
let ending = false; // the end sheet is open
let saved = null; // the deck of the game (or series) just saved
let faceToFace = (() => { try { return (localStorage.getItem("rb-face") ?? String(!!S.playFaceToFace)) === "true"; } catch { return !!S.playFaceToFace; } })();

function render() {
  const g = getGame();
  document.body.classList.toggle("counting", !!g);
  if (g) { saved = null; return counter(g); }
  wake(false);
  return saved ? afterSeries(saved) : setup();
}

// ---------- before a game ----------

function setup() {
  const want = (location.hash.match(/deck=([^&]+)/) || [])[1];
  const decks = decksToPick(want);
  let last = {};
  try { last = JSON.parse(localStorage.getItem("rb-play-last")) || {}; } catch { /* */ }
  const sel = [want, last.deck].find((id) => decks.some((d) => d.id === id)) || decks[0]?.id;
  root.innerHTML = `<form class="setup fields">
    <h1>New game</h1>
    ${decks.length ? `<fieldset class="deck-row"><legend>My deck</legend><div>${decks.map((d) => {
      const c = CARD_BY_ID.get(d.legend), r = record(LIB.matches(d.id));
      return `<label class="deck-card" style="${domainStyle(c)}"><input type="radio" name="deck" value="${esc(d.id)}"${d.id === sel ? " checked" : ""}><span class="art" style="${artStyle(c)}"></span><b>${d.status === "pinned" ? "★ " : ""}${esc(d.name)}</b><small>${recordText(r)}</small></label>`;
    }).join("")}</div></fieldset>` : `<p class="note">No decks yet: make one on the <a href="decks.html">Decks</a> page first (a game is saved to its deck).</p>`}
    ${legendField("oppLegend", "")}
    ${seg("Who goes first", "first", [["true", "Me"], ["false", "Them"], ["", "?"]], "")}
    <details class="more-fields"><summary>More <small>opponent, event, points, best of</small></summary><div class="fields">
      <div><label class="field"><span>Opponent</span><input name="oppName" placeholder="name" value="${esc(last.oppName || "")}" autocomplete="off"></label>${fillChips("oppName", usualNames())}</div>
      <div><label class="field"><span>Event</span><input name="event" placeholder="e.g. Nexus Night" value="${esc(last.event || "")}" autocomplete="off"></label>${fillChips("event", usualEvents())}</div>
      <div class="field"><span>Points to win</span>${stepper("target", S.playTarget || 8, { min: 1, max: 30, label: "Points to win" })}</div>
      ${seg("Games", "bo", [[1, "Best of 1"], [3, "Best of 3"]], last.bo === 3 ? 3 : 1)}
    </div></details>
    <div class="row sticky"><button type="button" class="btn text log"${decks.length ? "" : " disabled"}>Log a past game</button><span class="grow"></span><button class="btn filled big"${decks.length ? "" : " disabled"}>Start</button></div>
  </form>`;
  const f = $("form", root);
  $(".deck-row input:checked", root)?.closest("label").scrollIntoView({ block: "nearest", inline: "center" });
  $(".log", f).onclick = () => matchDialog({ deck: f.elements.deck.value, deckver: LIB.deck(f.elements.deck.value)?.version, oppLegend: f.oppLegend.value }, (id) => { if (id) location.href = `decks.html#d/${STORE.get("match", id)?.deck || ""}`; });
  f.onsubmit = (e) => {
    e.preventDefault();
    const o = { deck: f.elements.deck.value, oppLegend: f.oppLegend.value, oppName: f.oppName.value.trim(), event: f.event.value.trim(),
      first: f.first.value === "" ? null : f.first.value === "true", target: +f.target.value || 8, bo: +f.bo.value };
    try { localStorage.setItem("rb-play-last", JSON.stringify({ deck: o.deck, oppName: o.oppName, event: o.event, bo: o.bo })); } catch { /* */ }
    saved = null;
    smoothly(() => setGame(GAME.start(o)));
  };
}

// ---------- the counter ----------
// built once per game, then only its numbers change: a finger resting on one half keeps its button while the other
// side scores

let built = null;
const sideOf = (g, who) => {
  const deck = LIB.deck(g.deck), c = CARD_BY_ID.get(who === "me" ? deck?.legend : g.oppLegend);
  return { c, name: who === "me" ? deck?.name || "Me" : g.oppName || c?.champion || "Opponent" };
};
function half(g, who) {
  const { c, name } = sideOf(g, who);
  return `<section class="side ${who}" style="${domainStyle(c)}" aria-label="${esc(name)}">
    ${cardImg(c) ? `<span class="bg" style="background-image:url('${esc(cardImg(c))}')"></span>` : ""}
    <div class="who"><span>${esc(name)}</span><span class="turnmark" hidden>${who === "me" ? "your" : "their"} turn</span></div>
    <div class="total" aria-live="polite"><span></span><small>/ ${g.target}</small></div>
    <div class="progress"><i></i></div>
    <div class="btns">${KINDS.map((k) => `<button type="button" data-who="${who}" data-kind="${k}" title="Tap: one more. Hold: one less."><b>+1</b><span>${KIND_LABEL[k]}</span><small></small></button>`).join("")}</div>
  </section>`;
}
function counter(g) {
  wake(true);
  const key = JSON.stringify([g.started, g.deck, g.oppLegend, g.oppName, g.target]);
  if (built !== key || !$(".counter", root)) {
    built = key;
    root.innerHTML = `<div class="counter">
      ${half(g, "opp")}
      <div class="mid">
        <div class="won" hidden><b></b><span class="grow"></span><button type="button" class="btn text undo">Undo</button><button type="button" class="btn filled finish">Finish</button></div>
        <div class="strip"><button type="button" class="icon-btn undo" aria-label="Undo the last point or turn" title="Undo">↶</button>
          <button type="button" class="icon-btn flip" aria-label="Turn the opponent's half to face them" title="Turn the opponent's half to face them">⇅</button>
          <button type="button" class="btn tonal turn" title="Next turn"></button><span class="series"></span>
          <button type="button" class="btn text finish">End</button></div>
      </div>
      ${half(g, "me")}
    </div>`;
    root.querySelectorAll(".undo").forEach((b) => (b.onclick = () => setGame(GAME.undo(getGame()))));
    $(".turn", root).onclick = () => setGame(GAME.nextTurn(getGame()));
    $(".flip", root).onclick = () => { faceToFace = !faceToFace; try { localStorage.setItem("rb-face", String(faceToFace)); } catch { /* */ } paint(getGame()); };
    root.querySelectorAll(".finish").forEach((b) => (b.onclick = endGame));
    root.querySelectorAll("[data-kind]").forEach(pointButton);
  }
  paint(g);
}
function paint(g) {
  const w = GAME.winner(g);
  $(".counter", root).classList.toggle("face", faceToFace);
  for (const who of ["me", "opp"]) {
    const el = $(`.side.${who}`, root), total = GAME.total(g, who);
    el.classList.toggle("ahead", w === who);
    $(".total span", el).textContent = total;
    $(".progress i", el).style.width = `${100 * Math.min(1, total / g.target)}%`;
    $(".turnmark", el).hidden = g.first == null || GAME.mine(g) !== (who === "me");
    el.querySelectorAll("[data-kind]").forEach((b) => ($("small", b).textContent = g[who][b.dataset.kind]));
  }
  root.querySelectorAll(".undo").forEach((b) => (b.disabled = !g.log.length));
  $(".turn", root).textContent = `Turn ${g.turn} →`;
  $(".series", root).textContent = g.bo > 1 ? `game ${g.game} · ${g.wins.me}–${g.wins.opp}` : "";
  $(".won", root).hidden = !w;
  if (w) $(".won b", root).textContent = `${sideOf(g, w).name} reached ${g.target}`;
}
// a tap adds one, holding takes one off
function pointButton(b) {
  let timer = null, held = false;
  const { who, kind } = b.dataset;
  const add = (d) => {
    const g = getGame(), next = GAME.point(g, who, kind, d);
    if (next === g) return;
    setGame(next);
    navigator.vibrate?.(d > 0 ? 15 : [15, 40, 15]);
    const t = $(`.side.${who} .total span`, root);
    if (!reducedMotion()) t.animate?.([{ transform: `scale(${d > 0 ? 1.12 : 0.92})` }, { transform: "none" }], { duration: 180, easing: "ease-out" });
  };
  const stop = () => { clearTimeout(timer); timer = null; };
  b.addEventListener("pointerdown", (e) => { if (e.button) return; held = false; stop(); timer = setTimeout(() => { held = true; add(-1); }, 500); });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, stop);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
  b.addEventListener("click", () => { if (held) { held = false; return; } add(1); });
}

// ---------- the end of a game ----------

function endGame() {
  const g = getGame(), w = GAME.winner(g);
  ending = true;
  const m = GAME.toMatch(g, w === "me" ? "win" : w === "opp" ? "loss" : null);
  matchDialog({ ...m, date: null }, () => {}, {
    title: `${w === "me" ? "You won" : w === "opp" ? "You lost" : "End of the game"} · ${GAME.total(g, "me")}–${GAME.total(g, "opp")}`,
    cancelled: () => { ending = false; if (getGame()) render(); },
    discard: () => { ending = false; setGame(null); },
    save: (fields) => {
      ending = false;
      const id = LIB.saveMatch(null, { ...m, ...fields });
      const next = GAME.next({ ...g, deck: fields.deck, deckver: fields.deckver, oppLegend: fields.oppLegend, oppName: fields.oppName, event: fields.event }, fields.result, id);
      saved = fields.deck;
      smoothly(() => setGame(next));
      if (next) toast(`Game ${g.game} saved`);
    },
  });
}
function afterSeries(deck) {
  built = null;
  const c = CARD_BY_ID.get(LIB.deck(deck)?.legend);
  root.innerHTML = `<div class="setup done"><span class="art round" style="${artStyle(c)}"></span><h1>Saved</h1><p class="note">${recordText(record(LIB.matches(deck)))} with ${esc(LIB.deck(deck)?.name || "this deck")}</p>
    <div class="row"><a class="btn tonal big" href="decks.html#d/${esc(deck)}">See the deck</a><button type="button" class="btn filled big again">New game</button></div></div>`;
  $(".again", root).onclick = () => { saved = null; render(); };
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

// the game changed, here or in another tab or device: show it, unless a form is being filled in here
STORE.on((kinds) => {
  if (!kinds.has("game") || ending) return;
  if (!getGame() && $(".setup.fields", root) && $("dialog[open]")) return;
  if (document.activeElement?.matches("input, textarea, select") && $(".setup.fields", root)?.contains(document.activeElement) && !getGame()) return;
  render();
});
window.addEventListener("hashchange", () => { if (!getGame()) { saved = null; render(); } });
render();
