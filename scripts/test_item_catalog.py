import json
from pathlib import Path
import tempfile
import tomllib
import unittest

from item_catalog import KINDS, WEAPON_TYPES, ROOT, load_items, runtime_catalog, icon_prompts


class ItemCatalogTest(unittest.TestCase):
    def setUp(self):
        self.root = ROOT / 'content'
        self.files = tomllib.loads((self.root / 'catalog.toml').read_text())['item_files']

    def test_catalog_and_exports_are_complete_and_current(self):
        items = load_items(self.root, self.files)
        self.assertGreaterEqual(len(items), 192)
        self.assertEqual({item['category'] for item in items.values()}, set(KINDS) - {'fist_weapons'})
        for category in {item['category'] for item in items.values()}:
            self.assertGreaterEqual(sum(item['category'] == category for item in items.values()), 24)
        self.assertEqual(runtime_catalog(items), json.loads((ROOT / 'src/game/catalog/items.json').read_text()))
        self.assertEqual(icon_prompts(items), json.loads((ROOT / 'image-generation/items/v1/prompts.json').read_text()))
        self.assertEqual(len({item['visual_description'] for item in items.values()}), len(items))
        self.assertEqual({mod['stat'] for item in items.values() for mod in item['modifiers']},
                         {'health', 'armor', 'damage', 'pushup_damage_coefficient', 'crit_chance_bps', 'crit_damage_bps'})

    def test_rejects_duplicate_paths_missing_files_and_path_escape(self):
        for files in [[self.files[0], self.files[0]], ['missing.toml'], ['../package.json']]:
            with self.subTest(files=files), self.assertRaises((ValueError, OSError)):
                load_items(self.root, files)

    def test_weapon_classes_export_for_each_supported_library(self):
        source = (self.root / self.files[0]).read_text()
        for category, weapon_type in WEAPON_TYPES.items():
            with self.subTest(category=category), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'items.toml').write_text(source.replace('category = "maces"', f'category = "{category}"'))
                definitions = runtime_catalog(load_items(root, ['items.toml']))['items']
                self.assertEqual({item['weaponType'] for item in definitions.values()}, {weapon_type})

    def test_rejects_invalid_stats_modifiers_and_generation_contracts(self):
        source = (self.root / self.files[0]).read_text()
        for old, new in [
            ('damage_min = 20', 'damage_min = -1'), ('damage_max = 30', 'damage_max = 1'),
            ('tier = 1', 'tier = true'), ('rarity = "common"', 'rarity = "unknown"'),
            ('canvas = [64, 64]', 'canvas = [64, 128]'), ('transparent = true', 'transparent = false'),
            ('modifiers = []', 'modifiers = [{ stat = "crit_chance_bps", value = 10001 }]'),
            ('modifiers = []', 'modifiers = [{ stat = "mystery", value = 2 }]'),
            ('modifiers = []', 'modifiers = [{ stat = "health", value = 2 }, { stat = "health", value = 3 }]'),
        ]:
            with self.subTest(new=new), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'items.toml').write_text(source.replace(old, new, 1))
                with self.assertRaises(ValueError):
                    load_items(root, ['items.toml'])


if __name__ == '__main__':
    unittest.main()
