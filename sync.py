#!/usr/bin/env python3
"""Pull every Riftbound card from Piltover Archive and write web/cards.js for the browser.

    python3 sync.py            # cards only, images are loaded from Piltover Archive's CDN
    python3 sync.py --images   # also keep every picture in web/img/ for offline use

The game's symbols (domains, might, exhaust, energy, types, rarities, keyword banners) are kept in web/icons/;
only missing ones are downloaded.
"""
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

API = "https://piltoverarchive.com/api/external/v1"
CDN = "https://cdn.piltoverarchive.com"
UA = {"User-Agent": "riftbound-browser/1 (personal card browser)"}
WEB = Path(__file__).resolve().parent / "web"
DOMAINS = {"fury", "calm", "mind", "body", "chaos", "order"}
PROMO_SETS = re.compile(r"-NN$|^(ARC|WRLD\d+|W\d+)$")  # Nexus Nights, box sets, Worlds bundles


def get(path, tries=5):
    for n in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + path, headers=UA), timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if n == tries - 1:
                raise
            print(f"  retry {path}: {e}", file=sys.stderr)
            time.sleep(2 * (n + 1))


def fetch_all():
    variants, page = [], 1
    while True:
        d = get(f"/cards?limit=100&page={page}")
        variants += d["data"]
        if not d["pagination"]["hasNext"]:
            return variants
        page += 1


def rules_text(s):
    """Piltover's [Might] [Tap] [2] [Fury] [REACTION] -> the page's :rb_…: icons and [Reaction] keywords."""
    s = unicodedata.normalize("NFKC", s or "").strip()  # errata headers come in 𝗯𝗼𝗹𝗱 letters

    def token(m):
        t = m.group(1)
        low = t.lower()
        if t.isdigit():
            return f":rb_energy_{t}:"
        if low == "might":
            return ":rb_might:"
        if low == "tap":
            return ":rb_exhaust:"
        if low == "rune":
            return ":rb_rune_rainbow:"
        if low in DOMAINS:
            return f":rb_rune_{low}:"
        if re.fullmatch(r"[A-Za-z][A-Za-z -]*(?: \d+)?", t):  # [REACTION], [deflect], [SHield 2] -> [Reaction]…
            t = t.title()
        return f"[{t}]"

    return re.sub(r"\[([^\]]+)\]", token, s)


def champions(variants):
    """Champions are named by their champion units ("Jinx, Rebel"); a legend's champion is its tag."""
    champs = {v["card"]["name"].split(", ")[0] for v in variants
              if v["card"]["super"] == "Champion" and ", " in v["card"]["name"]}
    for v in variants:
        c = v["card"]
        if c["type"] == "Legend" and c["tags"] and not any(t in champs for t in c["tags"]):
            champs.add(c["tags"][-1])
    return champs


def champion_of(c, champs):
    tags = c["tags"] or []
    prefix = c["name"].split(", ")[0] if ", " in c["name"] else None
    if c["type"] == "Legend":
        return next((t for t in tags if t in champs), prefix)
    if prefix in champs:
        return prefix
    return next((t for t in tags if t in champs), None)


def build(variants, sets):
    set_date = {s["prefix"]: s["releaseDate"][:10] for s in sets}
    champs = champions(variants)

    by_card = defaultdict(list)
    for v in variants:
        by_card[v["card"]["id"]].append(v)

    cards = []
    for prints in by_card.values():
        def rank(v):
            sid = v["set"]["prefix"]
            return (bool(PROMO_SETS.search(sid)) or v["variantType"] == "Promo", v["variantType"] != "Standard",
                    set_date.get(sid, "9999"), v["variantNumber"])

        prints.sort(key=rank)
        base = prints[0]
        c = base["card"]
        tags = c["tags"] or []
        champ = champion_of(c, champs)
        role = None
        if champ:
            role = 0 if c["type"] == "Legend" else 1 if c["super"] == "Champion" else 2 if c["super"] == "Signature" else 3
        text = rules_text(c["description"])
        cards.append({
            "id": base["variantNumber"],
            "name": c["name"],
            "champion": champ,
            "role": role,
            "type": c["type"],
            "supertype": c["super"],
            "domains": [d["name"] for d in c["colors"] or []],
            "energy": c["energy"],
            "might": c["might"],
            "power": c["power"],
            "rarity": base["rarity"],
            "tags": tags,
            "text": text,
            "alltext": "\n".join(filter(None, [text, rules_text(c.get("effect")), rules_text(c.get("attachText"))])),
            "flavour": base["flavorText"],
            "banned": c["banEffectiveDate"],
            "landscape": c["type"] == "Battlefield",
            "printings": [{
                "id": v["variantNumber"],
                "set": v["set"]["prefix"],
                "num": int(m.group(1)) if (m := re.search(r"-(\d+)", v["variantNumber"])) else None,
                "rarity": v["rarity"],
                "kind": "" if v["variantType"] == "Standard" else (v["variantLabel"] or v["variantType"]),
                "alt": v["variantType"] == "Alt Art",
                "overnumbered": v["variantType"].startswith("Overnumbered"),
                "signature": v["variantType"].endswith("Signed"),
                "promo": v["variantType"] == "Promo" or bool(PROMO_SETS.search(v["set"]["prefix"])),
                "artist": v["artist"],
                "img": v["imageUrl"],
            } for v in prints],
        })
    cards.sort(key=lambda c: c["id"])
    sets_out = sorted(({"id": s["prefix"], "name": s["name"], "date": set_date[s["prefix"]]} for s in sets),
                      key=lambda s: (s["date"], s["id"]))
    return cards, sets_out


def download(url, f):
    if f.exists():
        return True
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            data = r.read()
    except Exception as e:
        if getattr(e, "code", None) != 404:  # a keyword without its own numbered banner is expected
            print(f"  {url}: {e}", file=sys.stderr)
        return False
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes(data)
    return True


def save_icons(cards):
    """The symbols into web/icons/; returns {keyword: icon path} for the keyword banners that exist,
    "assault 2" and "assault" separately (the page falls back to the plain banner plus the number)."""
    out = WEB / "icons"
    for name in [*sorted(DOMAINS), "might", "tap", "rune"]:
        download(f"{CDN}/icons/{name}.webp", out / f"{name}.webp")
    download(f"{CDN}/icons/neutral.svg", out / "colorless.svg")
    energies = {int(m) for c in cards for m in re.findall(r":rb_energy_(\d+):", c["alltext"])}
    energies |= {c["energy"] for c in cards if c["energy"] is not None}
    for n in sorted(energies):
        download(f"{CDN}/icons/{n}.svg", out / f"{n}.svg")
    for t in {c["type"] for c in cards}:
        download(f"{CDN}/types/{urllib.parse.quote(t.lower())}.webp", out / f"type-{t.lower().replace(' ', '-')}.webp")
    for r in {p["rarity"] for c in cards for p in c["printings"]}:
        download(f"{CDN}/rarities/{r.lower()}.webp", out / f"rarity-{r.lower()}.webp")
    kws = {}
    for c in cards:
        for m in re.finditer(r"\[([A-Za-z][A-Za-z -]*?)( \d+)?\]", c["alltext"]):
            for k in filter(None, [m.group(1) + (m.group(2) or ""), m.group(1)]):
                k = k.lower()
                if k in kws:
                    continue
                f = out / "kw" / (re.sub(r"\W+", "-", k) + ".svg")
                remote = "Reaction" if k == "reaction" else urllib.parse.quote(k.upper())
                kws[k] = f"icons/kw/{f.name}" if download(f"{CDN}/description_keywords/{remote}.svg", f) else None
    return {k: v for k, v in sorted(kws.items()) if v}


def save_images(cards):
    out = WEB / "img"
    out.mkdir(exist_ok=True)
    for c in cards:
        for p in c["printings"]:
            if not p["img"]:
                continue
            f = out / (re.sub(r"[^\w.-]", "_", p["id"]) + Path(p["img"]).suffix)
            if not f.exists():
                try:
                    with urllib.request.urlopen(urllib.request.Request(p["img"], headers=UA), timeout=30) as r:
                        f.write_bytes(r.read())
                except Exception as e:
                    print(f"  image {p['id']}: {e}", file=sys.stderr)
                    continue
            p["img"] = "img/" + f.name


def main():
    print("fetching sets and cards from Piltover Archive…", file=sys.stderr)
    sets = get("/sets")["data"]
    variants = fetch_all()
    cards, sets = build(variants, sets)
    keywords = save_icons(cards)
    if "--images" in sys.argv:
        print("saving images…", file=sys.stderr)
        save_images(cards)
    out = WEB / "cards.js"
    if out.exists():  # same cards as last time: leave the file (and its date) alone, so git sees no change
        old = json.loads(out.read_text().removeprefix("window.DATA = ").rstrip().rstrip(";"))
        if old["cards"] == cards and old["sets"] == sets and old.get("keywords") == keywords:
            print(f"{len(variants)} printings, no changes", file=sys.stderr)
            return
    data = {"synced": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sets": sets, "keywords": keywords, "cards": cards}
    out.write_text("window.DATA = " + json.dumps(data, ensure_ascii=False) + ";\n")
    champs = {c["champion"] for c in cards if c["champion"]}
    print(f"{len(variants)} printings -> {len(cards)} cards, {len(champs)} champions -> web/cards.js", file=sys.stderr)


if __name__ == "__main__":
    main()
