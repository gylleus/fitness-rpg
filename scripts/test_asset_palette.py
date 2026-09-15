import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import asset_palette as palette
from export_static_asset import export_static, reexport_items


class AssetPaletteTests(unittest.TestCase):
    def test_exact_colors_and_alpha_survive_and_mapping_is_idempotent(self):
        colors = palette.palette_colors()
        rgba = np.concatenate([colors, np.arange(1, len(colors) + 1, dtype=np.uint8)[:, None]], axis=1)[None]
        image = Image.fromarray(rgba)
        self.assertEqual(palette.map_palette(image).tobytes(), image.tobytes())
        noisy = Image.fromarray(np.random.default_rng(14).integers(0, 256, (17, 29, 4), dtype=np.uint8))
        result = palette.map_palette(noisy)
        palette.validate_image(result)
        self.assertEqual(noisy.getchannel('A').tobytes(), result.getchannel('A').tobytes())
        self.assertEqual(result.tobytes(), palette.map_palette(result).tobytes())

    def test_invisible_rgb_is_ignored_but_faint_visible_rgb_is_validated(self):
        image = Image.new('RGBA', (2, 1), (1, 2, 3, 0))
        palette.validate_image(image)
        image.putpixel((0, 0), (1, 2, 3, 1))
        with self.assertRaisesRegex(ValueError, 'outside ENDESGA 32'):
            palette.validate_image(image)
        result = palette.map_palette(image)
        self.assertEqual(result.getpixel((1, 0)), (0, 0, 0, 0))
        palette.validate_image(result)

    def test_one_master_switch_changes_mapping_guidance_and_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            master = Path(tmp) / 'palette.json'
            master.write_text(json.dumps({'name': 'Test palette', 'colors': ['#000000', '#ffffff']}))
            with patch.object(palette, 'PALETTE', master):
                image = palette.map_palette(Image.new('RGB', (3, 1), (50, 110, 160)))
                palette.validate_image(image)
                self.assertIn('Test palette', palette.palette_guidance())
                self.assertEqual(palette.palette_contract()['name'], 'Test palette')
                first = palette.palette_contract()['sha256']
                master.write_text(json.dumps({'name': 'Changed', 'colors': ['#112233', '#445566']}))
                self.assertNotEqual(first, palette.palette_contract()['sha256'])
                self.assertIn(palette.map_palette(image).getpixel((0, 0)), [(17, 34, 51), (68, 85, 102)])
            with self.assertRaisesRegex(ValueError, 'Per-asset palettes'):
                palette.map_palette(image, np.array([[0, 0, 0], [255, 255, 255]], dtype=np.uint8))

    def test_static_export_retains_geometry_alpha_and_source_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, out = root / 'source.png', root / 'export.png'
            pixels = np.random.default_rng(2).integers(0, 256, (9, 17, 4), dtype=np.uint8)
            Image.fromarray(pixels).save(source)
            original = source.read_bytes()
            info = export_static(source, out)
            result = Image.open(out)
            self.assertEqual(result.size, (17, 9))
            np.testing.assert_array_equal(np.asarray(result)[..., 3], pixels[..., 3])
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(info['palette'], palette.palette_contract())
            palette.validate_image(result)

    def test_item_migration_archives_missing_master_and_reuses_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / 'assets/items/test.png'
            output.parent.mkdir(parents=True)
            Image.new('RGBA', (64, 64), (60, 80, 90, 255)).save(output)
            original = output.read_bytes()
            record_path = root / 'image-generation/items/v1/provenance/test.json'
            record_path.parent.mkdir(parents=True)
            record_path.write_text(json.dumps({'icon': 'assets/items/test.png', 'original': 'missing.png',
                'icon_sha256': palette.hashlib.sha256(original).hexdigest(), 'export': '64x64'}))
            with patch('export_static_asset.ROOT', root):
                reexport_items()
                first = record_path.read_text()
                reexport_items()
                self.assertEqual(first, record_path.read_text())
            record = json.loads(first)
            self.assertEqual((root / record['palette_export']['source']).read_bytes(), original)
            self.assertFalse(record['palette_export']['resized_from_master'])
            palette.validate_image(Image.open(output))


if __name__ == '__main__':
    unittest.main()
