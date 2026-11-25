// Your settings for the Riftbound browser. Edit, save, reload the page.
window.SETTINGS = {
  // The sync server (server.py) the account button logs in to; the login dialog can change it per browser.
  syncServer: "https://rb-api.raumi.dev",

  // Sites whose addresses show without .html (GitHub Pages serves both).
  cleanAddresses: ["rb.raumi.dev"],

  // Play: the points a game is won at (8 in a 1 v 1), and whether the opponent's half of the counter is upside
  // down by default (the phone flat on the table between you).
  playTarget: 8,
  playFaceToFace: false,

  // Your cards' languages, offered in the card dialog (en, zh, fr, ko). Others show once you have some.
  languages: ["en", "zh"],

  // How many copies of a printing stay in the box, by type; the rest are spares (Collection). A card that should keep
  // every copy says so in its dialog; tokens and cards a deck may have any number of do by themselves.
  playset: { Legend: 1, Battlefield: 1, Rune: 12, other: 3 },

  // Which copies those are: languages in the order above, in each the non-foils first. Switched on the Spares list.
  keepFoilFirst: false,

  // The site whose rulings are shown with a card, loaded from it when the card is opened: {id} is a printing's id as in
  // their addresses (SFD-202 is SFD202). api "": only the links, nothing is loaded. list: for cards without such a
  // number (tokens); "" for nothing at all.
  rulingsSite: {
    name: "Joutes",
    api: "https://www.joutes.app/api/games/riftbound/cards/{id}",
    card: "https://www.joutes.app/en/games/riftbound/cards/{id}",
    list: "https://www.joutes.app/en/games/riftbound/cards",
  },

  // Scanning: show what the text recognition read in each frame (for tuning).
  scanDebug: false,

  // What the page shows when the search box is empty, e.g. "group:champion" or "-is:token".
  defaultQuery: "",

  // Sort used when the query has no sort:, and the order cards are filed in after scanning. Keys: name, energy (e), might (m), power (p), type,
  // domain, rarity, set, champion, role, num, and file: as the cards are filed in the box, by fileOrder; then the
  // legends, each followed by its signatures; then the battlefields. A leading "-" sorts that key descending.
  fileOrder: "domain,rarity,energy,power,set,num",
  defaultSort: "file",

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
