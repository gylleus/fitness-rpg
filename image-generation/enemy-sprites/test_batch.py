import argparse
import json
from pathlib import Path
import shutil
import tempfile
import unittest

import batch
from animations import timing, export
from references import token_chunks, reference_anchor


class BatchTests(unittest.TestCase):
    def fixture(self, root):
        from test_content import BIOME_FIXTURE, ENEMY_FIXTURE
        manifest = "schema_version = 1\n"
        for suffix in ("a", "b"):
            biome, enemy = f"fixture_{suffix}", f"test_enemy_{suffix}"
            folder = root / biome
            folder.mkdir(parents=True)
            (folder / "BIOME.toml").write_text(BIOME_FIXTURE.format(biome_id=biome))
            roster = ENEMY_FIXTURE.format(biome_id=biome, enemy_id=enemy)
            if suffix == "a":
                roster = roster.replace("[[enemies]]", '[[encounters]]\nenemy_id = "test_enemy_b"\n\n[[enemies]]')
            (folder / "ENEMIES.toml").write_text(roster)
            manifest += f'\n[[biomes]]\nid = "{biome}"\nbiome_file = "{biome}/BIOME.toml"\nenemies_file = "{biome}/ENEMIES.toml"\n'
        (root / "catalog.toml").write_text(manifest)

    def test_resolves_cross_biome_encounters_and_uses_canonical_prose_without_shared_art(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "content"
            self.fixture(root)
            args = argparse.Namespace(content_dir=root, all_enemies=False,
                roster=root / "fixture_a/ENEMIES.toml", enemy=None,
                facing=None, size=64, frame_step=2, seed=83000, actions=["idle", "attack"], run=Path(temp) / "run",
                captions=None, reference_lora=.65)
            batch.plan(args)
            config = batch.load(args.run)
            keys = [batch.subject(e)["id"] for e in batch.entries(config)]
            self.assertEqual(keys, ["test_enemy_a", "test_enemy_b"])
            self.assertEqual(config["facing"], "left")
            for entry in batch.entries(config):
                asset = batch.subject(entry)
                prose = " ".join(asset["visual_description"].split())
                self.assertIn(prose, entry["prompts"]["full_reference_context"])
                self.assertIn("left-facing profile", entry["prompts"]["reference"])
                self.assertIn("side-scroller", entry["prompts"]["full_reference_context"])
                for action in args.actions:
                    self.assertIn(asset["visual"][action], entry["prompts"]["motions"][action])
                self.assertEqual(entry["seeds"]["reference"], batch.seed_for(asset["id"], "reference", 83000))
                self.assertNotEqual(entry["seeds"]["idle"], entry["seeds"]["attack"])
            args.frame_step = 4
            with self.assertRaisesRegex(ValueError, "different inputs/settings"):
                batch.plan(args)

    def test_catalog_rejects_unresolved_and_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "content"
            self.fixture(root)
            roster = root / "fixture_a/ENEMIES.toml"
            original = roster.read_text()
            roster.write_text(original.replace('enemy_id = "test_enemy_a"', 'enemy_id = "missing_enemy"', 1))
            with self.assertRaisesRegex(ValueError, "unknown enemy ID missing_enemy"):
                batch.load_content(root)
            roster.write_text(original)
            other = root / "fixture_b/ENEMIES.toml"
            other.write_text(other.read_text().replace('\nid = "test_enemy_b"', '\nid = "test_enemy_a"', 1))
            with self.assertRaisesRegex(ValueError, "duplicate enemy ID"):
                batch.load_content(root)

    def test_chunking_keeps_every_description_token_and_repeats_negative(self):
        tokenizer = argparse.Namespace(model_max_length=77, bos_token_id=-1, eos_token_id=-2, pad_token_id=-3)
        ids = list(range(201))
        chunks = token_chunks(ids, tokenizer, 3)
        restored = [i for chunk in chunks for i in chunk if i >= 0]
        self.assertEqual(restored, ids)
        self.assertTrue(all(len(chunk) == 77 for chunk in chunks))
        repeated = token_chunks(ids[:20], tokenizer, 3, repeat=True)
        self.assertEqual(repeated[0], repeated[2])

    def test_idle_and_attack_have_distinct_endpoint_semantics(self):
        idle, attack = timing(45,16,"idle",2), timing(45,16,"attack",2)
        self.assertEqual(idle["indices"], list(range(0,44,2)))
        self.assertEqual(attack["indices"], list(range(0,45,2)))
        self.assertEqual(sum(idle["durations_ms"]), 2750)
        self.assertEqual(sum(attack["durations_ms"]), 2812)
        self.assertTrue(idle["repeat"])
        self.assertFalse(attack["repeat"])

    def test_hover_pivot_preserves_a_ground_gap(self):
        from PIL import Image, ImageDraw
        im = Image.new("RGBA", (128,128))
        ImageDraw.Draw(im).rectangle((40,30,80,89), fill="white")
        ground = reference_anchor(im,{"idle":"Stands in place."})
        hover = reference_anchor(im,{"idle":"Hovers gently."})
        self.assertEqual(hover["pivot"][0],ground["pivot"][0])
        self.assertAlmostEqual((hover["pivot"][1]-ground["pivot"][1])*128, 12)
        self.assertEqual(hover["anchor"],"floating")

    def test_real_exports_share_crop_pivot_and_scale_across_actions(self):
        from PIL import Image, ImageDraw
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config = {"actions": ["idle", "attack"], "facing": "left", "animation_generation": {"length":5,"fps":16},
                "export": {"size":64,"columns":8,"frame_step":2,"margin":.08,"palette":{}},
                "enemies": [{"enemy":{"id":"test_enemy","name":"Test Enemy","visual":{"height_scale":.6,
                    "palette":["#be4a2f"],"idle":"Sways.","attack":"Strikes once."}}}]}
            batch.save_json(root / "config.json", config)
            def sprite(left):
                im=Image.new("RGBA",(512,512));ImageDraw.Draw(im).rectangle((left,180,310,400),fill="#be4a2f")
                return im
            refs=root / "references/test_enemy";refs.mkdir(parents=True)
            sprite(230).save(refs / "reference-cutout.png")
            batch.save_json(refs / "source.json", {"pivot":[.5,400/512]})
            for action in config["actions"]:
                folder=root / "animations/test_enemy" / action
                (folder / "tracking/cutouts").mkdir(parents=True)
                (folder / "frames").mkdir()
                batch.save_json(folder / "tracking/tracking.json", {})
                for i in range(5):
                    image=sprite(230-i*5 if action=="idle" else 230-i*30)
                    image.save(folder / "tracking/cutouts" / f"{i:05d}.png")
                    image.save(folder / "frames" / f"{i:05d}.png")
            export(root)
            folder=root / "exports/test_enemy"
            idle=json.loads((folder / "idle/pyxelate/spritesheet.json").read_text())
            attack=json.loads((folder / "attack/pyxelate/spritesheet.json").read_text())
            for key in ("fixed_source_crop","pivot","height_scale","reference_idle_height_px"):
                self.assertEqual(idle["meta"][key],attack["meta"][key])
            self.assertFalse(attack["meta"]["repeat"])
            self.assertEqual(attack["frames"][-1]["source_frame"],4)
            with Image.open(folder / "attack/pyxelate/frame-000.png") as im:
                self.assertEqual(im.size,(64,64))
            original_hash = batch.sha256(folder / "attack/pyxelate/spritesheet.png")
            export(root, size=32, frame_step=1)
            alternate = root / "exports-32-step-1/test_enemy/attack/pyxelate/spritesheet.json"
            alternate_data = json.loads(alternate.read_text())
            self.assertEqual([f["source_frame"] for f in alternate_data["frames"]], list(range(5)))
            self.assertEqual(alternate_data["frames"][0]["frame"]["w"], 32)
            self.assertEqual(batch.sha256(folder / "attack/pyxelate/spritesheet.png"), original_hash)
            self.assertTrue((root / "review-32-step-1.html").exists())


if __name__ == "__main__":
    unittest.main()
