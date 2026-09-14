import unittest
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

import numpy as np
from PIL import Image

from bundle_scenery import bundle, pack_rectangles, sha, trim_prop


class SceneryAtlasTests(unittest.TestCase):
    def test_inline_definitions_pack_a_new_biome_without_canonical_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pixels = np.zeros((32, 64, 4), dtype=np.uint8)
            pixels[5:27, 5:27] = [90, 80, 60, 255]
            pixels[9:27, 37:59] = [60, 80, 90, 255]
            Image.fromarray(pixels).save(root / "sheet.png")
            (root / "prompt.txt").write_text("two isolated props")
            definitions = [{"id": key, "name": key, "generation": {"anchor": "ground", "height_scale": .5}} for key in ("one", "two")]
            recipe = {"biome_id": "new_biome", "definitions": definitions, "alpha_threshold": 128,
                "max_prop_edge": 64, "atlas_width": 128, "padding": 2, "sheets": [{"image": "sheet.png",
                    "sha256": sha((root / "sheet.png").read_bytes()), "prompt_file": "prompt.txt",
                    "columns": 2, "rows": 1, "props": ["one", "two"]}]}
            (root / "recipe.json").write_text(json.dumps(recipe))
            with patch("bundle_scenery.ROOT", root):
                result = bundle("new_biome", root, root / "out")
            self.assertEqual(set(result["props"]), {"one", "two"})
            self.assertEqual(result["props"]["one"]["anchor"], [11, 22])
            self.assertEqual(result["props"]["two"]["anchor"], [11, 18])

    def test_padding_and_detached_pixel_cannot_lower_the_ground_anchor(self):
        pixels = np.zeros((40, 40, 4), dtype=np.uint8)
        pixels[7:21, 12:28] = [92, 100, 77, 255]
        pixels[37, 18] = [200, 200, 200, 255]
        prop, audit = trim_prop(Image.fromarray(pixels))
        self.assertEqual(prop.size, (16, 14))
        self.assertEqual(audit["removed_detached_pixels"], 1)
        self.assertEqual(prop.getbbox(), (0, 0, 16, 14))
        self.assertTrue(np.asarray(prop)[-1, :, 3].any())

    def test_hidden_background_rgb_never_enters_the_cutout(self):
        first = np.zeros((32, 32, 4), dtype=np.uint8)
        first[8:24, 7:25] = [90, 130, 70, 255]
        second = first.copy()
        second[first[..., 3] == 0] = [255, 0, 255, 0]
        self.assertEqual(trim_prop(Image.fromarray(first))[0].tobytes(),
                         trim_prop(Image.fromarray(second))[0].tobytes())

    def test_reduction_retains_aspect_and_trims_empty_sampled_edges(self):
        pixels = np.zeros((90, 150, 4), dtype=np.uint8)
        pixels[10:70, 15:135] = [90, 130, 70, 255]
        prop, _ = trim_prop(Image.fromarray(pixels), max_edge=60)
        self.assertEqual(prop.size, (60, 30))
        self.assertEqual(prop.getbbox(), (0, 0, 60, 30))

    def test_shelves_have_gutters_and_do_not_round_height_to_a_power_of_two(self):
        frames, size = pack_rectangles({"a": (240, 240), "b": (200, 180), "c": (190, 100)}, width=512)
        self.assertEqual(size, (512, 348))
        for key, frame in frames.items():
            self.assertGreaterEqual(frame["x"], 2)
            self.assertGreaterEqual(frame["y"], 2)
            self.assertLessEqual(frame["x"]+frame["width"]+2, size[0])
            self.assertLessEqual(frame["y"]+frame["height"]+2, size[1])
            for other_key, other in frames.items():
                if key == other_key:
                    continue
                self.assertTrue(frame["x"]+frame["width"]+4 <= other["x"] or
                                other["x"]+other["width"]+4 <= frame["x"] or
                                frame["y"]+frame["height"]+4 <= other["y"] or
                                other["y"]+other["height"]+4 <= frame["y"])

    def test_empty_or_oversized_sources_fail(self):
        with self.assertRaisesRegex(ValueError, "Empty"):
            trim_prop(Image.new("RGBA", (32, 32)))
        with self.assertRaisesRegex(ValueError, "oversized"):
            pack_rectangles({"too_wide": (512, 100)}, width=512)


if __name__ == "__main__":
    unittest.main()
