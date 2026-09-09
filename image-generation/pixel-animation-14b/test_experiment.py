import unittest
import numpy as np
from PIL import Image, ImageDraw
from analyze import transition_metrics
from run import workflow


def sprite(x):
    im = Image.new("RGBA", (64, 64))
    ImageDraw.Draw(im).rectangle((x, 20, x + 19, 39), fill="white")
    return im


class ExperimentTests(unittest.TestCase):
    def test_actual_wrap_detects_jump_despite_matching_unused_endpoint(self):
        generated = [sprite(x) for x in range(12)] + [sprite(0)]
        displayed = generated[:-1]
        result = transition_metrics(displayed)
        self.assertGreater(result["wrap_to_internal_median_ratio"], 5)
        self.assertGreater(result["wrap_distance"], 0)
        self.assertEqual(transition_metrics([generated[0], generated[-1]])["wrap_distance"], 0)

    def test_periodic_motion_has_regular_wrap(self):
        # Periodic square traversal, with equal one-pixel steps including wrap.
        positions = [(20, 20), (21, 20), (22, 20), (22, 21), (22, 22), (21, 22), (20, 22), (20, 21)]
        frames = []
        for x, y in positions:
            im = Image.new("RGBA", (64, 64))
            ImageDraw.Draw(im).rectangle((x, y, x + 19, y + 19), fill="white")
            frames.append(im)
        result = transition_metrics(frames)
        self.assertAlmostEqual(result["wrap_to_internal_median_ratio"], 1)
        self.assertGreater(result["wrap_distance"], 0)

    def test_expert_handoff_does_not_add_second_noise(self):
        settings = dict(size=512, length=45, pixel_lora=1., distilled=True,
            seed=72001, steps=4, split_step=2, cfg=1., sampler="ddim", shift=5., end_condition=True)
        preset = dict(prompt="knight breathing", negative="camera movement")
        hi = workflow("reference.png", preset, settings, "high")
        lo = workflow("reference.png", preset, settings, "low")
        self.assertEqual(hi["9"]["inputs"]["end_at_step"], lo["9"]["inputs"]["start_at_step"])
        self.assertEqual(lo["9"]["inputs"]["add_noise"], "disable")
        self.assertEqual(hi["9"]["inputs"]["return_with_leftover_noise"], "enable")
        self.assertEqual(hi["8"], lo["8"])
        self.assertEqual(lo["9"]["inputs"]["latent_image"], ["14", 0])
        self.assertEqual(hi["8"]["inputs"]["start_image"], hi["8"]["inputs"]["end_image"])
        settings["pixel_lora"] = 0
        self.assertNotIn("13", workflow("reference.png", preset, settings, "high"))
        settings["distilled"] = False
        self.assertNotIn("12", workflow("reference.png", preset, settings, "high"))


if __name__ == "__main__":
    unittest.main()
