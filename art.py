#!/usr/bin/env python3
"""Writes web/art.js: a tiny colour picture (16 x 12) of every printing's art, which the scan compares the camera with.

    pip install pillow numpy; python3 art.py [folder with card pictures]

Only printings not in web/art.js yet are downloaded. Run by the weekly sync after sync.py; the scan works without
newer cards in it (it then reads their number).
"""
import base64
import io
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

WEB = Path(__file__).resolve().parent / "web"
W, H = 16, 12
BOX = (0.08, 0.10, 0.92, 0.52)  # of the card, left top right bottom; the same as ART in scan.js
SAME = 0.97  # printings with the same picture (promos, foils): told apart by their number


def cards():
    t = (WEB / "cards.js").read_text()
    return json.JSONDecoder().raw_decode(t[t.index("{", t.index("window.DATA")):])[0]["cards"]


def old():
    try:
        t = (WEB / "art.js").read_text()
        d = json.loads(t[t.index("{"):t.rindex("}") + 1])
        px = np.frombuffer(base64.b64decode(d["px"]), np.uint8).reshape(-1, W * H * 3)
        return dict(zip(d["ids"], px)) if (d["w"], d["h"]) == (W, H) else {}
    except (OSError, ValueError, KeyError):
        return {}


def tiny(data):
    im = Image.open(io.BytesIO(data)).convert("RGB")
    x0, y0, x1, y1 = BOX
    return np.asarray(im.resize((W, H), Image.BOX, box=(x0 * im.width, y0 * im.height, x1 * im.width, y1 * im.height))).reshape(-1)


def load(url, folder):
    name = url.rsplit("/", 1)[1]
    if folder:
        for f in (folder / name, folder / name.replace("*", "_st")):
            if f.exists():
                return f.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (riftbound card browser)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    have, prints = old(), [p for c in cards() for p in c["printings"] if p.get("img") and p["img"].startswith("http")]

    def one(p):
        try:
            return p["id"], have[p["id"]] if p["id"] in have else tiny(load(p["img"], folder))
        except Exception as e:  # one missing picture must not stop the rest
            print(p["id"], e, file=sys.stderr)
            return p["id"], None

    with ThreadPoolExecutor(4) as ex:
        got = {i: v for i, v in ex.map(one, prints) if v is not None}
    ids = sorted(got)
    px = np.stack([got[i] for i in ids])
    z = px.astype(np.float32)
    z -= z.mean(1, keepdims=True)
    z /= np.maximum(np.linalg.norm(z, axis=1, keepdims=True), 1e-6)
    group = [int(np.argmax(row > SAME)) for row in z @ z.T]
    for i in range(len(group)):  # the group of my first look-alike
        group[i] = group[group[i]]
    out = {"w": W, "h": H, "ids": ids, "group": group, "px": base64.b64encode(px.tobytes()).decode()}
    (WEB / "art.js").write_text("// made by art.py\nwindow.ART_INDEX = " + json.dumps(out, separators=(",", ":")) + ";\n")
    print(f"{len(ids)} pictures, {len(set(group))} different, {len(ids) - sum(i in have for i in ids)} new")


if __name__ == "__main__":
    main()
