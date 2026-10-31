# riftbound

My own Riftbound card browser: every card in one local file, a search box with a real query language, multi-key sorting
and grouping, in particular **each champion's legend, champion units and signatures together**.

```sh
python3 sync.py            # pull all cards from Piltover Archive into web/cards.js (a few seconds)
python3 sync.py --images   # also keep the card pictures in web/img/ for offline use
xdg-open web/index.html    # the page; nothing runs in the background
```

Hosted at https://rb.raumi.dev/search/; a GitHub Action syncs the cards every Monday (or on "Run workflow").
Once opened there it also works offline (cards, icons and the pictures you've seen) and can be installed as an
app on a phone.
Card data and pictures come from the unofficial [Piltover Archive](https://piltoverarchive.com) API (Riftcodex lacked
Radiance and the Nexus Night/Worlds printings).

## Searching

Press `/` to focus the search; the `?` button has the full cheat sheet. The query is in the URL, so searches can be bookmarked.

The filter bar under the search has the everyday filters as the game's symbols: domains (any of / all of / within),
energy, type, rarity, plus legend (`for:`), keyword, set, sort and grouping. It only writes terms into the query
(`d:fury|chaos e:2|3 t:unit`), so a click is a start you can keep typing on; **Filters** hides it.

| query | gives |
|---|---|
| `group:champion` | every champion: legend, champion units, signatures, other cards with the tag |
| `champ:jinx` / `champ="lee sin"` | one champion's cards |
| `group:champion has:legend` | only champions that have a legend (`has:` filters groups, `is:` cards) |
| `group:champion has:(t:legend d:fury)` | champions whose legend is Fury |
| `champ:(t:legend d:calm)` | every card of the champions whose legend is Calm (no `group:` needed) |
| `for:(t:legend d:fury) t:unit e<=2` | cheap units any Fury legend may play |
| `for:jinx group:type` | everything a Jinx deck may play: her domains, neutral cards, her signatures, battlefields, nothing banned |
| `group:champion order:domain,-count` | sort the groups themselves (`sort:` orders the cards inside) |
| `d<=fury,chaos t:unit m>=5 sort:energy` | big units playable in a Fury/Chaos deck |
| `kw:accelerate e<=3` | cheap units with Accelerate |
| `o:/when you conquer/ sort:-might view:list` | rules text regex, list view |
| `(t:spell or t:gear) -d:fury r:epic` | or, brackets, not |
| `t:unit\|gear e:7+ kw:tank\|shield` | `a\|b` is any of them in any field, `7+` is 7 or more |
| `show:printings is:alt` | every alternate-art printing |

Click a card for its details: ←/→ step through the results, the champion's other cards are below. Hovering a
keyword shows its reminder text.

By default reprints, alternate arts, overnumbered, signature and metal prints of a card are folded into one entry
(the details show them all). A card's champion is the champion's tag; legends and units are linked by name.

## Settings

`web/settings.js` (commented): default query, default sort, the sort inside champion groups, grid/list, card size,
folding, hiding tokens/runes, domain order. Edit and reload.

## Files

- `sync.py`: fetch, fold printings into cards, link champions, write `web/cards.js`
- `web/icons/`: the game's symbols (domains, might, exhaust, energy, types, rarities, keyword banners) from Piltover
  Archive's CDN; `sync.py` downloads missing ones
- `web/query.js`: query parser, filters, sorting, grouping (no DOM)
- `web/app.js`: rendering, filter bar, card dialog
- `web/sw.js`, `web/manifest.webmanifest`: offline use and installing as an app
- `test/`: the query engine on the real cards, `node --test test/*.test.mjs` (also run before every deploy)
- `web/index.html`, `web/style.css` (Catppuccin Mocha)

## Legal

Riftbound card search isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, Riftbound, League of Legends and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

This is an unofficial fan project, created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games.
