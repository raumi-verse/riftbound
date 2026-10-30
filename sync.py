#!/usr/bin/env python3
"""Pull every Riftbound card from Riftcodex and write web/cards.js for the browser.

    python3 sync.py            # cards only, images are loaded from Riot's CDN
    python3 sync.py --images   # also keep every picture in web/img/ for offline use
"""
import html
import json
import re
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.riftcodex.com"
WEB = Path(__file__).resolve().parent / "web"
UA = {"User-Agent": "riftbound-browser/1 (personal card browser)"}  # the API refuses urllib's default agent
PROMO_SETS = {"OPP", "PR", "JDG"}
# printing kinds the API appends to the name, e.g. "Jinx - Rebel (Alternate Art)"
KIND = re.compile(r"\s*\((Alternate Art|Overnumbered|Signature|Metal|Starter|Ultimate|Launch Exclusive|GG EZ)\)$")


def get(path, tries=5):
    for n in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + path, headers=UA), timeout=30) as r:
                return json.load(r)
        except Exception as e:  # the API sometimes hangs on a page; just ask again
            if n == tries - 1:
                raise
            print(f"  retry {path}: {e}", file=sys.stderr)
            time.sleep(2 * (n + 1))


def fetch_all():
    items, page, pages = [], 1, 1
    while page <= pages:
        d = get(f"/cards?size=100&page={page}")
        items += d["items"]
        pages = d["pages"]
        print(f"  page {page}/{pages}", file=sys.stderr)
        page += 1
    return items


def rules_text(t):
    """Rich text -> plain text with line breaks; icons stay as :rb_…: tokens for the page."""
    s = t.get("rich") or t.get("plain") or ""
    s = re.sub(r"<br\s*/?>|</p>\s*<p>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()


def build(items, sets):
    set_date = {s["set_id"]: s["published_on"][:10] for s in sets}
    set_name = {s["set_id"]: s["name"] for s in sets}

    # Champions are named by their champion units: "Jinx - Rebel", or "Jinx, Demolitionist" in Vendetta.
    # Legends are less reliable ("Yordle, Kennen - Heart of the Tempest", Vendetta's "Butcher of the
    # Sands"), so a legend's champion is its tag, and its name is only a fallback.
    def split(title):
        m = re.match(r"(.+?) - (.+)", title) or re.match(r"([^,]+), (.+)", title)
        return (m.group(1), m.group(2)) if m else (None, title)

    champs = set()
    for i in items:
        if i["classification"]["supertype"] == "Champion" and i["classification"]["type"] == "Unit":
            champs.add(split(KIND.sub("", i["name"]))[0] or i["tags"][0])
    for i in items:
        c = i["classification"]
        if c["type"] == "Legend" and not any(t in champs for t in i["tags"]):
            champs.add(split(KIND.sub("", i["name"]))[0] or i["tags"][-1])

    groups = defaultdict(list)
    for i in items:
        c = i["classification"]
        title = KIND.sub("", i["name"]).strip()
        prefix, rest = split(title)
        if c["type"] == "Legend":
            champ = next((t for t in i["tags"] if t in champs), prefix)
            title = f"{champ} - {rest.rsplit(' - ', 1)[-1]}"
        elif prefix in champs:
            champ = prefix
            title = f"{prefix} - {rest}"
        else:
            champ = next((t for t in i["tags"] if t in champs), None)
        groups[(title, c["type"])].append((i, champ))

    cards = []
    for (title, typ), prints in groups.items():
        def rank(p):
            i = p[0]
            sid = i["set"]["set_id"]
            meta = i["metadata"]
            fancy = meta["alternate_art"] or meta["overnumbered"] or meta["signature"] or KIND.search(i["name"])
            return (sid in PROMO_SETS, bool(fancy), set_date.get(sid, "9999"), i["collector_number"] or 0)

        prints.sort(key=rank)
        base, champ = prints[0]
        c = base["classification"]
        role = None
        if champ:
            role = 0 if typ == "Legend" else 1 if c["supertype"] == "Champion" else 2 if c["supertype"] == "Signature" else 3
        texts = {rules_text(p["text"]) for p, _ in prints}
        cards.append({
            "id": base["riftbound_id"],
            "name": title,
            "champion": champ,
            "role": role,
            "type": typ,
            "supertype": c["supertype"],
            "domains": c["domain"] or [],
            "energy": base["attributes"]["energy"],
            "might": base["attributes"]["might"],
            "power": base["attributes"]["power"],
            "rarity": c["rarity"],
            "tags": base["tags"],
            "text": rules_text(base["text"]),
            "alltext": "\n".join(sorted(texts)),  # reprints differ in reminder text; search all of them
            "flavour": base["text"].get("flavour"),
            "landscape": base.get("orientation") == "landscape",
            "printings": [{
                "id": p["riftbound_id"],
                "set": p["set"]["set_id"],
                "num": p["collector_number"],
                "rarity": p["classification"]["rarity"],
                "kind": (KIND.search(p["name"]) or [None, ""])[1],
                "alt": p["metadata"]["alternate_art"],
                "overnumbered": p["metadata"]["overnumbered"],
                "signature": p["metadata"]["signature"],
                "promo": p["set"]["set_id"] in PROMO_SETS,
                "artist": p["media"].get("artist"),
                "img": p["media"].get("image_url"),
            } for p, _ in prints],
        })
    sets_out = sorted(({"id": k, "name": v, "date": set_date[k]} for k, v in set_name.items()), key=lambda s: s["date"])
    return cards, sets_out


def save_images(cards):
    out = WEB / "img"
    out.mkdir(exist_ok=True)
    for c in cards:
        for p in c["printings"]:
            if not p["img"]:
                continue
            f = out / (re.sub(r"[^\w.-]", "_", p["id"]) + ".png")
            if not f.exists():
                try:
                    with urllib.request.urlopen(urllib.request.Request(p["img"], headers=UA), timeout=30) as r:
                        f.write_bytes(r.read())
                except Exception as e:
                    print(f"  image {p['id']}: {e}", file=sys.stderr)
                    continue
            p["img"] = "img/" + f.name


def main():
    print("fetching sets and cards from Riftcodex…", file=sys.stderr)
    sets = get("/sets?size=50")["items"]
    items = fetch_all()
    cards, sets = build(items, sets)
    if "--images" in sys.argv:
        print("saving images…", file=sys.stderr)
        save_images(cards)
    data = {"synced": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sets": sets, "cards": cards}
    (WEB / "cards.js").write_text("window.DATA = " + json.dumps(data, ensure_ascii=False) + ";\n")
    champs = {c["champion"] for c in cards if c["champion"]}
    print(f"{len(items)} printings -> {len(cards)} cards, {len(champs)} champions -> web/cards.js", file=sys.stderr)


if __name__ == "__main__":
    main()
