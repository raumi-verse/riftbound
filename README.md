# riftbound

My own Riftbound card browser: every card in one local file, a search box with a real query language, multi-key sorting
and grouping, in particular **each champion's legend, champion units and signatures together**.

```sh
python3 sync.py            # pull all cards from Riftcodex into web/cards.js (~2 min, run again after a new set)
python3 sync.py --images   # also keep the card pictures in web/img/ for offline use
xdg-open web/index.html    # the page; nothing runs in the background
```

Card data comes from the unofficial [Riftcodex](https://riftcodex.com) API; pictures from Riot's CDN.

## Searching

Press `/` to focus the search; the `?` button has the full cheat sheet. The query is in the URL, so searches can be bookmarked.

| query | gives |
|---|---|
| `group:champion` | every champion: legend, champion units, signatures, other cards with the tag |
| `champ:jinx` / `champ="lee sin"` | one champion's cards |
| `group:champion has:legend` | only champions that have a legend |
| `d<=fury,chaos t:unit m>=5 sort:energy` | big units playable in a Fury/Chaos deck |
| `kw:accelerate e<=3` | cheap units with Accelerate |
| `o:/when you conquer/ sort:-might view:list` | rules text regex, list view |
| `(t:spell or t:gear) -d:fury r:epic` | or, brackets, not |
| `show:printings is:alt` | every alternate-art printing |

By default reprints, alternate arts, overnumbered, signature and metal prints of a card are folded into one entry
(the details show them all). A card's champion is the champion's tag; legends and units are linked by name.

## Settings

`web/settings.js` (commented): default query, default sort, the sort inside champion groups, grid/list, card size,
folding, hiding tokens/runes, domain order. Edit and reload.

## Files

- `sync.py`: fetch, fold printings into cards, link champions, write `web/cards.js`
- `web/app.js`: query parser, filters, sorting, grouping, rendering
- `web/index.html`, `web/style.css` (Catppuccin Mocha)
