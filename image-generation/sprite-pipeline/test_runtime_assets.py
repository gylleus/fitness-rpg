import json
from pathlib import Path
import tempfile
import unittest

import sprites
from export_sheet import skip_frames
from runtime_assets import bundle
from sheet_import import import_sheet
from PIL import Image, ImageDraw


class RuntimeAssetsTests(unittest.TestCase):
    def test_step_retains_death_endpoint_and_total_time(self):
        once = {"indices": list(range(8)), "durations_ms": [100]*7+[50], "repeat": False}
        result = skip_frames(once, 3)
        self.assertEqual(result["indices"], [0, 3, 6, 7])
        self.assertEqual(result["durations_ms"], [300, 300, 100, 50])
        self.assertEqual(sum(result["durations_ms"]), 750)
        loop = skip_frames({**once, "repeat": True}, 3)
        self.assertEqual(loop["indices"], [0, 3, 6])
        self.assertEqual(sum(loop["durations_ms"]), 750)

    def fixture(self, root):
        source = Image.new("RGBA", (128, 64))
        draw = ImageDraw.Draw(source)
        draw.rectangle((20, 10, 30, 50), fill="#be4a2f")
        draw.rectangle((74, 40, 114, 50), fill="#be4a2f")
        source.save(root/"source.png")
        recipe = {"asset_id": "test_actor", "name": "Test", "facing": "right", "size": 64,
            "actions": {action: {"image": "source.png", "sha256": sprites.sha256(root/"source.png"), "loop": action == "idle", "durations_ms": [100, 150],
                "frames": [{"rect": [0, 0, 64, 64], "origin": [32, 51]}, {"rect": [64, 0, 64, 64], "origin": [96, 51]}]} for action in ("idle", "death")}}
        sprites.save_json(root/"import.json", recipe)
        import_sheet(root/"import.json", root/"export")
        sprites.save_json(root/"bundle.json", {"entities": [{"manifest": "export/manifest.json"}]})

    def test_authored_import_and_bundle_preserve_ground_scale_and_one_shot(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            folder = root/"export/death/nearest"
            upright = Image.open(folder/"frame-000.png").getbbox()
            fallen = Image.open(folder/"frame-001.png").getbbox()
            self.assertEqual(upright[3], fallen[3])
            self.assertEqual(upright[3]-upright[1], fallen[2]-fallen[0])
            bundle(root/"bundle.json", root/"game", root/"generated.ts", 1)
            entity = json.loads((root/"game/catalog.json").read_text())["entities"]["test_actor"]
            self.assertFalse(entity["actions"]["death"]["loop"])
            self.assertEqual(entity["actions"]["death"]["duration"], 250)
            self.assertIn('require("game/test_actor--death.png")', (root/"generated.ts").read_text())

    def test_bad_source_fails_before_publishing_over_existing_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            output = root/"game"
            output.mkdir()
            (output/"catalog.json").write_text("keep existing package")
            atlas_path = root/"export/death/nearest/spritesheet.json"
            atlas = json.loads(atlas_path.read_text())
            atlas["frames"][0]["frame"]["x"] = 9999
            sprites.save_json(atlas_path, atlas)
            with self.assertRaisesRegex(ValueError, "outside atlas"):
                bundle(root/"bundle.json", output, root/"generated.ts")
            self.assertEqual((output/"catalog.json").read_text(), "keep existing package")
            self.assertFalse((root/"generated.ts").exists())

    def test_rebundle_preserves_existing_encoding_and_updates_changed_pixels(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            bundle(root/"bundle.json", root/"game", root/"generated.ts")
            path = root/"game/test_actor--idle.png"
            with Image.open(path) as image:
                pixels = image.copy()
            pixels.save(path, compress_level=0)
            original = path.read_bytes()
            bundle(root/"bundle.json", root/"game", root/"generated.ts")
            self.assertEqual(path.read_bytes(), original)
            provenance = json.loads((root/"game/provenance.json").read_text())
            self.assertEqual(provenance['entities']['test_actor']['sheets']['idle']['output_sha256'], sprites.sha256(path))
            pixels.putpixel((0, 0), (255, 0, 0, 255))
            pixels.save(path)
            bundle(root/"bundle.json", root/"game", root/"generated.ts")
            self.assertEqual(Image.open(path).getpixel((0, 0)), (0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
