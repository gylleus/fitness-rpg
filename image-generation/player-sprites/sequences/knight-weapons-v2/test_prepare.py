import json
import unittest

import numpy as np
from PIL import Image

from prepare import BOOT, GROUND, HERE, IDLE_OFFSETS, KNEE, TYPES, breathe


class PlayerSheetsTest(unittest.TestCase):
    def test_exported_cloth_stays_muted_across_weapons_and_attack_poses(self):
        # Sample the shared hanging front drape at game resolution, including
        # attack transitions. Bright red/orange was visible only after export.
        for weapon in TYPES:
            for action in ('idle', 'walk', 'attack'):
                for path in (HERE / weapon / 'export' / action / 'nearest').glob('frame-*.png'):
                    with self.subTest(path=str(path.relative_to(HERE))):
                        cloth = np.array(Image.open(path).convert('RGBA'))[76:93, 41:72]
                        colors = {tuple(rgb) for rgb in cloth[cloth[..., 3] > 0, :3]}
                        self.assertFalse(colors & {(190, 74, 47), (162, 38, 51), (228, 59, 68)})
                        self.assertIn((115, 62, 57), colors)

    def test_idle_keeps_boots_exact_and_weapon_rigid_without_horizontal_motion(self):
        for weapon in TYPES:
            with self.subTest(weapon=weapon):
                folder = HERE / weapon / 'export/idle/nearest'
                neutral = Image.open(folder / 'frame-000.png').convert('RGBA')
                a = np.array(neutral)
                for i, offset in enumerate(IDLE_OFFSETS):
                    frame = np.array(Image.open(folder / f'frame-{i:03d}.png'))
                    np.testing.assert_array_equal(frame[BOOT:], a[BOOT:])
                    # Includes every weapon pixel, grip, helmet and breastplate.
                    np.testing.assert_array_equal(frame[10+offset:KNEE-2+offset], a[10:KNEE-2])
                    self.assertEqual(Image.fromarray(frame).getbbox()[3], GROUND)
                self.assertEqual(neutral.tobytes(), Image.open(folder / 'frame-007.png').tobytes())
                self.assertNotEqual(neutral.tobytes(), breathe(neutral, 1).tobytes())

    def test_all_frames_are_unclipped_binary_alpha_with_zero_hidden_rgb(self):
        for weapon in TYPES:
            for path in (HERE / weapon / 'export').glob('*/nearest/frame-*.png'):
                with self.subTest(path=str(path.relative_to(HERE))):
                    im = Image.open(path).convert('RGBA')
                    a = np.array(im)
                    self.assertEqual(im.size, (128, 128))
                    self.assertTrue(set(np.unique(a[..., 3])) <= {0, 255})
                    self.assertFalse(a[a[..., 3] == 0].any())
                    x0, y0, x1, y1 = im.getbbox()
                    self.assertGreater(min(x0, y0), 0)
                    self.assertLess(max(x1, y1), 128)

    def test_exported_atlases_match_individual_frames_and_preserve_hit_timing(self):
        for weapon in TYPES:
            out = HERE / weapon / 'export'
            for action in ('idle', 'walk', 'attack', 'death'):
                folder = out / action / 'nearest'
                atlas = json.loads((folder / 'spritesheet.json').read_text())
                sheet = Image.open(folder / 'spritesheet.png')
                for frame in atlas['frames']:
                    r = frame['frame']
                    self.assertEqual(sheet.crop((r['x'], r['y'], r['x']+128, r['y']+128)).tobytes(),
                                     Image.open(folder / frame['filename']).tobytes())
                self.assertEqual(atlas['meta']['repeat'], action in ('idle', 'walk'))
                if action == 'attack':
                    durations = [frame['duration'] for frame in atlas['frames']]
                    self.assertEqual(sum(durations[:3]) / sum(durations), .5)
                    for i in (0, 5):
                        self.assertEqual(Image.open(folder / f'frame-{i:03d}.png').tobytes(),
                                         Image.open(out / 'idle-first.png').tobytes())


if __name__ == '__main__':
    unittest.main()
