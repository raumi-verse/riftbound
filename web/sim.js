"use strict";
// Goldfish: a deck played alone, no opponent and no card text, to see how it draws and how its runes pay for it.
// No DOM (test/ runs it in node). Needs settings.js; works on decks from deck.js.

const GF = {
  games: 20000, turns: 6, handSize: 4, mulliganMax: 2, keepEnergy: 3, channel: 2, secondExtra: 1,
  firstPlayerDraws: true, exhaustThenRecycle: true, splitGames: 5000,
  ...(window.SETTINGS.goldfish || {}),
};

// a small seeded generator (mulberry32) so a run can be repeated exactly
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- paying for a card ----------
// Runes on the board by domain: ready[d] and spent[d] (exhausted). Energy: exhaust a ready rune. Power of the card's
// domain: recycle a rune of that domain (it leaves the board for the bottom of the rune deck). With
// exhaustThenRecycle one rune may do both in a turn (exhaust for energy, then recycle the exhausted rune).
// pay(...) changes the board and returns true, or leaves it and returns false.
function pay(card, ready, spent, recycled, opt) {
  const r = ready.slice(), s = spent.slice(), out = [];
  const matching = (d) => card.mask & (1 << d);
  const take = (from, pick, n) => { // n runes from `from`, domains chosen by pick order; returns the domains taken
    const got = [];
    for (const d of pick) while (n > 0 && from[d] > 0) { from[d]--; got.push(d); n--; }
    return n === 0 ? got : null;
  };
  const doms = [...ready.keys()];
  const match = doms.filter(matching), other = doms.filter((d) => !matching(d));
  const byCount = (arr, from) => arr.slice().sort((a, b) => from[b] - from[a]);
  if (opt.exhaustThenRecycle) {
    // exhaust matching runes first, so the same runes can then be recycled for power
    const ex = take(r, [...byCount(match, r), ...byCount(other, r)], card.e);
    if (!ex) return false;
    for (const d of ex) s[d]++;
    for (let n = card.p; n > 0; n--) {
      const d = byCount(match, s).find((x) => s[x] > 0);
      if (d !== undefined) { s[d]--; out.push(d); continue; }
      const e = byCount(match, r).find((x) => r[x] > 0);
      if (e === undefined) return false;
      r[e]--; out.push(e);
    }
  } else {
    // power from ready runes of the domain, energy from the rest (the others first)
    const pw = take(r, byCount(match, r), card.p);
    if (!pw) return false;
    out.push(...pw);
    const ex = take(r, [...byCount(other, r), ...byCount(match, r)], card.e);
    if (!ex) return false;
    for (const d of ex) s[d]++;
  }
  ready.splice(0, ready.length, ...r);
  spent.splice(0, spent.length, ...s);
  recycled.push(...out);
  return true;
}
const payable = (card, ready, spent, opt) => pay(card, ready.slice(), spent.slice(), [], opt);

// ---------- one deck, many games ----------
// goldfish(deck, {second, games, turns, seed, runes}) -> per-turn rates and per-card rates, all fractions of games.
// runes: domain names to use instead of the deck's runes (for trying other splits).
function goldfish(deck, o = {}) {
  const opt = { ...GF, second: false, seed: 1, ...o };
  const doms = deck.legend.domains;
  const di = (d) => doms.indexOf(d);
  // the distinct cards as small objects: energy, power, the domains its power may come from
  const kinds = [], kindOf = new Map();
  const kind = (c) => {
    if (!kindOf.has(c.id)) {
      const mask = c.domains.reduce((m, d) => (di(d) >= 0 ? m | (1 << di(d)) : m), 0);
      kindOf.set(c.id, kinds.length);
      kinds.push({ card: c, e: c.energy || 0, p: c.power || 0, mask: mask || (1 << doms.length) - 1 });
    }
    return kindOf.get(c.id);
  };
  const main = deck.main.map(kind);
  const champ = deck.champion ? kind(deck.champion) : -1;
  const runeDoms = (opt.runes || deck.runes.map((r) => r.domains[0])).map(di).filter((d) => d >= 0);
  const T = opt.turns, rand = rng(opt.seed), N = opt.games;

  const z = () => new Array(T).fill(0);
  const turn = { runes: z(), paid: z(), allUsed: z(), noPlay: z(), screwed: z(), bothDomains: z() };
  const seen = kinds.map(z), castable = kinds.map(z), played = kinds.map(z);
  let mulligans = 0;

  for (let g = 0; g < N; g++) {
    const library = shuffle(main.slice(), rand), runeDeck = shuffle(runeDoms.slice(), rand);
    let hand = library.splice(0, opt.handSize);
    // mulligan: set aside up to mulliganMax cards above keepEnergy (the dearest first), draw as many, recycle them
    const aside = hand.map((k, i) => [k, i]).filter(([k]) => kinds[k].e > opt.keepEnergy)
      .sort((a, b) => kinds[b[0]].e - kinds[a[0]].e).slice(0, opt.mulliganMax);
    if (aside.length) {
      mulligans++;
      const drop = new Set(aside.map(([, i]) => i));
      hand = hand.filter((_, i) => !drop.has(i));
      hand.push(...library.splice(0, aside.length));
      library.push(...aside.map(([k]) => k));
    }
    let champInZone = champ >= 0;
    const ever = new Uint8Array(kinds.length), done = new Uint8Array(kinds.length);
    for (const k of hand) ever[k] = 1;
    const ready = doms.map(() => 0), spent = doms.map(() => 0);

    for (let t = 0; t < T; t++) {
      // awaken: ready the runes; channel; draw
      for (let d = 0; d < doms.length; d++) { ready[d] += spent[d]; spent[d] = 0; }
      const ch = opt.channel + (opt.second && t === 0 ? opt.secondExtra : 0);
      for (let i = 0; i < ch && runeDeck.length; i++) ready[runeDeck.shift()]++;
      if (t > 0 || opt.second || opt.firstPlayerDraws) if (library.length) { const k = library.shift(); hand.push(k); ever[k] = 1; }

      const total = ready.reduce((a, b) => a + b, 0);
      turn.runes[t] += total;
      if (doms.length > 1 && doms.every((_, d) => ready[d] > 0)) turn.bothDomains[t]++;
      const options = champInZone ? [...hand, champ] : hand;
      for (let k = 0; k < kinds.length; k++) if (ever[k] || done[k] || k === champ) seen[k][t]++;
      const checked = new Set();
      let screwed = false;
      for (const k of options) {
        if (checked.has(k)) continue;
        checked.add(k);
        const ok = payable(kinds[k], ready, spent, opt);
        if (ok) castable[k][t]++;
        else if (kinds[k].e + kinds[k].p <= total && kinds[k].e <= total) screwed = true; // enough runes, wrong domains
      }
      if (screwed) turn.screwed[t]++;

      // play: the dearest card that can be paid for, until nothing more can
      let used = 0, any = false;
      for (;;) {
        const pool = champInZone ? [...hand.map((k, i) => [k, i]), [champ, -1]] : hand.map((k, i) => [k, i]);
        pool.sort((a, b) => (kinds[b[0]].e + kinds[b[0]].p) - (kinds[a[0]].e + kinds[a[0]].p) || kinds[a[0]].p - kinds[b[0]].p);
        const recycled = [];
        const hit = pool.find(([k]) => pay(kinds[k], ready, spent, recycled, opt));
        if (!hit) break;
        const [k, i] = hit;
        for (const d of recycled) runeDeck.push(d);
        if (i < 0) champInZone = false; else hand.splice(i, 1);
        used += kinds[k].e + kinds[k].p; any = true; done[k] = 1; played[k][t]++;
      }
      turn.paid[t] += used;
      if (!ready.some((n) => n > 0)) turn.allUsed[t]++;
      if (!any) turn.noPlay[t]++;
    }
  }

  const rate = (a) => a.map((n) => n / N);
  return {
    games: N, turns: T, second: opt.second, mulligans: mulligans / N,
    turn: Object.fromEntries(Object.entries(turn).map(([k, v]) => [k, rate(v)])),
    cards: kinds.map((k, i) => ({ card: k.card, energy: k.e, power: k.p, copies: main.filter((x) => x === i).length + (i === champ ? 1 : 0),
      champion: i === champ, seen: rate(seen[i]), castable: rate(castable[i]), played: rate(played[i]) })),
  };
}

// Cost paid over all turns, energy + power (what the deck got done), and how often it had the runes but the wrong domains
const score = (r) => ({ paid: r.turn.paid.reduce((a, b) => a + b, 0), screwed: r.turn.screwed.reduce((a, b) => a + b, 0) / r.turns });

// Every split of the rune deck between the legend's two domains, best first (most cost paid, then least screw).
// -> [{split: {Fury: 7, Mind: 5}, paid, screwed, current}]
function runeSplits(deck, o = {}) {
  const doms = deck.legend.domains, n = deck.runes.length || 12;
  if (doms.length < 2) return [];
  const have = doms.map((d) => deck.runes.filter((r) => r.domains[0] === d).length);
  const out = [];
  for (let a = 0; a <= n; a++) {
    const runes = [...Array(a).fill(doms[0]), ...Array(n - a).fill(doms[1])];
    const s = score(goldfish(deck, { games: GF.splitGames, ...o, runes }));
    out.push({ split: { [doms[0]]: a, [doms[1]]: n - a }, ...s, current: a === have[0] && n - a === have[1] });
  }
  return out.sort((x, y) => y.paid - x.paid || x.screwed - y.screwed);
}
