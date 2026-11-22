// Your settings for the Riftbound browser. Edit, save, reload the page.
window.SETTINGS = {
  // The sync server (server.py) the account button logs in to; the login dialog can change it per browser.
  syncServer: "https://api.rb.raumi.dev",

  // What the page shows when the search box is empty, e.g. "group:champion" or "-is:token".
  defaultQuery: "",

  // Sort used when the query has no sort:. Keys: name, energy (e), might (m), power (p), type,
  // domain, rarity, set, champion, role, num. A leading "-" sorts that key descending.
  defaultSort: "domain,energy,name",

  // Inside group:champion the legend comes first, then champion units, then signatures, then other
  // cards with the champion's tag; this sort decides the order inside each of those.
  championSort: "energy,name",

  // "grid" (card pictures) or "list" (a table with rules text). The ▦/☰ button switches.
  view: "grid",

  // Show the filter bar (domains, energy, type, rarity, legend, keyword, set, sort, groups) under the
  // search. The Filters button hides it; that choice is remembered in the browser.
  showFilters: true,

  // Card width in the grid, in pixels.
  cardWidth: 200,

  // true: one entry per card, its alt arts and reprints shown in the details.
  // false: every printing is its own entry (same as typing show:printings).
  foldPrintings: true,

  // Hide tokens and basic runes unless the query asks for them (is:token, t:rune).
  hideTokensAndRunes: true,

  // Order of the domains when sorting by domain.
  domainOrder: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"],

  // The goldfish page (goldfish.html): a deck played alone, no opponent, no card text.
  goldfish: {
    // Games per run (20000: about a second), and per rune split when trying them all.
    games: 20000,
    splitGames: 5000,
    // Turns shown.
    turns: 6,
    // Mulligan: set aside up to mulliganMax cards costing more than keepEnergy, draw as many, recycle them.
    // mulliganMax: 0 keeps every opening hand.
    mulliganMax: 2,
    keepEnergy: 3,
    // The game's numbers (Core Rules): opening hand, runes channeled per turn, extra runes for the player
    // going second on their first turn.
    handSize: 4,
    channel: 2,
    secondExtra: 1,
    // Does the player going first draw on turn 1? (Not confirmed for 1v1; multiplayer modes skip it.)
    firstPlayerDraws: true,
    // May one rune be exhausted for energy and then recycled for power in the same turn? (Not confirmed.)
    exhaustThenRecycle: true,
  },
};
