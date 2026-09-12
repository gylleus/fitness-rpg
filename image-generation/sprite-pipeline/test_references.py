"""Offline integration contracts for the reference/animation boundary and scenes."""
import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from zipfile import ZipFile

import numpy as np
from PIL import Image, ImageDraw

import sprites
import sprite_references
import sprite_animations
from backgrounds import generation_size


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def definition(self, background=False, animated=True):
        path = self.root / ("scene.toml" if background else "prop.toml")
        path.write_text('schema_version = 1\n[[assets]]\nid = "scene"\nname = "Scene"\n'
                        'visual_description = "A weathered test scene."\nkind = "background"\ncanvas = [96, 48]\n'
                        if background else
                        'schema_version = 1\n[[assets]]\nid = "fire"\nname = "Fire"\nkind = "prop"\n'
                        'visual_description = "A campfire burns above charred logs."\n' +
                        ('[assets.animations.burn]\ndescription = "The attached flame flickers; the logs stay still."\nloop = true\n' if animated else ''))
        return path

    def png(self, background=False):
        path = self.root / ("scene.png" if background else "fire.png")
        image = Image.new("RGBA", (96, 48) if background else (32, 48), "#262b44" if background else (0,0,0,0))
        if background:
            draw = ImageDraw.Draw(image)
            draw.rectangle((0, 0, 7, 7), fill="#ff0044")
            draw.rectangle((88, 40, 95, 47), fill="#63c74d")
        else:
            # Deliberately off-palette RGB tests exact authored-reference preservation.
            ImageDraw.Draw(image).rectangle((8, 9, 23, 39), fill="#b35719")
        image.save(path)
        return path

    def plan(self, definition, reference=None, name="run", actions=None):
        args = argparse.Namespace(run=self.root / name, definition=definition, reference=reference,
                                  size=64, frame_step=2, facing=None, asset=None, actions=actions,
                                  seed=1, reference_lora=.65, captions=None)
        sprites.plan(args)
        return args.run

    def test_reference_cli_keeps_authored_pixels_and_never_animates(self):
        source = self.png()
        run = self.root / "design"
        result = subprocess.run([sys.executable, str(sprites.ROOT / "sprites.py"), "reference",
            "--definition", str(self.definition()), "--reference", str(source), "--run", str(run)],
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sprites.sha256(source), sprites.sha256(run / "references/fire/pixel-reference.png"))
        self.assertTrue((run / "reference-review.html").exists())
        self.assertFalse((run / "animations").exists())
        self.assertFalse((run / "originals").exists())
        self.assertEqual(sprites.load(run)["actions"], ["burn"])

    def test_portable_bundle_reuses_exact_conditioning_and_survives_source_removal(self):
        definition, source = self.definition(), self.png()
        design = self.plan(definition, source, "design")
        with patch("masking.biref_session", side_effect=AssertionError("No segmentation for authored art")):
            sprite_references.generate(design)
            sprite_references.prepare(design)
        refs = design / "references/fire"
        portable = self.root / "portable"
        shutil.copytree(refs, portable)
        motion = self.plan(definition, portable / "pixel-reference.json", "motion")
        expected = sprites.sha256(refs / "reference.png")
        shutil.rmtree(design)
        shutil.rmtree(portable)
        source.unlink()
        sprite_references.generate(motion)
        sprite_references.prepare(motion)
        sprite_references.prepare(motion)  # Safe resume.
        self.assertEqual(sprites.sha256(motion / "references/fire/reference.png"), expected)
        self.assertEqual(sprites.load(motion)["assets"][0]["reference_input"]["format"], "bundle")

    def test_animation_receives_the_selected_reference_and_motion(self):
        run = self.plan(self.definition(), self.png())
        sprite_references.prepare(run)
        expected = sprites.sha256(run / "references/fire/reference.png")

        @contextmanager
        def server(path):
            (path / "input").mkdir(parents=True)
            yield "http://unused", None

        def workflow(image, preset, settings, stage, latent):
            inputs = list((run / "expert-batches").glob("*/input/" + image))
            self.assertEqual(sprites.sha256(inputs[0]), expected)
            self.assertIn("attached flame flickers", preset["prompt"])
            self.assertTrue(settings["end_condition"])
            raise RuntimeError("Stopped at inference boundary")

        fake = types.SimpleNamespace(server=server, workflow=workflow)
        with patch.dict(sys.modules, {"run": fake}), self.assertRaisesRegex(RuntimeError, "inference boundary"):
            sprite_animations.animate(run, action="burn")

    def test_raw_input_changes_rejected_and_snapshot_tampering_detected(self):
        definition, source = self.definition(), self.png()
        run = self.plan(definition, source)
        Image.new("RGBA", (32,48), "red").save(source)
        with self.assertRaisesRegex(ValueError, "different inputs/settings"):
            self.plan(definition, source)
        # Changing the original does not affect the already planned reference.
        sprite_references.prepare(run)
        snap = run / sprites.load(run)["assets"][0]["reference_input"]["image"]["path"]
        Image.new("RGBA", (32,48), "red").save(snap)
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            sprite_references.generate(run)

    def test_prepared_pixel_edits_require_a_new_run(self):
        run = self.plan(self.definition(), self.png())
        sprite_references.prepare(run)
        Image.new("RGBA", (32,48), "red").save(run / "references/fire/pixel-reference.png")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            sprite_references.prepare(run)

    def test_background_all_exports_rectangles_without_model_calls(self):
        definition, source = self.definition(background=True), self.png(background=True)
        run = self.plan(definition, source)
        with patch("masking.biref_session", side_effect=AssertionError("No scene segmentation")):
            sprite_references.generate(run)
            sprite_references.prepare(run)
            sprite_animations.animate(run)
            sprite_animations.export(run)
            sprite_animations.package(run)
        original = np.asarray(Image.open(source))
        for method in ("nearest", "pyxelate"):
            folder = run / "exports/scene/reference" / method
            frame = Image.open(folder / "frame-000.png")
            self.assertEqual(frame.size, (96,48))
            self.assertEqual(frame.getchannel("A").getextrema(), (255,255))
            np.testing.assert_array_equal(np.asarray(frame), np.asarray(Image.open(folder / "spritesheet.png")))
            atlas = json.loads((folder / "spritesheet.json").read_text())
            self.assertIsNone(atlas["meta"]["pivot"])
            if method == "nearest":
                np.testing.assert_array_equal(np.asarray(frame), original)
        self.assertFalse((run / "animations").exists())
        with ZipFile(run / "sprites.zip") as archive:
            self.assertIsNone(archive.testzip())
            self.assertIn("inputs/scene/image.png", archive.namelist())
            self.assertIn("references/scene/pixel-reference.json", archive.namelist())
        index = json.loads((run / "index.json").read_text())
        self.assertEqual(index["completed_stills"], 1)
        self.assertEqual(index["completed_animations"], 0)

    def test_generated_background_preserves_full_scene_and_uses_scene_prompts(self):
        definition = self.definition(background=True)
        assets, art = sprites.definitions(definition)
        prompts = sprites.prompts(assets[0], art, "left")
        self.assertIn("Full scene", prompts["reference"])
        self.assertNotIn("isolated", prompts["reference"])
        self.assertNotIn("facing", prompts["reference"])
        self.assertEqual(generation_size(assets[0]), {"width": 1024, "height": 512})
        run = self.plan(definition)
        original = run / "originals/scene.png"
        original.parent.mkdir()
        shutil.copyfile(self.png(background=True), original)
        with patch("masking.biref_session", side_effect=AssertionError("No scene segmentation")):
            sprite_references.prepare(run)
        np.testing.assert_array_equal(np.asarray(Image.open(original)), np.asarray(Image.open(run / "references/scene/pixel-reference.png")))

    def test_background_animation_invalid_canvas_and_transparency_rejected(self):
        path = self.definition(background=True)
        text = path.read_text()
        for invalid in (text + '[assets.animations.wind]\ndescription = "Blows."\nloop = true\n',
                        text.replace('[96, 48]', '[0, 48]'), text.replace('[96, 48]', '[1024, 16]')):
            path.write_text(invalid)
            with self.assertRaises(ValueError):
                sprites.definitions(path)
        path.write_text(text)
        with self.assertRaisesRegex(ValueError, "fully opaque"):
            self.plan(path, self.png())

    def test_batch_pixel_inputs_and_mixed_static_and_animated_assets(self):
        definition = self.definition()
        definition.write_text(definition.read_text() + '\n[[assets]]\nid = "scene"\nname = "Scene"\nkind = "background"\n'
                              'visual_description = "An old road."\ncanvas = [96,48]\n')
        mapping = self.root / "inputs.json"
        mapping.write_text(json.dumps({"fire": self.png().name, "scene": self.png(background=True).name}))
        args = argparse.Namespace(run=self.root / "mixed", definition=definition, reference_inputs=mapping,
                                  size=64, frame_step=2, facing=None, asset=None, actions=None,
                                  seed=1, reference_lora=.65, captions=None)
        sprites.plan(args)
        sprite_references.prepare(args.run)
        config = sprites.load(args.run)
        self.assertEqual(sprites.actions_for(config, config["assets"][0]), ["burn"])
        self.assertEqual(sprites.actions_for(config, config["assets"][1]), [])
        self.assertEqual(len(json.loads((args.run / "reference-index.json").read_text())["references"]), 2)


if __name__ == "__main__":
    unittest.main()
