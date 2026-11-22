"use strict";
// Your decks, their versions and your matches, as records in the store. No DOM (test/ runs it in node).
// Needs query.js, store.js, deck.js and collection.js first.
//
//   deck    {name, status: "pinned"|"active"|"archived", notes, tags: [], legend: card id, version: deckver id, created}
//   deckver {deck, n, list (deckText), code (Piltover deck code or ""), ids (printing ids, one per copy), created}
//           never changed; a deck's list changes by a new version
//   match   {deck, deckver, date, source: "app"|"tts", result: "win"|"loss"|"draw", first: true|false|null,
//            me: {conquer, hold, extra}, opp: {…}, log: [{turn, who: "me"|"opp", kind, delta}], oppLegend: card id,
//            oppName, oppList, event, game (1–3), tags: [], notes, needsNotes}

const STATUSES = ["pinned", "active", "archived"];
const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));

const LIB = {
  decks: () => STORE.all("deck").map(({ id, data }) => ({ id, ...data })),
  deck: (id) => { const d = STORE.get("deck", id); return d && { id, ...d }; },
  versions: (deck) => STORE.all("deckver").filter((v) => v.data.deck === deck).map(({ id, data }) => ({ id, ...data })).sort((a, b) => a.n - b.n),
  version: (id) => { const v = STORE.get("deckver", id); return v && { id, ...v }; },
  matches: (deck) => STORE.all("match").filter((m) => !deck || m.data.deck === deck).map(({ id, data }) => ({ id, ...data }))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "")),

  // A pasted list or code becomes a deck (deckId null) or the deck's next version; the same list again changes
  // nothing. -> {deck, version, created: bool, parsed (readDeck's result)}
  save(deckId, text, fields = {}) {
    const parsed = readDeck(text);
    const list = deckText(parsed);
    let code = "";
    try { code = parsed.legend ? encodeDeckCode(parsed) : ""; } catch { /* a card no code can hold */ }
    const ids = [parsed.legend, parsed.champion, ...parsed.main, ...parsed.battlefields, ...parsed.runes].filter(Boolean).map((c) => c.id).join(" ");
    const now = new Date().toISOString();
    let deck = deckId && LIB.deck(deckId);
    if (deck) {
      const cur = deck.version && LIB.version(deck.version);
      if (cur && cur.list === list) {
        if (Object.keys(fields).length) STORE.put("deck", deck.id, { ...strip(deck), ...fields });
        return { deck: deck.id, version: cur.id, created: false, parsed };
      }
    } else {
      deckId = STORE.uid();
      deck = { id: deckId, name: fields.name || (parsed.legend ? parsed.legend.name : "New deck"), status: "active", notes: "", tags: [], created: now };
    }
    const n = Math.max(0, ...LIB.versions(deckId).map((v) => v.n)) + 1;
    const vid = STORE.uid();
    STORE.put("deckver", vid, { deck: deckId, n, list, code, ids, created: now });
    STORE.put("deck", deckId, { ...strip(deck), ...fields, legend: parsed.legend?.id ?? deck.legend ?? null, version: vid });
    return { deck: deckId, version: vid, created: true, parsed };
  },
  setDeck(id, fields) { const d = LIB.deck(id); if (d) STORE.put("deck", id, { ...strip(d), ...fields }); },
  // a deck goes with its versions; its matches stay (they show as "deleted deck")
  removeDeck(id) {
    for (const v of LIB.versions(id)) STORE.del("deckver", v.id);
    STORE.del("deck", id);
  },
  saveMatch(id, fields) {
    id ||= STORE.uid();
    const old = STORE.get("match", id) || { source: "app", date: new Date().toISOString(), tags: [], notes: "" };
    STORE.put("match", id, { ...old, ...fields });
    return id;
  },
  removeMatch: (id) => STORE.del("match", id),
};
const strip = (o) => { const { id, ...rest } = o; return rest; };

// W / L / D, games and win rate (draws count as half)
function record(matches) {
  const r = { win: 0, loss: 0, draw: 0, n: 0 };
  for (const m of matches) if (r[m.result] != null) { r[m.result]++; r.n++; }
  r.pct = r.n ? (r.win + r.draw / 2) / r.n : null;
  return r;
}
// matches split by a key, biggest first: by version, opposing legend, going first or second
function recordBy(matches, key) {
  const by = new Map();
  for (const m of matches) { const k = key(m); if (!by.has(k)) by.set(k, []); by.get(k).push(m); }
  return [...by].map(([k, ms]) => ({ key: k, ...record(ms) })).sort((a, b) => b.n - a.n);
}

// copies per card name in a version's list
function counts(list) {
  const d = readDeck(list), m = new Map();
  for (const c of [d.legend, d.champion, ...d.main, ...d.battlefields, ...d.runes, ...(d.side || [])].filter(Boolean)) m.set(c.name, (m.get(c.name) || 0) + 1);
  return m;
}
// what changed from list a to list b: [{name, delta}] (+ added, − removed), by name
function diffLists(a, b) {
  const ca = a ? counts(a) : new Map(), cb = counts(b), out = [];
  for (const name of new Set([...ca.keys(), ...cb.keys()])) {
    const delta = (cb.get(name) || 0) - (ca.get(name) || 0);
    if (delta) out.push({ name, delta });
  }
  return out.sort((x, y) => y.delta - x.delta || x.name.localeCompare(y.name));
}
// the cards of a list you have fewer copies of than it needs, any printing counting
function missing(list) {
  const d = readDeck(list), need = new Map();
  for (const c of [d.legend, d.champion, ...d.main, ...d.battlefields, ...d.runes].filter(Boolean)) need.set(c, (need.get(c) || 0) + 1);
  const out = [];
  for (const [card, n] of need) {
    const have = card.printings.reduce((s, p) => s + COLL.n(p.id), 0);
    if (have < n) out.push({ card, need: n, have });
  }
  return out;
}
const scoreOf = (side) => side ? (side.conquer || 0) + (side.hold || 0) + (side.extra || 0) : 0;

// ---------- a game being played (Play page): one record, game/current ----------
// {deck, deckver, oppLegend, oppName, event, first, target, bo, game, series: [match ids], wins: {me, opp},
//  turn, me: {conquer, hold, extra}, opp: {…}, log: [{turn, who, kind, delta}], started}
const GAME = {
  start(o) {
    const z = () => ({ conquer: 0, hold: 0, extra: 0 });
    return { deck: o.deck, deckver: o.deckver ?? LIB.deck(o.deck)?.version ?? null, oppLegend: o.oppLegend || null, oppName: o.oppName || "",
      event: o.event || "", first: o.first ?? null, target: o.target || 8, bo: o.bo || 1, game: o.game || 1, series: o.series || [],
      wins: o.wins || { me: 0, opp: 0 }, turn: 1, me: z(), opp: z(), log: [], started: new Date().toISOString() };
  },
  total: (g, who) => scoreOf(g[who]),
  // +1 (or −1) of a kind for one side; never below 0
  point(g, who, kind, delta = 1) {
    if (delta < 0 && !g[who][kind]) return g;
    return { ...g, [who]: { ...g[who], [kind]: g[who][kind] + delta }, log: [...g.log, { turn: g.turn, who, kind, delta }] };
  },
  undo(g) {
    const last = g.log.at(-1);
    if (!last) return g;
    if (last.kind === "turn") return { ...g, turn: Math.max(1, g.turn - 1), log: g.log.slice(0, -1) };
    return { ...g, [last.who]: { ...g[last.who], [last.kind]: g[last.who][last.kind] - last.delta }, log: g.log.slice(0, -1) };
  },
  nextTurn: (g) => ({ ...g, turn: g.turn + 1, log: [...g.log, { turn: g.turn, kind: "turn" }] }),
  // whose turn it is, if who went first is known: turns alternate, the first player has the odd ones
  mine: (g) => (g.first == null ? null : (g.turn % 2 === 1) === g.first),
  winner: (g) => (GAME.total(g, "me") >= g.target ? "me" : GAME.total(g, "opp") >= g.target ? "opp" : null),
  // the match record for this game
  toMatch(g, result, extra = {}) {
    return { deck: g.deck, deckver: g.deckver, date: new Date().toISOString(), source: "app", result, first: g.first,
      me: g.me, opp: g.opp, log: g.log.filter((l) => l.kind !== "turn"), turns: g.turn, oppLegend: g.oppLegend, oppName: g.oppName,
      event: g.event, game: g.bo > 1 ? g.game : null, tags: [], notes: "", ...extra };
  },
  // after a game of a best of 3: the next one (the loser goes first) or null when the series is decided
  next(g, result, matchId) {
    const wins = { me: g.wins.me + (result === "win"), opp: g.wins.opp + (result === "loss") };
    const need = Math.ceil(g.bo / 2);
    if (g.bo === 1 || wins.me >= need || wins.opp >= need || g.game >= g.bo) return null;
    return GAME.start({ ...g, game: g.game + 1, series: [...g.series, matchId], wins, first: result === "draw" ? g.first : result === "loss" });
  },
};
