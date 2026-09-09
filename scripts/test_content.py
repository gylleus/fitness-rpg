"""Content-tool regressions using synthetic fixtures, independent of curated game data."""

import copy
import json
from pathlib import Path
import tempfile
import unittest

from content import load_content, resolved_export


BIOME_FIXTURE = '''schema_version = 1
id = "{biome_id}"
name = "Test biome"
short_description = "Fixture summary."
description = "Fixture description."
sites = []
decorations = []

[[props]]
id = "{biome_id}_prop"
name = "Test prop"
description = "Fixture prop."

[setting]
terrain = "Fixture terrain."
inhabitants = "Fixture inhabitants."
supernatural = "Fixture detail."
environmental_pressure_and_humor = "Fixture tone."

[visual]
lighting = "Fixture light."
materials = ["stone"]
weather = "Fixture weather."
ambient_sounds = ["wind"]
ambient_motion = "Fixture motion."
palette = [{{ name = "gray", color = "#808080" }}]

[generation]
composition = "Fixture composition."
'''

ENEMY_FIXTURE = '''schema_version = 1
biome_id = "{biome_id}"

[[encounters]]
enemy_id = "{enemy_id}"

[[enemies]]
id = "{enemy_id}"
name = "Test enemy"
family = "beast"
rank = "common"
tier = 1
balance = "draft"
description = "Fixture description."
visual_description = "A gray test creature."
quirk = "Fixture behavior."
fallback_sprite = "wolf"
stats = {{ health = 10, attack = 1, gold = 0, xp = 0 }}

[enemies.visual]
height_scale = 1.0
silhouette = "Fixture outline."
appearance = "Fixture appearance."
equipment = []
palette = ["#808080"]
idle = "Fixture idle."
attack = "Fixture attack."
'''


class ContentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        manifest = "schema_version = 1\n"
        for suffix in ("a", "b"):
            biome_id, enemy_id = f"fixture_{suffix}", f"test_enemy_{suffix}"
            directory = self.root / biome_id
            directory.mkdir()
            (directory / "BIOME.toml").write_text(BIOME_FIXTURE.format(biome_id=biome_id))
            (directory / "ENEMIES.toml").write_text(ENEMY_FIXTURE.format(biome_id=biome_id, enemy_id=enemy_id))
            manifest += (f'\n[[biomes]]\nid = "{biome_id}"\n'
                         f'biome_file = "{biome_id}/BIOME.toml"\n'
                         f'enemies_file = "{biome_id}/ENEMIES.toml"\n')
        (self.root / "catalog.toml").write_text(manifest)

    def replace(self, filename, before, after):
        path = self.root / filename
        text = path.read_text()
        self.assertIn(before, text)
        path.write_text(text.replace(before, after, 1))

    def test_empty_catalog_needs_no_shared_roster_or_biome_directory(self):
        empty = self.root / "empty"
        empty.mkdir()
        (empty / "catalog.toml").write_text("schema_version = 1\nbiomes = []\n")
        content = load_content(empty)
        self.assertEqual(content["biomes"], {})
        self.assertEqual(content["enemies"], {})
        self.assertEqual(content["dungeons"], [])
        output = resolved_export(content)
        self.assertEqual(output["biomes"], [])
        self.assertEqual(output["art"], {})
        self.assertEqual(output["combat"], {})

    def test_export_resolves_local_definitions_without_a_shared_roster(self):
        content = load_content(self.root)
        before = copy.deepcopy(content)
        for biome_id in ("fixture_a", "fixture_b"):
            output = json.loads(json.dumps(resolved_export(content, biome_id)))
            self.assertEqual([b["id"] for b in output["biomes"]], [biome_id])
            for encounter in output["biomes"][0]["encounters"]:
                self.assertEqual(encounter["enemy"], content["enemies"][encounter["enemy_id"]])
        self.assertEqual(content, before)

    def test_reference_to_another_biomes_later_definition(self):
        self.replace("fixture_a/ENEMIES.toml", 'enemy_id = "test_enemy_a"', 'enemy_id = "test_enemy_b"')
        result = resolved_export(load_content(self.root), "fixture_a")
        self.assertEqual(result["biomes"][0]["encounters"][0]["enemy"]["id"], "test_enemy_b")

    def test_explicit_missing_shared_file_is_not_silently_ignored(self):
        self.replace("catalog.toml", "schema_version = 1", 'schema_version = 1\nshared_enemies_file = "missing.toml"')
        with self.assertRaises(FileNotFoundError):
            load_content(self.root)

    def test_missing_reference_fails(self):
        self.replace("fixture_a/ENEMIES.toml", 'enemy_id = "test_enemy_a"', 'enemy_id = "unknown_enemy"')
        with self.assertRaisesRegex(ValueError, "unknown enemy ID"):
            load_content(self.root)

    def test_duplicate_definition_across_files_fails(self):
        self.replace("fixture_b/ENEMIES.toml", '\nid = "test_enemy_b"', '\nid = "test_enemy_a"')
        with self.assertRaisesRegex(ValueError, "duplicate enemy ID"):
            load_content(self.root)

    def test_bool_is_not_an_integer_stat(self):
        self.replace("fixture_a/ENEMIES.toml", "health = 10", "health = true")
        with self.assertRaisesRegex(ValueError, "stats.health"):
            load_content(self.root)

    def test_unknown_version_and_misspelled_field_fail(self):
        self.replace("fixture_a/BIOME.toml", "schema_version = 1", "schema_version = 99")
        with self.assertRaisesRegex(ValueError, "unsupported schema_version"):
            load_content(self.root)
        self.replace("fixture_a/BIOME.toml", "schema_version = 99", "schema_version = 1")
        self.replace("fixture_a/BIOME.toml", "lighting =", "ligthing =")
        with self.assertRaisesRegex(ValueError, "missing fields.*lighting"):
            load_content(self.root)

    def test_duplicate_asset_id_across_biomes_fails(self):
        self.replace("fixture_b/BIOME.toml", 'id = "fixture_b_prop"', 'id = "fixture_a_prop"')
        with self.assertRaisesRegex(ValueError, "duplicate"):
            load_content(self.root)

    def test_unknown_biome_does_not_silently_export_everything(self):
        with self.assertRaisesRegex(ValueError, "unknown biome ID"):
            resolved_export(load_content(self.root), "unknown_biome")


if __name__ == "__main__":
    unittest.main()
