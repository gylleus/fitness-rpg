import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

from authored_sheets import align, extract, prepare, validate
from sprites import sha256


class AuthoredSheetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        image = Image.new("RGBA", (200, 100))
        draw = ImageDraw.Draw(image)
        draw.rectangle((30, 20, 49, 59), fill=(100, 120, 80, 255))
        draw.rectangle((135, 20, 154, 59), fill=(100, 120, 80, 255))
        image.save(self.root / "sheet.png")
        self.source = {"image": "sheet.png", "sha256": sha256(self.root / "sheet.png"),
                       "columns": 2, "rows": 1, "min_area": 10, "mask": {"kind": "alpha", "threshold": 128}}
        self.asset = {"id": "test_enemy", "name": "Test enemy", "facing": "left", "size": 128,
                      "height_scale": 1, "scale_mode": "source", "backend": "test", "layout_note": "test",
                      "sources": {"sheet": self.source}, "actions": {"attack": {"source": "sheet",
                      "indices": [0, 1], "durations_ms": [100, 200], "loop": False}}}

    def test_contacts_and_authored_horizontal_motion_survive(self):
        self.asset["actions"]["attack"]["ground_contacts_y"] = [60, 54]
        data = extract(self.root / "sheet.png", self.source)
        sheet, _, _ = align(self.asset, {"sheet": data})["attack"]
        self.assertEqual(sheet.crop((0, 0, 640, 640)).getbbox(), (310, 520, 330, 560))
        self.assertEqual(sheet.crop((640, 0, 1280, 640)).getbbox(), (315, 526, 335, 566))

    def test_lift_does_not_resize_airborne_pose(self):
        self.asset["actions"]["attack"]["lift"] = [0, 24]
        data = extract(self.root / "sheet.png", self.source)
        sheet, _, _ = align(self.asset, {"sheet": data})["attack"]
        self.assertEqual(sheet.crop((640, 0, 1280, 640)).getbbox(), (315, 496, 335, 536))

    def test_color_key_and_alpha_extract_same_subjects(self):
        image = Image.open(self.root / "sheet.png")
        opaque = Image.new("RGBA", image.size, (139, 155, 180, 255))
        opaque.alpha_composite(image)
        opaque.save(self.root / "key.png")
        key = {**self.source, "sha256": sha256(self.root / "key.png"),
               "mask": {"kind": "color_key", "color": [139, 155, 180], "tolerance": 26}}
        first, second = extract(self.root / "sheet.png", self.source), extract(self.root / "key.png", key)
        self.assertEqual(first["boxes"], second["boxes"])
        for a, b in zip(first["poses"], second["poses"]):
            np.testing.assert_array_equal(np.array(a), np.array(b))

    def test_wrong_pose_count_fails(self):
        with self.assertRaisesRegex(ValueError, "Expected 3 connected poses"):
            extract(self.root / "sheet.png", {**self.source, "columns": 3})

    def test_bottom_overflow_rejected(self):
        self.asset["actions"]["attack"]["ground_contacts_y"] = [0, -100]
        with self.assertRaisesRegex(ValueError, "exceeds shared canvas"):
            align(self.asset, {"sheet": extract(self.root / "sheet.png", self.source)})

    def test_invalid_last_asset_does_not_write_first(self):
        second = copy.deepcopy(self.asset)
        second["id"] = "second"
        second["sources"]["sheet"]["sha256"] = "0" * 64
        recipe = self.root / "recipe.json"
        recipe.write_text(json.dumps({"schema_version": 1, "assets": [self.asset, second]}))
        with patch("authored_sheets.import_sheet") as importer:
            with self.assertRaisesRegex(ValueError, "checksum changed"):
                prepare(recipe, self.root / "out")
            importer.assert_not_called()
        self.assertFalse((self.root / "out").exists())

    def test_invalid_timing_contact_and_identity_rejected(self):
        for field, value in (("durations_ms", [100, 0]), ("ground_contacts_y", [1]), ("loop", "yes"), ("indices", [0, 2])):
            with self.subTest(field=field):
                asset = copy.deepcopy(self.asset)
                asset["actions"]["attack"][field] = value
                with self.assertRaises(ValueError):
                    validate({"schema_version": 1, "assets": [asset]})
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate({"schema_version": 1, "assets": [self.asset, self.asset]})


if __name__ == "__main__":
    unittest.main()
