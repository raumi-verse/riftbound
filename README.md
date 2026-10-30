# riftbound

My own Riftbound card browser: every card in one local file, a search box with a real query language, multi-key sorting
and grouping, in particular **each champion's legend, champion units and signatures together**.

```sh
python3 sync.py            # pull all cards from Piltover Archive into web/cards.js (a few seconds)
python3 sync.py --images   # also keep the card pictures in web/img/ for offline use
xdg-open web/index.html    # the page; nothing runs in the background
```

Hosted at https://rb.raumi.dev/search/; a GitHub Action syncs the cards every Monday (or on "Run workflow").
Card data and pictures come from the unofficial [Piltover Archive](https://piltoverarchive.com) API (Riftcodex lacked
Radiance and the Nexus Night/Worlds printings).

## Searching

Press `/` to focus the search; the `?` button has the full cheat sheet. The query is in the URL, so searches can be bookmarked.

| query | gives |
|---|---|
| `group:champion` | every champion: legend, champion units, signatures, other cards with the tag |
| `champ:jinx` / `champ="lee sin"` | one champion's cards |
| `group:champion has:legend` | only champions that have a legend (`has:` filters groups, `is:` cards) |
| `group:champion has:(t:legend d:fury)` | champions whose legend is Fury |
| `for:jinx group:type` | everything a Jinx deck may play: her domains, neutral cards, her signatures, battlefields, nothing banned |
| `group:champion order:domain,-count` | sort the groups themselves (`sort:` orders the cards inside) |
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
- `tts.py`, `tts/`: the Tabletop Simulator card list, the Lua added to the table, `patch.py`

## Tabletop Simulator

The Workshop table "Riftbound - LGS Table" types every card into a Lua list by hand, so new cards arrive days after a
release, and its EQ, ✦ and Might buttons only work where someone filled in the card's notes. `tts.py` makes that list
from Piltover Archive instead (`tts/cards.json`, served at https://rb.raumi.dev/tts/cards.json, synced weekly):

- every printing, with the table's own picture where it has one and Piltover's otherwise
- EQ on every gear that attaches, with its Might bonus (`mightBonus`); buffs work the same way
- ✦ for the tokens, buffs, Empower and XP a card's text makes
- Might on every unit; legends and champion units know their champion
- "TTS code" ids for new printings (and the table's duplicate ids fixed: `OGN-007-1` is the plain rune again)

```sh
python3 tts/patch.py   # copy of the installed Workshop table that downloads tts/cards.json when it loads
```

Load "Riftbound LGS Table (auto)" under Games → Save & Load. The copy also has a U/G button on gear that turns it into
a unit with Might equal to its Energy (Orianna), and fixes for bugs in the table's scripts (`FIXES` in `patch.py`:
"Reveal 1"/Numpad 4 did nothing, drawing/glimpsing/revealing the last card of a deck failed, recycling a rune renamed the
rune deck to "main", "Toggle Analytics" was ignored). Re-run `patch.py` after the Workshop table updates; `--diff` lists
where the generated notes differ from the table's. Hand fixes go in `tts/overrides.json`.

## Legal

Riftbound card search isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, Riftbound, League of Legends and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

This is an unofficial fan project, created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games.
