#!/usr/bin/env python3
"""Card data for the Tabletop Simulator table "Riftbound - LGS Table": writes tts/cards.json, which the table
patched by tts/patch.py downloads every time it loads. The weekly Action runs this after sync.py.

    python3 tts.py

What the table's buttons need is derived from Piltover Archive's data instead of being typed in:
  might         unit Might (± buttons; also what makes a card a target for gear)
  might_delta   gear that attaches ([Equip], [Quick-Draw], a Might bonus): the EQ button, adds the bonus to the unit
  energy        gear's cost, for the "make unit" button (Orianna: a gear becomes a unit with Might = Energy)
  spawn         tokens, buffs, Empower and XP the card makes: the ✦ button
  signature_key the champion, on legends and champion units (the importer puts the chosen champion aside with it)
Hand fixes go in tts/overrides.json. tts/ids.json maps "TTS code" ids (OGN-007-1) to cards; new printings get the
next free number and keep it.
"""
import json
import re
import sys
import unicodedata
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from sync import UA, champion_of, champions, fetch_all

OUT = Path(__file__).resolve().parent / "tts"
AMPHI = "https://raw.githubusercontent.com/AmphiBlocks/Riftbound-TTS/main/riftbound_jpg/"
AMPHI_TREE = "https://api.github.com/repos/AmphiBlocks/Riftbound-TTS/git/trees/main?recursive=1"
DOMAIN_ORDER = ["fury", "calm", "mind", "body", "chaos", "order"]  # the table writes pairs as "fury,body"
RARITY = {"Common": 1, "Uncommon": 2, "Rare": 3, "Epic": 4, "Showcase": 5}
# Counters the table keeps as its own pieces, under these names
COUNTERS = [(r"(?i)\bempower", "Empower"), (r"(?i)\bbuff", "Buff"), (r"\bXP\b", "XP Tracker")]
TOKEN = re.compile(r"([A-Z][\w'’]*(?: [A-Z][\w'’]*)*) (?i:(?:unit |gear |battlefield )?tokens?)\b")
EQUIP = re.compile(r"\[Equip\]|\[Quick-Draw\]|attach (this|me) to", re.I)


def slug(v):
    return v["variantNumber"].replace("*", "s")  # the table writes signed printings as OGN-299s


def text(c):
    return unicodedata.normalize("NFKC", "\n".join(filter(None, [c["description"], c["effect"], c["attachText"]]))).strip()


def card_type(c):
    t, sup = c["type"], c["super"]
    if t == "Battlefield":
        return "battlefield"  # also Baron Pit and Brush: they are placed and imprinted like battlefields
    if sup == "Token":
        return "token"
    if t == "Legend":
        return "legend"
    if sup == "Champion" and t == "Unit":
        return "champion"
    if sup == "Signature":
        return "signature " + t.lower()
    return "unit" if "Unit" in (c["types"] or [t]) else t.lower()


def spawns(c, token_slugs):
    t = text(c)
    out = [name for pat, name in COUNTERS if re.search(pat, t) and not c["name"].startswith(name)]
    for m in TOKEN.finditer(t):
        s = token_slugs.get(m.group(1))
        if s and c["name"] != m.group(1):
            out.append(s)
    return ";".join(dict.fromkeys(out))


def notes(v, champs, token_slugs):
    c = v["card"]
    n = {
        "slug": slug(v),
        "color_identity": ",".join(sorted((d["name"].lower() for d in c["colors"] or []), key=DOMAIN_ORDER.index)) or "grey",
        "type": card_type(c),
        "rarity": RARITY.get(v["rarity"], 0),
        "isSignature": c["super"] == "Signature",
        "set": v["set"]["name"],
    }
    types = c["types"] or [c["type"]]
    if "Unit" in types or c["type"] == "Unit Gear":
        n["might"] = str(c["might"] or 0)
    if "Gear" in types:
        n["energy"] = str(c["energy"] or 0)
        if c["mightBonus"] or EQUIP.search(text(c)):
            n["might_delta"] = str(c["mightBonus"] or 0)
    if c["super"] == "Token" and c["name"] == "Buff":
        n["might_delta"] = "1"  # a buff sits on a unit like gear
    if c["type"] == "Legend" or (c["super"] == "Champion" and c["type"] == "Unit"):
        if champ := champion_of(c, champs):
            n["signature_key"] = champ
    if s := spawns(c, token_slugs):
        n["spawn"] = s
    return n


def amphi_images():
    """The table's own pictures (JPG). Piltover's WebP is only used for printings the table doesn't have yet."""
    with urllib.request.urlopen(urllib.request.Request(AMPHI_TREE, headers=UA), timeout=60) as r:
        tree = json.load(r)["tree"]
    return {Path(t["path"]).stem for t in tree if t["path"].startswith("riftbound_jpg/") and t["path"].endswith(".jpg")}


def assign_ids(variants, ids):
    """Give every printing a TTS code: <first printing>-<n>. Existing numbers never change."""
    taken = set(ids.values())
    by_card = defaultdict(list)
    for v in variants:
        by_card[v["card"]["id"]].append(v)
    for prints in by_card.values():
        prints.sort(key=lambda v: (v["variantType"] != "Standard", v["releaseDate"] or "9999", v["variantNumber"]))
        slugs = [slug(v) for v in prints]
        base = next((k.rsplit("-", 1)[0] for k, s in ids.items() if s in slugs), slugs[0])
        n = max((int(k.rsplit("-", 1)[1]) for k in ids if k.rsplit("-", 1)[0] == base), default=0)
        for s in slugs:
            if s not in taken:
                n += 1
                ids[f"{base}-{n}"] = s
                taken.add(s)
    return dict(sorted(ids.items()))


def build(variants, have_jpg, ids, overrides):
    champs = champions(variants)
    token_slugs = {}
    for v in sorted(variants, key=lambda v: v["variantNumber"]):
        c = v["card"]
        if c["super"] == "Token":
            token_slugs.setdefault(re.sub(r" v\d+$", "", c["name"]), slug(v))
    token_slugs["Recruit"] = "OGN-273"  # the plain Recruit art, as the table uses it

    cards = {}
    for v in variants:
        s = slug(v)
        c = v["card"]
        cards[s] = {
            "name": re.sub(r" v\d+$", "", c["name"]),  # "Recruit v2" is a second Recruit art
            "description": text(c),
            "image": AMPHI + s + ".jpg" if s in have_jpg else v["imageUrl"],
            "notes": notes(v, champs, token_slugs),
        }
    for s, fix in overrides.items():
        if s.startswith("_") or s not in cards:
            continue
        cards[s]["notes"].update(fix.pop("notes", {}))
        cards[s].update(fix)
    return dict(sorted(cards.items()))


def main():
    print("fetching cards from Piltover Archive…", file=sys.stderr)
    variants = fetch_all()
    have_jpg = amphi_images()
    ids = assign_ids(variants, json.loads((OUT / "ids.json").read_text()))
    (OUT / "ids.json").write_text(json.dumps(ids, indent=0) + "\n")
    cards = build(variants, have_jpg, ids, json.loads((OUT / "overrides.json").read_text()))

    out = OUT / "cards.json"
    if out.exists():
        old = json.loads(out.read_text())
        if old["cards"] == cards and old["ids"] == ids:
            print(f"{len(cards)} printings, no changes", file=sys.stderr)
            return
    data = {"synced": datetime.now(timezone.utc).isoformat(timespec="seconds"), "cards": cards, "ids": ids}
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    webp = sum(not c["image"].startswith(AMPHI) for c in cards.values())
    print(f"{len(cards)} printings ({webp} with Piltover pictures), {len(ids)} TTS codes -> tts/cards.json", file=sys.stderr)


if __name__ == "__main__":
    main()
