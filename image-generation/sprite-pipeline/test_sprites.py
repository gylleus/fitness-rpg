import argparse
import copy
import json
from pathlib import Path
import tempfile
import unittest

import sprites
import sprite_animations as animations


class AssetTests(unittest.TestCase):
    def test_per_asset_guides_record_content_and_reject_stale_replans(self):
        from PIL import Image
        assets, art = sprites.definitions(sprites.ROOT.parent / "player-sprites/barbarian.toml")
        key = assets[0]["id"]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            guide = root / "guide.png"
            Image.new("RGB", (16, 16), "gray").save(guide)
            mapping = root / "guides.json"
            mapping.write_text(json.dumps({key: {"image": "guide.png", "strength": .6}}))
            args = self.args(root / "run")
            args.reference_guides = mapping
            sprites.make_plan(args, assets, art, {})
            spec = sprites.load(args.run)["assets"][0]["reference_guide"]
            self.assertEqual(spec["image"], "../guide.png")
            self.assertEqual(spec["sha256"], sprites.sha256(guide))
            Image.new("RGB", (16, 16), "black").save(guide)
            with self.assertRaisesRegex(ValueError, "different inputs/settings"):
                sprites.make_plan(args, assets, art, {})
            mapping.write_text(json.dumps({"unknown": {"image": "guide.png", "strength": .6}}))
            with self.assertRaisesRegex(ValueError, "selected assets"):
                sprites.make_plan(args, assets, art, {})

    def test_death_is_one_shot_and_walk_timing_keeps_the_cycle(self):
        with self.assertRaisesRegex(ValueError, "one-shot"):
            sprites.validate_animations({"death": {"description": "Falls.", "loop": True}})
        walk = animations.timing(45, 16, "walk", 2, True)
        death = animations.timing(45, 16, "death", 2, False)
        self.assertEqual(walk["indices"], list(range(0, 44, 2)))
        self.assertEqual(death["indices"], list(range(0, 45, 2)))
        self.assertEqual(sum(walk["durations_ms"]), 2750)
        self.assertEqual(sum(death["durations_ms"]), 2812)
        self.assertFalse(death["repeat"])

    def args(self, root):
        return argparse.Namespace(run=root, size=64, frame_step=2, facing="right", asset=None,
                                  actions=None, seed=1, reference_lora=.65, captions=None)

    def test_player_requires_no_enemy_stats_and_preserves_definition(self):
        source = sprites.ROOT.parent / "player-sprites/barbarian.toml"
        assets, art = sprites.definitions(source)
        self.assertEqual(assets[0]["kind"], "player")
        self.assertNotIn("stats", assets[0])
        with tempfile.TemporaryDirectory() as temp:
            args = self.args(Path(temp))
            sprites.make_plan(args, assets, art, {"text": source.read_text()})
            config = sprites.load(args.run)
            entry = config["assets"][0]
            self.assertEqual(entry["asset"], assets[0])
            self.assertEqual(config["source"]["text"], source.read_text())
            self.assertIn("right-facing", entry["prompts"]["reference"])
            self.assertEqual(sprites.actions_for(config, entry), ["idle", "attack"])
            args.size = 128
            with self.assertRaisesRegex(ValueError, "different inputs/settings"):
                sprites.make_plan(args, assets, art, {"text": source.read_text()})

    def test_named_actions_use_explicit_loop_flags(self):
        asset = {"id": "torch", "name": "Torch", "kind": "prop", "visual_description": "A burning torch.",
                 "visual": {"equipment": [], "silhouette": "Tall narrow shape."},
                 "animations": {"burn": {"description": "The flame flickers.", "loop": True},
                                "extinguish": {"description": "The flame dies.", "loop": False}}}
        prompts = sprites.prompts(asset, {**sprites.DEFAULT_ART, "style": "Muted copper and violet."}, "left")
        self.assertIn("entire object", prompts["reference"])
        self.assertIn("Muted copper and violet.", prompts["reference"])
        self.assertIn("Muted copper and violet.", prompts["motions"]["burn"])
        self.assertNotIn("anatomy, face", prompts["motions"]["burn"])
        self.assertIn("The flame flickers.", prompts["motions"]["burn"])
        self.assertIn("exact starting pose", prompts["motions"]["burn"])
        self.assertIn("Do not repeat", prompts["motions"]["extinguish"])
        loop = animations.timing(45, 16, "burn", 4, sprites.looping(asset, "burn"))
        once = animations.timing(45, 16, "extinguish", 4, sprites.looping(asset, "extinguish"))
        self.assertTrue(loop["repeat"])
        self.assertEqual(sum(loop["durations_ms"]), 2750)
        self.assertEqual(once["indices"][-1], 44)
        self.assertFalse(once["repeat"])
        entry = {"asset": asset}
        self.assertEqual(sprites.actions_for({"actions": ["burn", "attack"]}, entry), ["burn"])

    def test_bad_ids_loop_flags_and_unknown_fields_rejected(self):
        base = 'schema_version = 1\n[[assets]]\nid = "test"\nname = "Test"\nvisual_description = "A test object."\n'
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "asset.toml"
            for text in (base.replace('id = "test"', 'id = "../escape"'),
                         base + '[assets.animations.spin]\ndescription = "Spins."\nloop = "yes"\n',
                         base + 'statss = 10\n',
                         base + '[assets.animations.reference]\ndescription = "Spins."\nloop = true\n'):
                path.write_text(text)
                with self.assertRaises(ValueError):
                    sprites.definitions(path)

    def test_static_prop_exports_both_reducers_without_animation_models(self):
        from PIL import Image, ImageDraw
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "asset.toml"
            source.write_text('schema_version = 1\n[[assets]]\nid = "chest"\nkind = "prop"\nname = "Chest"\nvisual_description = "A squat wooden chest."\n')
            assets, art = sprites.definitions(source)
            sprites.make_plan(self.args(root), assets, art, {"text": source.read_text()})
            refs = root / "references/chest"
            refs.mkdir(parents=True)
            im = Image.new("RGBA", (512, 512))
            ImageDraw.Draw(im).rectangle((170, 220, 330, 350), fill="#be4a2f")
            im.save(refs / "reference-cutout.png")
            sprites.save_json(refs / "source.json", {"pivot": [.5, 351/512]})
            animations.export(root)
            index = json.loads((root / "index.json").read_text())
            self.assertEqual(index["completed_animations"], 0)
            self.assertEqual(index["completed_stills"], 1)
            for method in ("nearest", "pyxelate"):
                folder = root / "exports/chest/reference" / method
                with Image.open(folder / "frame-000.png") as frame:
                    self.assertEqual(frame.size, (64, 64))
                    self.assertEqual(frame.mode, "RGBA")
                atlas = json.loads((folder / "spritesheet.json").read_text())
                self.assertEqual(atlas["meta"]["asset_id"], "chest")
                self.assertFalse(atlas["meta"]["repeat"])
            self.assertTrue((root / "review.html").exists())


if __name__ == "__main__":
    unittest.main()
