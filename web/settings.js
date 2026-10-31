// Your settings for the Riftbound browser. Edit, save, reload the page.
window.SETTINGS = {
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
};
