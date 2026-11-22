"use strict";
// The Decks page: your decks (pinned, active, archived), one deck with its list, versions, notes, record and matches.
// #            the list
// #d/<id>      one deck (#d/<id>/<version id> shows an older version)

const main = $("#lib");

function route() {
  const [, id, ver] = location.hash.match(/^#d\/([^/]+)(?:\/(.+))?/) || [];
  if (id && LIB.deck(id)) deckView(id, ver); else listView();
}

// ---------- the list ----------

function deckTile(d) {
  const legend = CARD_BY_ID.get(d.legend), ms = LIB.matches(d.id), r = record(ms), v = d.version && LIB.version(d.version);
  const miss = v ? missing(v.list).reduce((n, x) => n + x.need - x.have, 0) : 0;
  const img = cardImg(legend);
  return `<a class="deck-tile" href="#d/${esc(d.id)}">
    <span class="art"${img ? ` style="background-image:url('${esc(img)}')"` : ""}></span>
    <span class="body"><b>${esc(d.name)}</b><small>${esc(legend?.name || "no legend")}${v ? ` · v${v.n}` : ""}</small>
      <span class="rec">${recordText(r)}${r.n ? ` <small>${pct(r.pct)}</small>` : ""}${ms[0] ? ` <small>· ${day(ms[0].date)}</small>` : ""}</span>
      ${miss ? `<span class="miss" title="cards you have fewer copies of than the deck needs">${miss} missing</span>` : ""}
      ${ms.some((m) => m.needsNotes) ? `<span class="todo" title="games from the table without notes yet">notes to write</span>` : ""}</span>
    <button type="button" class="pin${d.status === "pinned" ? " on" : ""}" data-pin="${esc(d.id)}" title="${d.status === "pinned" ? "Unpin" : "Pin: your main decks, on top everywhere"}">★</button></a>`;
}

function listView() {
  document.title = "Riftbound decks";
  const decks = LIB.decks().sort((a, b) => (LIB.matches(b.id)[0]?.date || b.created || "").localeCompare(LIB.matches(a.id)[0]?.date || a.created || ""));
  const by = (s) => decks.filter((d) => d.status === s);
  const recent = LIB.matches().slice(0, 12);
  main.innerHTML = `
    <div class="head"><h1>Decks</h1><span class="grow"></span><button type="button" class="primary" id="new-open">New deck</button></div>
    <form id="new-deck" class="card-form" hidden>
      <label>Name <input name="name" placeholder="defaults to the legend's name"></label>
      <label><span>List: a Piltover deck code or <code>2 Name</code> lines</span><textarea name="list" rows="8" spellcheck="false" required></textarea></label>
      <div class="row"><button type="button" class="cancel">Cancel</button><button class="primary">Save deck</button></div>
    </form>
    ${!decks.length ? `<p class="empty">No decks yet. <b>New deck</b> takes a deck code or a list, e.g. from Piltover Archive.</p>` : ""}
    ${by("pinned").length ? `<h2>Pinned</h2><div class="decks">${by("pinned").map(deckTile).join("")}</div>` : ""}
    ${by("active").length ? `<h2>${by("pinned").length ? "Others" : "Decks"}</h2><div class="decks">${by("active").map(deckTile).join("")}</div>` : ""}
    ${by("archived").length ? `<details class="archived"><summary>Archived (${by("archived").length})</summary><div class="decks">${by("archived").map(deckTile).join("")}</div></details>` : ""}
    ${recent.length ? `<h2>Recent games</h2>${matchTable(recent, true)}` : ""}`;
  const form = $("#new-deck");
  $("#new-open").onclick = () => { form.hidden = false; form.list.focus(); };
  form.querySelector(".cancel").onclick = () => { form.hidden = true; };
  form.onsubmit = (e) => {
    e.preventDefault();
    const r = LIB.save(null, form.list.value, form.name.value.trim() ? { name: form.name.value.trim() } : {});
    location.hash = `#d/${r.deck}`;
  };
}

// pin / unpin from a tile without opening it
main.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pin]");
  if (!b) return;
  e.preventDefault();
  const d = LIB.deck(b.dataset.pin);
  LIB.setDeck(d.id, { status: d.status === "pinned" ? "active" : "pinned" });
});

// ---------- matches ----------

function matchTable(ms, withDeck = false) {
  if (!ms.length) return `<p class="note">No games${withDeck ? "" : " with these filters"}.</p>`;
  const vers = new Map();
  const vn = (id) => { if (!id) return ""; if (!vers.has(id)) vers.set(id, LIB.version(id)?.n); return vers.get(id) ? `v${vers.get(id)}` : ""; };
  return `<div class="scroll"><table class="gf-table matches"><thead><tr><th>When</th>${withDeck ? "<th>Deck</th>" : "<th></th>"}<th>Result</th><th>Against</th><th>Went</th><th class="n">Score</th><th>Notes</th></tr></thead><tbody>
    ${ms.map((m) => `<tr data-m="${esc(m.id)}" class="${esc(m.result || "")}">
      <td>${day(m.date)}${m.game ? ` <small>g${m.game}</small>` : ""}</td>
      <td>${withDeck ? esc(LIB.deck(m.deck)?.name || "deleted deck") : `<small>${vn(m.deckver)}</small>`}</td>
      <td class="res">${esc(m.result || "?")}</td>
      <td>${esc(legendName(m.oppLegend))}${m.oppName ? ` <small>${esc(m.oppName)}</small>` : ""}</td>
      <td>${m.first == null ? "" : m.first ? "first" : "second"}</td>
      <td class="n" title="${["me", "opp"].map((w) => `${w === "me" ? "me" : "opponent"}: ${KINDS.map((k) => `${m[w]?.[k] || 0} ${k}`).join(", ")}`).join("\n")}">${m.me || m.opp ? `${scoreOf(m.me)}–${scoreOf(m.opp)}` : ""}</td>
      <td class="notes">${m.needsNotes ? `<span class="todo">write notes</span> ` : ""}${(m.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join(" ")} ${esc((m.notes || "").slice(0, 90))}${(m.notes || "").length > 90 ? "…" : ""}${m.source === "tts" ? ` <small>TTS</small>` : ""}</td></tr>`).join("")}
  </tbody></table></div>`;
}
main.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-m]");
  if (!tr) return;
  const id = tr.dataset.m;
  matchDialog({ id, ...STORE.get("match", id) });
});

// ---------- one deck ----------

const TYPE_ORDER_DECK = ["Unit", "Spell", "Gear"];
function listHtml(list) {
  const d = readDeck(list);
  // "have" only once there is a collection; against the copies of the whole deck (chosen champion included)
  const tracking = STORE.all("coll").length > 0, need = new Map();
  for (const c of [d.legend, d.champion, ...d.main, ...d.battlefields, ...d.runes].filter(Boolean)) need.set(c.id, (need.get(c.id) || 0) + 1);
  const group = (cards) => {
    const m = new Map();
    for (const c of cards) m.set(c, (m.get(c) || 0) + 1);
    return [...m].sort(([a], [b]) => (a.energy ?? 99) - (b.energy ?? 99) || a.name.localeCompare(b.name));
  };
  const row = ([c, n]) => {
    const have = c.printings.reduce((s, p) => s + COLL.n(p.id), 0), want = need.get(c.id) || n;
    return `<li><span class="n">${n}</span>${c.energy != null && !["Legend", "Battlefield", "Rune"].includes(c.type) ? `<img class="ic" src="icons/${c.energy}.svg" alt="${c.energy}">` : `<span class="ic"></span>`}
      <a href="./#${encodeURIComponent(`id=${c.id}`)}" data-img="${esc(cardImg(c) || "")}">${esc(c.name)}</a>${domainIcons(c)}${tracking && have < want ? ` <small class="miss" title="the deck needs ${want}, you have ${have}">have ${have}</small>` : ""}</li>`;
  };
  const sec = (title, cards) => {
    if (!cards.length) return "";
    const rows = group(cards);
    return `<h3>${title} <small>${cards.length}</small></h3><ul class="cards${rows.length > 3 ? " two" : ""}">${rows.map(row).join("")}</ul>`;
  };
  const mainCards = d.champion ? [d.champion, ...d.main] : d.main;
  return `${sec("Legend", d.legend ? [d.legend] : [])}${sec("Chosen champion", d.champion ? [d.champion] : [])}
    ${TYPE_ORDER_DECK.map((t) => sec(t + "s", d.main.filter((c) => c.type === t || (t === "Unit" && !TYPE_ORDER_DECK.includes(c.type))))).join("")}
    ${sec("Battlefields", d.battlefields)}${sec("Runes", d.runes)}${sec("Sideboard", d.side || [])}
    ${d.problems.length ? `<ul class="problems">${d.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : `<p class="note">${mainCards.length} cards, legal.</p>`}`;
}

const filters = { ver: "", opp: "", first: "", tag: "" };
function deckView(id, verId) {
  const d = LIB.deck(id), versions = LIB.versions(id);
  const cur = LIB.version(d.version), shown = (verId && LIB.version(verId)) || cur;
  const legend = CARD_BY_ID.get(d.legend), all = LIB.matches(id);
  document.title = `${d.name} · Riftbound decks`;
  const ms = all.filter((m) => (!filters.ver || m.deckver === filters.ver) && (!filters.opp || m.oppLegend === filters.opp)
    && (filters.first === "" || String(m.first) === filters.first) && (!filters.tag || (m.tags || []).includes(filters.tag)));
  const r = record(all);
  const statRows = (rows, label) => rows.map((x) => `<tr><td>${label(x.key)}</td><td class="n">${recordText(x)}</td><td class="n">${pct(x.pct)}</td></tr>`).join("");
  const tags = [...new Set(all.flatMap((m) => m.tags || []))].sort();
  const opps = [...new Set(all.map((m) => m.oppLegend).filter(Boolean))];
  main.innerHTML = `
    <p><a href="#">← Decks</a></p>
    <div class="deck-head">
      ${cardImg(legend) ? `<img class="legend" src="${esc(cardImg(legend))}" alt="">` : ""}
      <div class="grow">
        <input class="title" id="name" value="${esc(d.name)}" aria-label="Deck name">
        <p class="note">${esc(legend?.name || "no legend")} · ${recordText(r)}${r.n ? ` · ${pct(r.pct)}` : ""}</p>
        <div class="seg status">${STATUSES.map((s) => `<button type="button" data-status="${s}" class="${d.status === s ? "on" : ""}">${{ pinned: "★ Pinned", active: "Active", archived: "Archived" }[s]}</button>`).join("")}</div>
        <label class="tags">Tags <input id="tags" value="${esc((d.tags || []).join(", "))}" placeholder="e.g. main, testing"></label>
        <div class="row actions">
          <a class="btn primary" href="play.html#deck=${esc(id)}">Play</a>
          <button type="button" id="log">Log a game</button>
          ${cur ? `<a class="btn" href="goldfish.html#${encodeURIComponent(cur.code || cur.list)}">Goldfish</a>` : ""}
          ${cur?.code ? `<button type="button" data-copy="${esc(cur.code)}">Copy deck code</button>` : ""}
          ${cur ? `<button type="button" data-copy="${esc(cur.list)}">Copy list</button>` : ""}
          <button type="button" id="del" class="danger">Delete</button>
        </div>
      </div>
    </div>
    <div class="cols">
      <section>
        <h2>${shown === cur ? "List" : "Version"} ${shown ? `<small>v${shown.n} · ${day(shown.created)}</small>` : ""}
          ${shown && shown !== cur ? `<button type="button" id="restore">Use this version again</button> <a href="#d/${esc(id)}">current</a>` : `<button type="button" id="edit">Edit</button>`}</h2>
        <form id="edit-form" hidden><textarea name="list" rows="14" spellcheck="false">${esc(cur?.list || "")}</textarea>
          <div class="row"><button type="button" class="cancel">Cancel</button><button class="primary">Save as new version</button></div></form>
        <div id="list">${shown ? listHtml(shown.list) : ""}</div>
        <h2>Versions</h2>
        <ol class="versions" reversed>${versions.slice().reverse().map((v, i, arr) => {
          const prev = arr[i + 1], diff = diffLists(prev?.list, v.list), vr = record(all.filter((m) => m.deckver === v.id));
          return `<li class="${v.id === shown?.id ? "on" : ""}"><a href="#d/${esc(id)}/${esc(v.id)}">v${v.n}</a> <small>${day(v.created)}${vr.n ? ` · ${recordText(vr)} ${pct(vr.pct)}` : ""}</small>
            <div class="diff">${prev ? diff.map((x) => `<span class="${x.delta > 0 ? "add" : "rem"}">${x.delta > 0 ? "+" : ""}${x.delta} ${esc(x.name)}</span>`).join(" ") || "<small>same list</small>" : "<small>first version</small>"}</div></li>`;
        }).join("")}</ol>
      </section>
      <section>
        <h2>Notes</h2>
        <textarea id="notes" rows="6" placeholder="Plan, mulligans, matchups…">${esc(d.notes || "")}</textarea>
        <h2>Record</h2>
        ${r.n ? `<table class="gf-table rec"><tbody>
          <tr class="cur"><th>All games</th><td class="n">${recordText(r)}</td><td class="n">${pct(r.pct)}</td></tr>
          ${statRows(recordBy(all.filter((m) => m.first != null), (m) => m.first), (k) => (k ? "Going first" : "Going second"))}
          <tr><th colspan="3">By version</th></tr>${statRows(recordBy(all, (m) => m.deckver), (k) => `v${LIB.version(k)?.n ?? "?"}`)}
          <tr><th colspan="3">Against</th></tr>${statRows(recordBy(all, (m) => m.oppLegend || ""), (k) => esc(legendName(k)))}
        </tbody></table>` : `<p class="note">No games yet: <b>Play</b> counts the points and saves the game, <b>Log a game</b> enters one played elsewhere.</p>`}
        <h2>Games</h2>
        ${all.length ? `<div class="row filters">
          <select data-f="ver"><option value="">all versions</option>${versions.map((v) => `<option value="${esc(v.id)}"${filters.ver === v.id ? " selected" : ""}>v${v.n}</option>`).join("")}</select>
          <select data-f="opp"><option value="">any opponent</option>${opps.map((o) => `<option value="${esc(o)}"${filters.opp === o ? " selected" : ""}>${esc(legendName(o))}</option>`).join("")}</select>
          <select data-f="first"><option value="">first or second</option><option value="true"${filters.first === "true" ? " selected" : ""}>going first</option><option value="false"${filters.first === "false" ? " selected" : ""}>going second</option></select>
          ${tags.length ? `<select data-f="tag"><option value="">any tag</option>${tags.map((t) => `<option${filters.tag === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>` : ""}
        </div>` : ""}
        ${matchTable(ms)}
      </section>
    </div>`;

  $("#name").onchange = (e) => LIB.setDeck(id, { name: e.target.value.trim() || d.name });
  $("#tags").onchange = (e) => LIB.setDeck(id, { tags: splitTags(e.target.value) });
  let t;
  $("#notes").oninput = (e) => { clearTimeout(t); t = setTimeout(() => LIB.setDeck(id, { notes: e.target.value }), 600); };
  $("#notes").onblur = (e) => { clearTimeout(t); if (e.target.value !== (LIB.deck(id).notes || "")) LIB.setDeck(id, { notes: e.target.value }); };
  main.querySelectorAll("[data-status]").forEach((b) => (b.onclick = () => LIB.setDeck(id, { status: b.dataset.status })));
  main.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; } catch { b.textContent = "Couldn't copy"; }
  }));
  main.querySelectorAll(".filters select").forEach((s) => (s.onchange = () => { filters[s.dataset.f] = s.value; route(); }));
  $("#log").onclick = () => matchDialog({ deck: id, deckver: d.version });
  $("#del").onclick = () => {
    if (confirm(`Delete "${d.name}" and its ${versions.length} versions? Its ${all.length} games stay (as "deleted deck"). Archiving keeps it all, just out of the way.`)) {
      LIB.removeDeck(id); location.hash = "";
    }
  };
  const ef = $("#edit-form");
  if ($("#edit")) $("#edit").onclick = () => { ef.hidden = false; $("#list").hidden = true; ef.list.focus(); };
  ef.querySelector(".cancel").onclick = () => { ef.hidden = true; $("#list").hidden = false; };
  ef.onsubmit = (e) => { e.preventDefault(); LIB.save(id, ef.list.value); route(); };
  if ($("#restore")) $("#restore").onclick = () => { LIB.save(id, shown.list); location.hash = `#d/${id}`; };
}

// a card's picture while hovering its name in a list
const peek = document.createElement("img");
peek.className = "peek";
document.body.append(peek);
main.addEventListener("mouseover", (e) => {
  const a = e.target.closest("a[data-img]");
  if (!a || !a.dataset.img || matchMedia("(hover: none)").matches) return;
  peek.src = a.dataset.img;
  const r = a.getBoundingClientRect();
  peek.style.top = `${Math.min(window.innerHeight - 330, Math.max(8, r.top - 120))}px`;
  peek.style.left = `${r.right + 16}px`;
  peek.hidden = false;
});
main.addEventListener("mouseout", (e) => { if (e.target.closest("a[data-img]")) peek.hidden = true; });
peek.hidden = true;

window.addEventListener("hashchange", route);
// edits from another tab or device; not while typing in this one
STORE.on((kinds) => {
  if (!["deck", "deckver", "match", "coll"].some((k) => kinds.has(k))) return;
  if (document.activeElement?.matches("input, textarea") && main.contains(document.activeElement)) return;
  if ($("#match-dlg")?.open) return;
  route();
});
route();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js");
