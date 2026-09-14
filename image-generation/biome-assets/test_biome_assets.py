import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from biome_assets import bundle, digest, edit_plan, local_definition, make_plan, prepare, save, sha, tomllib


class BiomeAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def source_fixture(self, transparent=False):
        asset = {"id": "test_background", "kind": "background", "canvas": [64, 36],
                 "transparent": transparent, "prompt": "quiet cave", "export": {"sampling": "nearest"}}
        plan = {"schema_version": 1, "biome_id": "test_biome", "assets": [asset]}
        save(self.root / "plan.json", plan)
        Image.new("RGBA", (128, 72), (30, 40, 50, 255)).save(self.root / "source.png")
        spec = {"image": "source.png", "sha256": sha(self.root / "source.png"),
                "prompt_sha256": digest(asset["prompt"]), "backend": "test fixture"}
        sources = {"schema_version": 1, "plan_sha256": sha(self.root / "plan.json"), "assets": {asset["id"]: spec}}
        save(self.root / "sources.json", sources)
        return sources

    def prepare_fixture(self):
        return prepare(self.root / "plan.json", self.root / "sources.json", self.root / "out")

    def test_both_biomes_share_style_and_preserve_canonical_enemy_attacks(self):
        for biome in ("wetlands", "hollow_delve"):
            plan = make_plan(biome)
            self.assertEqual(plan, make_plan(biome))
            self.assertEqual(plan["style"]["id"], "actor-scale-dark-fantasy-v3")
            self.assertEqual({a["kind"] for a in plan["assets"]}, {"background", "ground", "prop", "enemy"})
            for asset in plan["assets"]:
                self.assertIn(plan["style"][asset["kind"]], asset["prompt"])
                if asset["kind"] == "enemy":
                    self.assertIn(asset["source_definition"]["visual"]["attack"], asset["sheet_prompt"])
                    self.assertIn("exactly 24", asset["sheet_prompt"])
                elif asset["kind"] == "background":
                    self.assertEqual(asset["export"]["resolution"], "world")
                    if "interior" not in plan:
                        self.assertIn("rows 160 through 288 quiet", asset["prompt"])
                        self.assertEqual(asset["canvas"], [640, 360])
        self.assertEqual(len(make_plan("hollow_delve", "background")["assets"]), 3)

    def test_unknown_biome_or_asset_selection_rejected(self):
        with self.assertRaises(ValueError):
            make_plan("../wetlands")
        with self.assertRaisesRegex(ValueError, "Unknown assets"):
            make_plan("wetlands", selected=["missing"])

    def test_local_definition_preserves_exact_prompts_and_rejects_alpha_layers(self):
        plan = make_plan("wetlands", "background", selected=["wetlands_overcast_sky"])
        save(self.root / "plan.json", plan)
        local_definition(self.root / "plan.json", self.root / "definition.toml")
        definition = tomllib.loads((self.root / "definition.toml").read_text())
        self.assertEqual([a["reference"]["prompt"] for a in definition["assets"]], [a["prompt"] for a in plan["assets"]])
        save(self.root / "plan.json", make_plan("wetlands", "background"))
        with self.assertRaisesRegex(ValueError, "opaque backgrounds"):
            local_definition(self.root / "plan.json", self.root / "other.toml")

    def test_bundle_preserves_unselected_runtime_slots(self):
        self.source_fixture()
        self.prepare_fixture()
        runtime = self.root / "runtime"
        runtime.mkdir()
        save(runtime / "sources.json", {"ground": {"id": "existing_ground"}})
        save(self.root / "mapping.json", {"test_background": "landscape"})
        with patch("biome_assets.ROOT", self.root):
            bundle(self.root / "out/manifest.json", self.root / "mapping.json", runtime)
        result = json.loads((runtime / "sources.json").read_text())
        self.assertEqual(result["ground"], {"id": "existing_ground"})
        self.assertEqual(sha(runtime / "landscape.png"), sha(self.root / "out/test_background.png"))
        self.assertEqual(result["landscape"]["source"], "source.png")

    def test_native_export_and_unchanged_resume(self):
        self.source_fixture()
        manifest = self.prepare_fixture()
        image = Image.open(self.root / "out/test_background.png")
        self.assertEqual(image.size, (64, 36))
        self.assertEqual(image.getchannel("A").getextrema(), (255, 255))
        self.assertEqual(manifest, self.prepare_fixture())

    def test_edit_plan_records_and_requires_its_reference(self):
        sources = self.source_fixture()
        plan = json.loads((self.root / "plan.json").read_text())
        save(self.root / "references.json", {"test_background": "source.png"})
        with patch("biome_assets.ROOT", self.root):
            plan = edit_plan(plan, self.root / "references.json")
            self.assertIn("Input image 1 is the edit target", plan["assets"][0]["prompt"])
            save(self.root / "plan.json", plan)
            sources["plan_sha256"] = sha(self.root / "plan.json")
            sources["assets"]["test_background"]["prompt_sha256"] = plan["assets"][0]["prompt_sha256"]
            save(self.root / "sources.json", sources)
            with self.assertRaisesRegex(ValueError, "planned edit reference"):
                self.prepare_fixture()
            self.assertFalse((self.root / "out").exists())
            sources["assets"]["test_background"]["references"] = [plan["assets"][0]["reference"]]
            save(self.root / "sources.json", sources)
            self.prepare_fixture()

    def test_ground_contact_is_measured_after_logical_export(self):
        sources = self.source_fixture(transparent=True)
        plan = json.loads((self.root / "plan.json").read_text())
        plan["assets"][0]["kind"] = "ground"
        save(self.root / "plan.json", plan)
        pixels = np.full((72, 128, 4), (70, 50, 30, 255), dtype=np.uint8)
        pixels[:28, :, 3] = 0
        Image.fromarray(pixels).save(self.root / "source.png")
        sources["plan_sha256"] = sha(self.root / "plan.json")
        sources["assets"]["test_background"]["sha256"] = sha(self.root / "source.png")
        save(self.root / "sources.json", sources)
        manifest = self.prepare_fixture()
        self.assertEqual(manifest["assets"]["test_background"]["surface_y"], 14)
        save(self.root / "mapping.json", {"test_background": "ground"})
        with patch("biome_assets.ROOT", self.root):
            bundle(self.root / "out/manifest.json", self.root / "mapping.json", self.root / "runtime")
        runtime = json.loads((self.root / "runtime/sources.json").read_text())
        self.assertEqual(runtime["ground"]["surface_y"], 14)

    def test_changed_plan_source_prompt_or_reference_rejected_before_writing(self):
        for mutation in ("plan", "source", "prompt", "reference"):
            with self.subTest(mutation=mutation):
                sources = self.source_fixture()
                if mutation == "plan":
                    sources["plan_sha256"] = "bad"
                elif mutation == "source":
                    sources["assets"]["test_background"]["sha256"] = "bad"
                elif mutation == "prompt":
                    sources["assets"]["test_background"]["prompt_sha256"] = "bad"
                else:
                    sources["assets"]["test_background"]["references"] = [{"image": "source.png", "sha256": "bad"}]
                save(self.root / "sources.json", sources)
                with self.assertRaises(ValueError):
                    self.prepare_fixture()
                self.assertFalse((self.root / "out").exists())

    def test_opaque_checkerboard_cannot_pass_as_transparency(self):
        self.source_fixture(transparent=True)
        with self.assertRaisesRegex(ValueError, "transparent cutout"):
            self.prepare_fixture()

    def test_alpha_and_hidden_rgb_normalized(self):
        sources = self.source_fixture(transparent=True)
        pixels = np.full((72, 128, 4), (30, 40, 50, 200), dtype=np.uint8)
        pixels[:36, :, 3] = 20
        Image.fromarray(pixels).save(self.root / "source.png")
        sources["assets"]["test_background"]["sha256"] = sha(self.root / "source.png")
        save(self.root / "sources.json", sources)
        self.prepare_fixture()
        pixels = np.array(Image.open(self.root / "out/test_background.png"))
        self.assertEqual(set(np.unique(pixels[..., 3])), {0, 255})
        self.assertFalse(pixels[pixels[..., 3] == 0].any())

    def test_wrong_aspect_ratio_rejected(self):
        sources = self.source_fixture()
        Image.new("RGB", (100, 100)).save(self.root / "source.png")
        sources["assets"]["test_background"]["sha256"] = sha(self.root / "source.png")
        save(self.root / "sources.json", sources)
        with self.assertRaisesRegex(ValueError, "aspect ratio"):
            self.prepare_fixture()

    def test_runtime_mapping_rejects_collisions_and_changed_exports(self):
        self.source_fixture()
        self.prepare_fixture()
        save(self.root / "mapping.json", {"test_background": "../escape"})
        with self.assertRaises(ValueError):
            bundle(self.root / "out/manifest.json", self.root / "mapping.json", self.root / "runtime")
        save(self.root / "mapping.json", {"test_background": "landscape", "another": "landscape"})
        with self.assertRaisesRegex(ValueError, "unique"):
            bundle(self.root / "out/manifest.json", self.root / "mapping.json", self.root / "runtime")
        save(self.root / "mapping.json", {"test_background": "landscape"})
        (self.root / "out/test_background.png").write_bytes(b"corrupted")
        with self.assertRaisesRegex(ValueError, "changed"):
            bundle(self.root / "out/manifest.json", self.root / "mapping.json", self.root / "runtime")
        self.assertFalse((self.root / "runtime").exists())


if __name__ == "__main__":
    unittest.main()
