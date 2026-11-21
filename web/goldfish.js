"use strict";
// The goldfish page: read the deck, run sim.js, show the tables. The deck is kept in the URL (#…) so it can be
// bookmarked or shared.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pct = (x) => `${Math.round(x * 100)}%`;
const num = (x) => x.toFixed(1);
// a percentage cell shaded by its value
const cell = (x, title = "") => `<td class="n" style="--v:${Math.round(x * 100)}%"${title ? ` title="${esc(title)}"` : ""}>${pct(x)}</td>`;
const dom = (d) => `<img class="ic" src="icons/${d.toLowerCase()}.webp" alt="${d}" title="${d}">`;
const turnHead = (T) => Array.from({ length: T }, (_, t) => `<th class="n">T${t + 1}</th>`).join("");

$("#synced").textContent = `${CARDS.length} cards · synced ${synced.slice(0, 10)}`;
$("#games").value = GF.games;

function showProblems(d) {
  $("#problems").innerHTML = d.problems.map((p) => `<li>${esc(p)}</li>`).join("");
}

function render(d, r) {
  const T = r.turns, t = r.turn;
  const rows = [
    ["Runes on the board", t.runes.map((x) => `<td class="n">${num(x)}</td>`).join(""), "after channeling; fewer than 2 a turn when power was paid by recycling"],
    ["Cost paid", t.paid.map((x) => `<td class="n">${num(x)}</td>`).join(""), "energy + power of the cards played this turn"],
    ["All runes used", t.allUsed.map((x) => cell(x)).join(""), "no ready rune left at the end of the turn"],
    ["Nothing to play", t.noPlay.map((x) => cell(x)).join(""), "no card in hand could be paid for"],
    ["Wrong domains", t.screwed.map((x) => cell(x)).join(""), "enough runes for a card in hand, but not of its domain"],
    ...(d.legend.domains.length > 1 ? [["Both domains out", t.bothDomains.map((x) => cell(x)).join(""), "a ready rune of each of the legend's domains"]] : []),
  ];
  const cards = r.cards.slice().sort((a, b) => b.champion - a.champion || a.energy - b.energy || a.power - b.power || a.card.name.localeCompare(b.card.name));
  const cardRows = cards.map((c) => `<tr><td class="name"><a href="./#${encodeURIComponent(`"${c.card.name}"`)}">${esc(c.card.name)}</a>${c.champion ? ' <small>champion</small>' : ""}</td>
    <td>${c.card.domains.map(dom).join("")}</td><td class="n">${c.energy}${c.power ? `+${c.power}` : ""}</td><td class="n">${c.copies}</td>
    ${c.castable.map((x, i) => cell(x, `in hand: ${pct(c.seen[i])} · played: ${pct(c.played[i])}`)).join("")}</tr>`).join("");

  $("#out").innerHTML = `
    <h2>${esc(d.legend.name)} <small>${r.games} games, going ${r.second ? "second" : "first"} · mulligan in ${pct(r.mulligans)} of the games</small></h2>
    <div class="scroll"><table class="gf-table"><thead><tr><th></th>${turnHead(T)}</tr></thead><tbody>
      ${rows.map(([h, tds, title]) => `<tr><th title="${esc(title)}">${h}</th>${tds}</tr>`).join("")}</tbody></table></div>
    <h3>Can be played on turn <small>in hand (or the champion zone) and payable with the runes out; hover for in hand / played</small></h3>
    <div class="scroll"><table class="gf-table cards"><thead><tr><th>Card</th><th></th><th class="n">Cost</th><th class="n">#</th>${turnHead(T)}</tr></thead>
      <tbody>${cardRows}</tbody></table></div>
    <h3>Rune split <small>every split of the rune deck, best first</small></h3>
    <div id="splits"><p class="note">working…</p></div>`;
}

function renderSplits(d, s) {
  if (!s.length) { $("#splits").innerHTML = '<p class="note">One domain: nothing to split.</p>'; return; }
  const cur = s.find((x) => x.current);
  const show = s.slice(0, 5);
  if (cur && !show.includes(cur)) show.push(cur);
  const delta = (x) => (cur ? `${x.paid >= cur.paid ? "+" : ""}${num(x.paid - cur.paid)}` : "");
  $("#splits").innerHTML = `<div class="scroll"><table class="gf-table"><thead><tr><th>Runes</th><th class="n">Cost paid T1–T${GF.turns}</th><th class="n">vs yours</th><th class="n">Wrong domains</th></tr></thead><tbody>
    ${show.map((x) => `<tr${x.current ? ' class="cur"' : ""}><th>${Object.entries(x.split).map(([dn, k]) => `${k} ${dom(dn)}`).join(" ")}${x.current ? " <small>yours</small>" : ""}</th>
      <td class="n">${num(x.paid)}</td><td class="n">${x.current ? "" : delta(x)}</td>${cell(x.screwed)}</tr>`).join("")}</tbody></table></div>
    <p class="note">Differences under about 0.3 are noise at ${GF.splitGames} games per split.</p>`;
}

function run(push = true) {
  const text = $("#deck").value;
  if (!text.trim()) { $("#out").innerHTML = ""; $("#problems").innerHTML = ""; return; }
  const h = `#${encodeURIComponent(text.trim())}`;
  if (location.hash !== h) (push ? history.pushState : history.replaceState).call(history, null, "", h);
  const d = readDeck(text);
  showProblems(d);
  if (!d.legend || !d.main.length) { $("#out").innerHTML = ""; return; }
  const opts = { second: $("#order").value === "second", games: Math.max(1000, +$("#games").value || GF.games) };
  $("#status").textContent = "running…";
  // let the page paint "running…" first; the rune splits come after the main tables
  setTimeout(() => {
    render(d, goldfish(d, opts));
    setTimeout(() => { renderSplits(d, runeSplits(d, { second: opts.second })); $("#status").textContent = ""; }, 0);
  }, 0);
}

$("#gf-form").addEventListener("submit", (e) => { e.preventDefault(); run(); });
$("#order").addEventListener("change", () => run(false));
const fromHash = () => { $("#deck").value = decodeURIComponent(location.hash.slice(1)); run(false); };
window.addEventListener("hashchange", fromHash);
if (location.hash.length > 1) fromHash();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js");
