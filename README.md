# riftbound

My own Riftbound card browser: every card in one local file, a search box with a real query language, multi-key sorting
and grouping, in particular **each champion's legend, champion units and signatures together**. Around it: your
[collection](#collection) (scan cards with the phone), your [decks and games](#decks-and-games) with a points counter and
notes, synced between your devices and the [Tabletop Simulator table](#tabletop-simulator).

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
| `t:unit e:2..4 m>=4` | ranges: energy 2 to 4 |
| `id:ogn-270..280` / `id=OGN-007a` | printings by id: a range (with alt arts and variants), or one exactly |
| `r:showcase` | each card with a showcase printing, shown as that printing |
| `show:printings is:alt` | every alternate-art printing |

Click a card for its details: ←/→ step through the results, the champion's other cards are below. Hovering a
keyword shows its reminder text.

By default reprints, alternate arts, overnumbered, signature and metal prints of a card are folded into one entry
(the details show them all). A query is judged per printing, and the entry shows the first printing that matched.

**Export** (in the header) copies the results as names, as printing ids, or as a link that brings back exactly
this list (`id=OGN-275|SFD-207 …`), or downloads them as a CSV. A card's champion is the champion's tag; legends and units are linked by name.

## Goldfish

`goldfish.html` (the **Goldfish** link in the header, rb.raumi.dev/search/goldfish.html): paste a deck (a Piltover deck
code, or `2 Name` lines with or without `Legend:` `Champion:` `MainDeck:` `Battlefields:` `Runes:` headers) and it plays
the deck alone 20 000 times, no opponent and **no card text**. It shows per turn:

- runes on the board, cost paid, how often all runes got used, nothing could be played, or a card had enough runes but
  not of its domain ("wrong domains"), and how often both domains are out
- per card, how often it can be played on each turn (hover: how often it's in hand, how often it was played)
- every split of the rune deck between the legend's two domains, best first, against yours

The deck is checked against the deck building rules first (40 cards with the champion, 3 copies, 3 signatures, 12 runes,
3 battlefields, the legend's domains) and kept in the URL, so a run can be bookmarked or shared.

Modelled: opening hand 4, mulligan (set aside up to 2 cards costing more than 3, draw as many, recycle them), 2 runes a
turn (+1 on the first turn going second), draw 1, the chosen champion playable from its zone, energy by exhausting a
rune, power by recycling a rune of the card's domain (it leaves the board). Each turn it plays the dearest cards it can
pay for. Not modelled: anything a card's text does (draw, ramp, cost changes), and which domain each power symbol of a
two-domain card needs (any of its domains pays). The numbers are in `web/settings.js` under `goldfish`; two rules there
aren't confirmed yet: whether the first player draws on turn 1, and whether one rune may be exhausted and then recycled
in the same turn.

## Collection

On the search page, **Collection** shows every printing on its own with − count + (on the tile, in the list, and per printing
in the card dialog); the ones you don't have are dimmed. Hover a card and press `+` or `−`. The search knows your collection:
`own>=3` (copies in any printing), `own:0`, `ownp>=1 is:alt` (the alt arts you have), `is:owned`, `is:missing`, `sort:-own`, and
the CSV export has an `own` column.

- **Scan**: on a phone, hold cards into the frame one after another. It reads the collector line (`OGN • 030a/298`: the
  set comes from the set's size, the letters read badly) and compares the card's art with the printing's picture, so a misread
  number doesn't add a wrong card; without a readable number the name is read and the art picks the printing. Each card
  beeps into a list you can check (printing, count) before **Add all**. A card counts again after the frame was empty.
  Light, a photo instead of the camera, and typing the number are there too. Text recognition is
  [Tesseract.js](https://github.com/naptha/tesseract.js), loaded the first time you scan and kept for offline use.
  `scanDebug: true` in `web/settings.js` shows what each frame read.
- **Quick entry**: `ogn 42`, `OGN-042a x2`, `3x sfd 7`, `sfd r01 -1`, then a number alone for the same set.
- **Paste list…**: quick entries, printing ids, `3 Name` lines, a CSV with an `id` and an `own`/`count` column (this page's
  export), or a deck code; add to what you have or set the counts, with a preview.

## Decks and games

`decks.html`: your decks, **pinned** ones (your main decks) on top, **archived** ones folded away with their games kept. A deck
takes a deck code or a list; saving a changed list makes a new version, and each version shows what changed and its record.
Per deck: the list with what you're missing, notes, tags, the record going first/second, by version and by opposing legend,
and its games (filter by version, opponent, first/second, tag). Copy the deck code (for Piltover Archive or the table) or the
list, or goldfish it.

`play.html` counts a game: both sides' points split into **conquer**, **hold** and **extra**, turns, undo, best of 1 or 3, the
opponent's half turned to face them (⇅) if the phone lies between you; the screen stays on. At 8 (`playTarget`) it asks for
the result, tags and notes and saves the game to the deck's current version. A game played elsewhere can be logged by hand.

## Sync

Everything above works in the browser alone. Logged in (the button in the header), the collection, decks and games sync
between your devices: phone, PC, and the Tabletop Simulator table. Each edit is saved locally first and sent when there's a
connection; the newest edit of a record wins.

The server is `server.py` (standard library and SQLite only), for you and a few friends, each with their own records:

```sh
python3 server.py --db rb.sqlite adduser NAME     # asks for a password; there is no sign-up
python3 server.py --db rb.sqlite serve --port 8080 [--proxy]
```

The page talks to `syncServer` in `web/settings.js` (https://rb-api.raumi.dev), or the one typed in the login dialog. CORS
allows `RB_ORIGINS` (default https://rb.raumi.dev), localhost and pages opened from disk.

## Tabletop Simulator

The [table](https://github.com/raumi-verse/riftbound-tts) loads your decks and saves your games. In the account dialog
make a token, then in the game's chat: `rb login <token>` once, `rb decks` to list your decks, `rb deck 2` (or a name) to
spawn one at your seat. The points counters get Conquer / Hold / Extra buttons; when someone reaches 8 the game is saved for
every seated player who logged in, with the opponent's list. It shows up on the deck's page marked "write notes".

## Settings

`web/settings.js` (commented): the goldfish rules (`goldfish`), default query, default sort, the sort inside champion groups, grid/list, card size,
folding, hiding tokens/runes, domain order, the sync server, the points to win, scan debugging. Edit and reload.

## Files

- `sync.py`: fetch, fold printings into cards, link champions, write `web/cards.js`
- `server.py`: the sync server (accounts, records, the table's endpoints)
- `web/icons/`: the game's symbols (domains, might, exhaust, energy, types, rarities, keyword banners) from Piltover
  Archive's CDN; `sync.py` downloads missing ones
- `web/query.js`: query parser, filters, sorting, grouping (no DOM)
- `web/deck.js`: reading decks (lists, Piltover deck codes), writing deck codes, the deck building rules (no DOM)
- `web/sim.js`: the goldfish simulator (no DOM); `web/goldfish.html`, `web/goldfish.js`: its page
- `web/store.js`, `web/sync.js`: the records in the browser and their sync; `web/account.js`: the account button
- `web/collection.js`: collection counts, quick entry, pasted lists; `web/scan.js`: scanning
- `web/library.js`: decks, versions, games, records, the game being played (no DOM); `web/ui.js`: the match dialog
- `web/decks.html`, `web/decks.js`, `web/play.html`, `web/play.js`: the Decks and Play pages
- `web/app.js`: rendering, filter bar, card dialog, collection mode
- `web/sw.js`, `web/manifest.webmanifest`: offline use and installing as an app
- `test/`: the page's code on the real cards, `node --test test/*.test.mjs`, and the server, `python3 -m unittest discover test`
  (both run before every deploy)
- `web/index.html`, `web/style.css` (Catppuccin Mocha)

## Legal

Riftbound card search isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, Riftbound, League of Legends and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

This is an unofficial fan project, created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games.
