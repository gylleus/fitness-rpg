"""Exact reference text must survive planning without boilerplate or truncation."""
import argparse
from pathlib import Path
import tempfile
import unittest

import sprites
from sprite_references import reference_text


BASE = '''schema_version = 1
[art]
view = "profile"
[[assets]]
id = "subject"
name = "Subject"
kind = "{kind}"
visual_description = "A large weathered figure with thick arms."
reference_caption = "A caption that must not be appended."
'''
REFERENCE = '''[assets.reference]
prompt = "pixel art, full body, side view, bare chin"
negative = "beard, frontal view"
'''


class ReferencePromptTests(unittest.TestCase):
    def test_planned_reference_is_verbatim_for_characters_and_backgrounds(self):
        for kind in ("player", "background"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                path = root / "recipe.toml"
                path.write_text(BASE.format(kind=kind) + REFERENCE)
                args = argparse.Namespace(run=root / "run", definition=path, size=None,
                    frame_step=None, facing=None, asset=None, actions=None, seed=1,
                    reference_lora=.65, captions=None)
                sprites.plan(args)
                entry = sprites.load(args.run)["assets"][0]
                self.assertEqual(entry["prompts"]["reference"], "pixel art, full body, side view, bare chin")
                self.assertEqual(reference_text(entry), ("pixel art, full body, side view, bare chin", "beard, frontal view"))
                self.assertEqual(entry["prompts"]["caption_source"], "explicit assets.reference.prompt")
                self.assertIn("weathered figure", entry["prompts"]["full_reference_context"])

    def test_reference_override_preserves_animation_identity_and_camera(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "recipe.toml"
            path.write_text(BASE.format(kind="player") + REFERENCE +
                            '[assets.animations.attack]\ndescription = "Swings the club."\nloop = false\n')
            assets, art = sprites.definitions(path)
            prompts = sprites.prompts(assets[0], art, "right")
            self.assertIn("Swings the club.", prompts["motions"]["attack"])
            self.assertIn("weathered figure", prompts["motions"]["attack"])
            self.assertIn("right-facing side profile", prompts["motions"]["attack"])
            self.assertIn("front view", prompts["negative"])
            self.assertNotEqual(prompts["negative"], prompts["reference_negative"])

    def test_saved_runs_without_override_keep_their_negative_prompt(self):
        self.assertEqual(reference_text({"prompts": {"reference": "saved positive", "negative": "saved negative"}}),
                         ("saved positive", "saved negative"))

    def test_invalid_reference_tables_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "recipe.toml"
            for reference in ('reference = "invalid"\n', '[assets.reference]\nprompt = "x"\n',
                              REFERENCE.replace('negative = "beard, frontal view"', 'negative = ""'),
                              REFERENCE.replace('negative = "beard, frontal view"', 'negative = ["beard"]'),
                              REFERENCE + 'weight = 2\n'):
                with self.subTest(reference=reference):
                    path.write_text(BASE.format(kind="player") + reference)
                    with self.assertRaisesRegex(ValueError, "reference requires"):
                        sprites.definitions(path)


if __name__ == "__main__":
    unittest.main()
