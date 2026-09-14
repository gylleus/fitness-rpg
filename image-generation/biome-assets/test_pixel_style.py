import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from biome_assets import digest, prepare, save, sha
from pixel_style import compile_texture, export_contract, load_profile, validate
from reexport import reexport_biome


class PixelStyleTests(unittest.TestCase):
    def test_scene_layers_share_density_instead_of_source_dimensions(self):
        profile = load_profile()
        for master, canvas, expected in [((1672, 941), (640, 360), (960, 540)),
                                          ((2048, 768), (640, 240), (960, 360)),
                                          ((2048, 768), (256, 96), (384, 144))]:
            image = compile_texture(Image.new("RGBA", master, (80, 70, 60, 255)), canvas, profile, "background")
            self.assertEqual(image.size, expected)

    def test_hidden_matte_does_not_affect_edges_or_palette(self):
        profile = load_profile()
        first = np.zeros((180, 180, 4), dtype=np.uint8)
        first[23:157, 23:157] = [90, 70, 40, 255]
        second = first.copy()
        second[first[..., 3] == 0] = [255, 0, 255, 0]
        a = compile_texture(Image.fromarray(first), (32, 32), profile, "prop")
        b = compile_texture(Image.fromarray(second), (32, 32), profile, "prop")
        self.assertEqual(a.tobytes(), b.tobytes())
        pixels = np.array(a)
        self.assertEqual(set(np.unique(pixels[..., 3])), {0, 255})
        self.assertFalse(pixels[pixels[..., 3] == 0].any())

    def test_area_reduction_removes_grain_and_palette_is_bounded(self):
        profile = load_profile()
        pixels = np.random.default_rng(14).integers(20, 200, size=(256, 256, 3), dtype=np.uint8)
        image = compile_texture(Image.fromarray(pixels), (64, 64), profile, "prop")
        colors = np.array(image)[..., :3]
        self.assertLessEqual(len(np.unique(colors.reshape(-1, 3), axis=0)), 32)
        self.assertLess(float(colors.std()), float(pixels.std()) * .5)
        self.assertEqual(image.tobytes(), compile_texture(Image.fromarray(pixels), (64, 64), profile, "prop").tobytes())

    def test_invalid_profile_and_vanishing_cutout_fail(self):
        profile = load_profile()
        for key, value in [("pixels_per_unit", 0), ("pixels_per_unit", float("nan")),
                           ("reference_height", -1), ("prop_colors", 0)]:
            changed = {**profile, key: value}
            with self.assertRaises(ValueError):
                validate(changed)
        with self.assertRaisesRegex(ValueError, "disappears"):
            compile_texture(Image.new("RGBA", (128, 128)), (64, 64), profile, "prop")

    def test_single_prop_preparation_uses_visible_height_and_ignores_detached_specks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asset = {"id": "urn", "kind": "prop", "canvas": [64, 64], "transparent": True,
                     "prompt": "an urn", "source_definition": {"generation": {"height_scale": .5}},
                     "export": export_contract(load_profile(), "prop")}
            save(root / "plan.json", {"schema_version": 1, "biome_id": "example", "assets": [asset]})
            pixels = np.zeros((256, 256, 4), dtype=np.uint8)
            pixels[70:190, 90:150] = [90, 70, 50, 255]
            pixels[250, 250] = [200, 150, 90, 255]
            Image.fromarray(pixels).save(root / "source.png")
            save(root / "sources.json", {"schema_version": 1, "plan_sha256": sha(root / "plan.json"),
                 "assets": {"urn": {"image": "source.png", "sha256": sha(root / "source.png"),
                                    "prompt_sha256": digest(asset["prompt"]), "backend": "fixture"}}})
            result = prepare(root / "plan.json", root / "sources.json", root / "out")
            self.assertEqual(result["assets"]["urn"]["size"], [24, 48])
            self.assertEqual(result["assets"]["urn"]["canvas"], [16, 32])

    def test_reexport_uses_immutable_master_and_remeasures_contact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "assets/biomes/example"
            folder.mkdir(parents=True)
            depth = root / "depth.png"
            ground = root / "ground.png"
            roof = root / "roof.png"
            Image.new("RGB", (160, 90), (60, 50, 40)).save(depth)
            ceiling = Image.new("RGBA", (160, 60))
            ceiling.paste((60, 50, 40, 255), (0, 0, 160, 40))
            ceiling.save(roof)
            pixels = np.zeros((96, 256, 4), dtype=np.uint8)
            pixels[32:] = [100, 70, 40, 255]
            Image.fromarray(pixels).save(ground)
            records = {key: {"id": key, "source": path.name, "source_sha256": sha(path),
                            "sha256": "old-export", "canvas": canvas}
                       for key, path, canvas in [("depth", depth, [64, 36]), ("ground", ground, [256, 96]), ("roof", roof, [64, 24])]}
            records["ground"]["surface_y"] = 24
            save(folder / "sources.json", records)
            save(folder / "interior.json", {"schema_version": 1, "canvas": [640, 360],
                 "reference_height": 64, "ground_y": 288, "ceiling_clearance": 104, "fill": "#222222",
                 "layers": [{"id": "depth", "asset_id": "depth", "image": "depth", "role": "rear",
                             "canvas": [64, 36], "origin_y": 28, "parallax": .1, "repeat": "mirror"},
                            {"id": "roof", "asset_id": "roof", "image": "roof", "role": "ceiling",
                             "canvas": [64, 24], "origin_y": 16, "parallax": .6, "repeat": "mirror"}]})
            with patch("reexport.ROOT", root):
                reexport_biome("example")
                exported = json.loads((folder / "sources.json").read_text())
                self.assertEqual(exported["ground"]["surface_y"], 32)
                self.assertEqual(exported["ground"]["size"], [384, 144])
                self.assertEqual(exported["depth"]["source_sha256"], sha(depth))
                reexport_biome("example")
                self.assertEqual(exported, json.loads((folder / "sources.json").read_text()))
                Image.new("RGB", (160, 90), "red").save(depth)
                with self.assertRaisesRegex(ValueError, "source changed"):
                    reexport_biome("example")
                self.assertEqual(exported, json.loads((folder / "sources.json").read_text()))


if __name__ == "__main__":
    unittest.main()
