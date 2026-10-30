#!/usr/bin/env python3
"""Make a local copy of the Workshop table "Riftbound - LGS Table" that keeps its cards current.

    python3 tts/patch.py          # writes Saves/Riftbound LGS Table (auto).json; load that in TTS (Games > Save & Load)
    python3 tts/patch.py --diff   # also list where tts/cards.json disagrees with the table's own card notes

Run it again after the Workshop table updates (subscribe and launch it once so TTS downloads the new version).
Changes made to the copy:
  - the card library downloads tts/cards.json on load (tts/loader.lua)
  - gear gets a U/G button that turns it into a unit with Might = Energy (tts/menu.lua, tts/menu_fn.lua)
  - bug fixes in the table's scripts (FIXES below)
"""
import json
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
TTS = Path.home() / ".local/share/Tabletop Simulator"
WORKSHOP = TTS / "Mods/Workshop/3606647746.json"
OUT = TTS / "Saves/Riftbound LGS Table (auto).json"
LIBRARY, MENU = "Riftbound_CardLibrary", "Riftbound Card Menu"
MENU_ANCHOR = "\tupdateCardUI(obj)\nend\n\nfunction createButtons"


# Bug fixes in the table's own scripts: (object, old text, new text, times it must occur). Global is the table script.
FIXES = [
    # "Reveal 1" (button and Numpad 4) called a function that doesn't exist
    ("Global", "hotkey_table =\n{",
     "function revealRandomMemoryCard(player, value, index)\n  revealQuickAction(player)\nend\n\nhotkey_table =\n{", 1),
    # The last card of a deck is a Card, not a Deck: drawing it errored, glimpse/reveal couldn't take it
    ("Global", "    local deckObjs = mainDeck.getObjects()\n    if #deckObjs == 0 then",
     "    local deckObjs = mainDeck.tag == \"Deck\" and mainDeck.getObjects() or {mainDeck}\n    if #deckObjs == 0 then", 1),
    ("Global", "function glimpseQuickAction(player, value, index)",
     "function takeTopCard(deck, params)\n  if deck.tag ~= \"Card\" then return deck.takeObject(params) end\n"
     "  deck.setPosition(params.position)\n  if params.rotation then deck.setRotation(params.rotation) end\n  return deck\nend\n\n"
     "function glimpseQuickAction(player, value, index)", 1),
    ("Global", "  local card = deck.takeObject({", "  local card = takeTopCard(deck, {", 2),
    # "Toggle Analytics" only printed; reports were sent either way
    ("Global", 'if version=="dev" then return end', 'if version=="dev" or not enableAnalytics then return end', 1),
    # Recycling a rune renamed and cached the rune deck as the main deck
    ("Global", 'local newDeck = findPlayerDeckByName(player_color, "main")',
     "local newDeck = findPlayerDeckByName(player_color, deck_name)", 1),
    ("Global", '                              if not name:lower():find("main") then\n'
               '                                  newDeck.setName(name .. "main")\n'
               '                              end\n'
               '                              cacheDeckGuid(player_color, "main", newDeck)',
     '                              if not name:lower():find(deck_name) then\n'
     '                                  newDeck.setName(name .. deck_name)\n'
     '                              end\n'
     '                              cacheDeckGuid(player_color, deck_name, newDeck)', 1),
    # Missing marker: checked for nil only after using it
    ("Global", "  local markerPos = marker.getPosition()\n  if not marker then return end", "  if not marker then return end", 1),
    # Leftover names from the Grand Archive table this was built from: cards with types got no card back
    ("Global", "sleeve = material_sleeves", 'sleeve = sleeve_mapping["legends"]', 1),
    ("Global", "sleeve = main_sleeves", 'sleeve = sleeve_mapping["main"]', 1),
]


def objects(objs):
    for o in objs:
        yield o
        yield from objects(o.get("ContainedObjects", []))


def find(save, nickname):
    found = [o for o in objects(save["ObjectStates"]) if o.get("Nickname") == nickname and o.get("LuaScript")]
    if len(found) != 1:
        sys.exit(f"{nickname}: expected one scripted object, found {len(found)}; the table changed, patch.py needs a look")
    return found[0]


def diff(library_lua):
    old = {s: json.loads(g) for s, g in re.findall(r'^\["([^"]+)"\] = \{name=.*?gmNotes = \[\[(.*?)\]\]\}', library_lua, re.M)}
    new = json.loads((HERE / "cards.json").read_text())["cards"]
    out = defaultdict(list)
    for s, card in new.items():
        if s not in old:
            out["(new printing)"].append(f"{s} {card['name']}")
            continue
        for k, v in card["notes"].items():
            if str(old[s].get(k)) != str(v):
                out[k].append(f"{s} {card['name']}: {old[s].get(k)!r} -> {v!r}")
    for k, lines in sorted(out.items()):
        print(f"\n== {k}: {len(lines)}")
        print("\n".join("  " + l for l in lines))


def main():
    save = json.loads(WORKSHOP.read_text())
    lib, menu = find(save, LIBRARY), find(save, MENU)
    if MENU_ANCHOR not in menu["LuaScript"]:
        sys.exit(f"{MENU}: refreshButtons changed, patch.py needs a look")
    if "--diff" in sys.argv:
        diff(lib["LuaScript"])

    for name, old, new, times in FIXES:
        obj = save if name == "Global" else find(save, name)
        obj["LuaScript"] = obj["LuaScript"].replace("\r\n", "\n")  # the scripts mix line endings
        if obj["LuaScript"].count(old) != times:
            sys.exit(f"{name}: fix no longer applies (fixed upstream or changed?), patch.py needs a look:\n{old}")
        obj["LuaScript"] = obj["LuaScript"].replace(old, new)

    lib["LuaScript"] += (HERE / "loader.lua").read_text()
    menu["LuaScript"] = menu["LuaScript"].replace(MENU_ANCHOR, (HERE / "menu.lua").read_text() + MENU_ANCHOR, 1)
    menu["LuaScript"] += (HERE / "menu_fn.lua").read_text()
    upstream = f"{save.get('SaveName')} of {save.get('Date')}"
    save["SaveName"] = "Riftbound LGS Table (auto)"
    save["Date"] = datetime.now().strftime("%m/%d/%Y %I:%M:%S %p")
    OUT.write_text(json.dumps(save, indent=2, ensure_ascii=False))
    shutil.copy(WORKSHOP.with_suffix(".png"), OUT.with_suffix(".png"))
    print(f"patched {upstream} -> {OUT}")


if __name__ == "__main__":
    main()
