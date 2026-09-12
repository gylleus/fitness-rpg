from pathlib import Path
import tempfile
import unittest

import sprites


DEFINITION = '''schema_version = 1
[art]
{art}
[[assets]]
id = "fighter"
name = "Fighter"
kind = "player"
visual_description = "A broad-shouldered fighter."
[assets.animations.idle]
description = "The fighter breathes in place."
loop = true
[assets.animations.attack]
description = "The fighter winds up, swings, and returns to guard."
loop = false
'''


class ViewTests(unittest.TestCase):
    def definition(self, art):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "asset.toml"
            path.write_text(DEFINITION.format(art=art))
            return sprites.definitions(path)

    def test_profile_applies_to_reference_and_every_motion(self):
        for facing in ("left", "right"):
            with self.subTest(facing=facing):
                assets, art = self.definition(f'view = "profile"\nfacing = "{facing}"')
                prompts = sprites.prompts(assets[0], art, art["facing"])
                self.assertIn(f"strict {facing}-facing side profile", prompts["reference"])
                self.assertIn("three-quarter view", prompts["negative"].split("front view")[0])
                self.assertIn("chest facing camera", prompts["negative"].split("front view")[0])
                for prompt in (prompts["reference"], prompts["full_reference_context"],
                               *prompts["motions"].values()):
                    self.assertIn("profile", prompt)
                    self.assertNotIn("three-quarter", prompt)
                    # Composition must precede the description even for very long captions.
                    self.assertIn("90-degree side view", prompt.split("fighter.")[0])
                    self.assertIn(f"Head and body point toward the {facing} edge together", prompt)
                    self.assertIn("far side is occluded", prompt)
                for prompt in prompts["motions"].values():
                    self.assertIn(f"facing {facing} throughout", prompt)
                    self.assertIn("No turning toward or away from the camera", prompt)

    def test_profile_geometry_precedes_long_caption_and_avoids(self):
        assets, art = self.definition('view = "profile"')
        art["avoid"] = ["unwanted detail"] * 150
        caption = "A fighter with " + "weathered equipment " * 150
        prompts = sprites.prompts(assets[0], art, "left", {"caption": caption})
        self.assertLess(prompts["reference"].index("far side is occluded"),
                        prompts["reference"].index(caption))
        self.assertLess(prompts["negative"].index("chest facing camera"),
                        prompts["negative"].index("unwanted detail"))

    def test_profile_prop_does_not_acquire_character_anatomy(self):
        assets, art = self.definition('view = "profile"')
        assets[0]["kind"] = "prop"
        prompts = sprites.prompts(assets[0], art, "right")
        self.assertIn("The object points toward the right edge", prompts["reference"])
        self.assertNotIn("Head and body", prompts["reference"])
        self.assertNotIn("chest facing camera", prompts["negative"])

    def test_default_and_explicit_three_quarter_preserve_existing_prompts(self):
        assets, art = self.definition("")
        default = sprites.prompts(assets[0], art, art["facing"])
        assets, art = self.definition('view = "three_quarter"')
        self.assertEqual(default, sprites.prompts(assets[0], art, art["facing"]))
        self.assertIn("slight three-quarter turn", default["full_reference_context"])
        for prompt in default["motions"].values():
            self.assertIn("side-on with a slight three-quarter turn", prompt)
        del art["view"]
        self.assertEqual(default, sprites.prompts(assets[0], art, art["facing"]))

    def test_invalid_view_is_rejected_when_loading_recipe(self):
        for value in ('"front"', '""', 'true', '3', '[]'):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "art.view"):
                self.definition(f"view = {value}")


if __name__ == "__main__":
    unittest.main()
