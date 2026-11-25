"""What sync.py reads out of the card texts: python3 -m unittest discover test"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sync  # noqa: E402


class Errata(unittest.TestCase):
    def test_header(self):
        self.assertEqual(sync.errata_of("Card Errata Text – From Origins Card Errata:\n[ACTION] Deal 3."), ("Origins Card Errata", "[ACTION] Deal 3."))
        self.assertEqual(sync.errata_of("𝗖𝗮𝗿𝗱 𝗘𝗿𝗿𝗮𝘁𝗮 𝗧𝗲𝘅𝘁 – 𝗙𝗿𝗼𝗺 𝗥𝗶𝗼𝘁 𝗙𝗔𝗤 𝗮𝗻𝗱 𝗥𝘂𝗹𝗲𝘀 𝗨𝗽𝗱𝗮𝘁𝗲\nDeal 3."), ("Riot FAQ and Rules Update", "Deal 3."))

    def test_plain(self):
        self.assertEqual(sync.errata_of("Deal 3 to a unit."), (None, "Deal 3 to a unit."))
        self.assertEqual(sync.errata_of(None), (None, ""))

    def test_foil(self):
        def v(i, mode):
            return {"variantNumber": i, "rarity": "Rare", "variantType": "Standard", "variantLabel": "Standard", "artist": "", "imageUrl": "", "flavorText": None, "foilMode": mode,
                    "set": {"prefix": "OGN"}, "card": {"id": i, "name": i, "type": "Unit", "super": None, "tags": None, "colors": [], "energy": 1, "might": 1, "power": 0,
                                                       "description": "", "banEffectiveDate": None}}
        cards, _ = sync.build([v("OGN-001", "foil_only"), v("OGN-002", "nonfoil_only"), v("OGN-003", "both"), v("OGN-004", None)], [{"prefix": "OGN", "name": "Origins", "releaseDate": "2025-10-31"}])
        self.assertEqual([c["printings"][0].get("foil") for c in cards], ["only", "no", None, None])


if __name__ == "__main__":
    unittest.main()
