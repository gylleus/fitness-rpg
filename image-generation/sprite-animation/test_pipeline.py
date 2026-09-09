"""Focused regressions for alpha, time, palette, crop and real export contracts."""
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw

from common import ROOT
from comfy import workflow
from pipeline import configuration
from pixels import convert, export, fixed_crop, mask_metrics, palette_colors, quality, select_loop, map_palette


def sprite(x=0, flame=0):
    im = Image.new("RGBA", (128, 128))
    d = ImageDraw.Draw(im)
    d.rectangle((42 + x, 30, 83 + x, 109), fill="#8b9bb4")
    d.rectangle((53 + x, 15, 71 + x, 33), fill="#ead4aa")
    d.rectangle((56 + x, 40 + flame, 66 + x, 61 + flame), fill="#0099db")
    d.line((94 + x, 30, 94 + x, 109), fill="#ffffff", width=3)
    return im


class Contracts(unittest.TestCase):
    def test_saturated_blue_maps_to_blue_and_palette_colors_stay_exact(self):
        blue = Image.new("RGB", (1, 1), (0, 0, 255))
        self.assertEqual(map_palette(blue).getpixel((0, 0)), (18, 78, 137))
        colors = palette_colors()
        np.testing.assert_array_equal(np.array(map_palette(Image.fromarray(colors[None]))), colors[None])

    def test_hidden_rgb_does_not_change_visible_output(self):
        base = np.array(sprite())
        variants = []
        for color in ([255, 0, 255], [0, 255, 255]):
            a = base.copy()
            a[a[..., 3] == 0, :3] = color
            variants.append(Image.fromarray(a))
        for size in (64, 128):
            for method in ("nearest", "conservative"):
                a, b = [np.asarray(convert(im, size, method)) for im in variants]
                np.testing.assert_array_equal(a, b)
                self.assertEqual(set(np.unique(a[..., 3])), {0, 255})
                self.assertTrue(set(map(tuple, a[a[..., 3] > 0, :3])) <= set(map(tuple, palette_colors())))

    def test_shared_crop_preserves_motion_and_aspect(self):
        a, b = sprite(), sprite(x=6)
        crops, box = fixed_crop([a, b])
        self.assertEqual(crops[0].size, crops[1].size)
        self.assertEqual(crops[0].width, crops[0].height)
        xs = [np.where(np.asarray(c.getchannel("A")) > 0)[1].min() for c in crops]
        self.assertEqual(xs[1] - xs[0], 6)
        self.assertEqual(box[2] - box[0], box[3] - box[1])

    def test_static_clip_rejected(self):
        frames = [sprite()] * 33
        loop = select_loop(frames)
        qc = quality(mask_metrics(frames), loop, configuration()["gates"])
        self.assertFalse(qc["passed"])
        self.assertIn("insufficient_motion", qc["reasons"])

    def test_color_flicker_does_not_count_as_character_motion(self):
        frames = []
        for i in range(33):
            a = np.array(sprite())
            a[a[..., 3] > 0, :3] = [255, 255, 255] if i % 2 else [18, 78, 137]
            frames.append(Image.fromarray(a))
        gates = {**configuration()["gates"], "min_shape_motion": 0.02}
        loop = select_loop(frames, min_shape_motion=0.02)
        self.assertGreater(loop["motion_excursion"], gates["min_motion"])
        self.assertEqual(loop["shape_excursion"], 0)
        self.assertIn("insufficient_shape_motion", quality(mask_metrics(frames), loop, gates)["reasons"])

    def test_loop_export_roundtrip(self):
        # Deterministic synthetic cycle is only a contract test, not AI evidence.
        frames = [convert(sprite(flame=round(7 * np.sin(i * 2 * np.pi / 24))), 64, "nearest") for i in range(33)]
        loop = select_loop(frames)
        self.assertEqual(len(set(loop["indices"])), 8)
        self.assertLess(loop["indices"][-1], loop["end_exclusive"])
        expected = round((loop["end_exclusive"] - loop["start"]) * 1000 / 24)
        self.assertEqual(sum(loop["durations_ms"]), expected)
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            export(frames, loop, out, "test", [0.5, 0.92])
            sheet = Image.open(out / "spritesheet.png")
            self.assertEqual(sheet.size, (512, 64))
            data = json.loads((out / "spritesheet.json").read_text())
            self.assertEqual(len(data["frames"]), 8)
            for i, record in enumerate(data["frames"]):
                im = Image.open(out / record["filename"])
                np.testing.assert_array_equal(np.array(im), np.array(sheet.crop((i * 64, 0, (i + 1) * 64, 64))))
            preview = Image.open(out / "preview.apng")
            # Pillow can coalesce adjacent identical APNG frames. Check the
            # actual playback timeline, not a presumed container frame count.
            elapsed = 0
            decoded = []
            for i in range(preview.n_frames):
                preview.seek(i)
                decoded.append((elapsed, np.array(preview.convert("RGBA"))))
                elapsed += round(preview.info["duration"])
            self.assertEqual(elapsed, expected)
            start = 0
            for index, duration in zip(loop["indices"], loop["durations_ms"]):
                current = [a for t, a in decoded if t <= start][-1]
                np.testing.assert_array_equal(current, np.array(frames[index]))
                start += duration
            preview.close()

    def test_mask_and_anchor_failures_are_reported(self):
        frames = [sprite()] * 16 + [sprite(x=14)] * 17
        loop = select_loop(frames)
        qc = quality(mask_metrics(frames), loop, configuration()["gates"], mask_agreement=0.2)
        self.assertIn("anchor_drift", qc["reasons"])
        self.assertIn("tracker_segmenter_disagreement", qc["reasons"])

    def test_ground_anchor_does_not_jump_between_planted_boots(self):
        frames = []
        for left_bottom, right_bottom in [(111, 108), (108, 111)]:
            im = Image.new("RGBA", (128, 128))
            draw = ImageDraw.Draw(im)
            draw.rectangle((42, 20, 83, 88), fill="#8b9bb4")
            draw.rectangle((43, 89, 56, left_bottom), fill="#8b9bb4")
            draw.rectangle((69, 89, 82, right_bottom), fill="#8b9bb4")
            frames.append(im)
        self.assertEqual(mask_metrics(frames)["anchor_drift_xy_fraction"], [0, 0])

    def test_cape_tip_above_ground_does_not_move_foot_anchor(self):
        a = Image.new("RGBA", (128, 128))
        draw = ImageDraw.Draw(a)
        draw.rectangle((42, 20, 83, 88), fill="#8b9bb4")
        draw.rectangle((43, 89, 56, 111), fill="#8b9bb4")
        draw.rectangle((69, 89, 82, 108), fill="#8b9bb4")
        b = a.copy()
        ImageDraw.Draw(b).rectangle((95, 95, 100, 106), fill="#a22633")
        self.assertEqual(mask_metrics([a, b])["anchor_drift_xy_fraction"], [0, 0])

    def test_wan_dimensions_and_lossless_output(self):
        settings = configuration()["generation"]
        graph = workflow("input.png", "move", "blur", settings, 123)
        self.assertEqual(graph["9"]["inputs"]["seed"], 123)
        self.assertEqual(graph["11"]["class_type"], "SaveImage")
        with self.assertRaises(ValueError):
            workflow("input.png", "move", "blur", {**settings, "length": 32}, 123)


if __name__ == "__main__":
    unittest.main(verbosity=2)
