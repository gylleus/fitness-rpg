"""Content-tool regressions using synthetic fixtures, independent of curated game data."""

import copy
import json
from pathlib import Path
import tempfile
import unittest

from content import load_content, resolved_export, validate_biome, validate_scenery


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


ENVIRONMENT_FIXTURE = '''
[generation.scene]
canvas = [320, 180]
ground_y = 144
reference_height = 32
view = "orthographic_side"
style = "Fixture style."
avoid = []

[generation.ground]
canvas = [128, 48]
surface_y = 12
edge_margin = 8
repeat_x = true
edge_description = "Level, matching edges."

[[background_layers]]
id = "{biome_id}_sky"
name = "Sky"
visual_description = "A gray sky."
[background_layers.generation]
parallax = 0.0
repeat_x = true
transparent = false
composition = "Fill the canvas."

[[background_layers]]
id = "{biome_id}_banks"
name = "Banks"
visual_description = "Low banks."
[background_layers.generation]
parallax = 0.3
repeat_x = true
transparent = true
composition = "Leave the sky transparent."

[[ground_sections]]
id = "{biome_id}_path"
name = "Path"
visual_description = "A muddy path."
[ground_sections.generation]
composition = "Keep the shared edges."
'''

SCENERY_FIXTURE = '''schema_version = 1
biome_id = "{biome_id}"

[[scenery]]
id = "{biome_id}_tree"
name = "Tree"
visual_description = "A bent tree with exposed roots."
[scenery.generation]
canvas = [64, 128]
height_scale = 2.5
layers = ["behind_path"]
anchor = "ground"
composition = "An isolated tree with a visible root anchor."
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

    def add_scenery(self, biome_id="fixture_a"):
        path = self.root / biome_id / "BIOME.toml"
        path.write_text(path.read_text() + ENVIRONMENT_FIXTURE.format(biome_id=biome_id))
        (path.parent / "SCENERY.toml").write_text(SCENERY_FIXTURE.format(biome_id=biome_id))
        self.replace("catalog.toml", f'enemies_file = "{biome_id}/ENEMIES.toml"',
                     f'enemies_file = "{biome_id}/ENEMIES.toml"\nscenery_file = "{biome_id}/SCENERY.toml"')

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
            self.assertEqual(output["biomes"][0]["scenery"], [])
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

    def test_scene_and_scenery_export_preserves_prose_and_enemy_membership(self):
        before = resolved_export(load_content(self.root), "fixture_a")["biomes"][0]
        self.add_scenery()
        content = load_content(self.root)
        output = json.loads(json.dumps(resolved_export(content, "fixture_a")))["biomes"][0]
        self.assertEqual(output["encounters"], before["encounters"])
        self.assertEqual(output["scenery"][0]["visual_description"], "A bent tree with exposed roots.")
        self.assertEqual(output["scenery"][0]["generation"]["canvas"], [64, 128])
        self.assertEqual([a["id"] for a in output["background_layers"]], ["fixture_a_sky", "fixture_a_banks"])
        self.assertEqual(output["ground_sections"][0]["id"], "fixture_a_path")
        self.assertEqual(content["biomes"]["fixture_b"]["scenery"], [])

    def test_environment_rejects_bad_geometry_and_layer_contracts(self):
        self.add_scenery()
        base = load_content(self.root)["biomes"]["fixture_a"]
        base = {k: v for k, v in base.items() if k not in ("scenery", "encounters")}
        cases = [
            (("generation", "scene", "canvas"), [True, 180]),
            (("generation", "scene", "canvas"), [1025, 180]),
            (("generation", "scene", "canvas"), [1024, 16]),
            (("generation", "scene", "ground_y"), 180),
            (("generation", "scene", "reference_height"), 0),
            (("generation", "ground", "surface_y"), 48),
            (("generation", "ground", "surface_y"), 13),  # Leaves a gap at the scene bottom.
            (("generation", "ground", "edge_margin"), 64),
            (("background_layers", 0, "generation", "transparent"), True),
            (("background_layers", 1, "generation", "transparent"), False),
            (("background_layers", 0, "generation", "parallax"), 0.5),  # Out-of-order depth.
            (("background_layers", 1, "generation", "parallax"), float("nan")),
            (("background_layers", 1, "generation", "parallax"), True),
            (("background_layers", 1, "generation", "repeat_x"), "yes"),
        ]
        for keys, value in cases:
            with self.subTest(field=keys, value=value):
                biome = copy.deepcopy(base)
                parent = biome
                for key in keys[:-1]:
                    parent = parent[key]
                parent[keys[-1]] = value
                with self.assertRaises(ValueError):
                    validate_biome(biome, set())
        for table in ("scene", "ground"):
            with self.subTest(missing=table):
                biome = copy.deepcopy(base)
                del biome["generation"][table]
                with self.assertRaisesRegex(ValueError, "require"):
                    validate_biome(biome, set())

    def test_scenery_rejects_invalid_dimensions_scale_anchors_and_placement(self):
        self.add_scenery()
        biome = load_content(self.root)["biomes"]["fixture_a"]
        for field, value in (("canvas", [64, False]), ("canvas", [16, 1024]),
                             ("height_scale", 0), ("height_scale", float("inf")), ("height_scale", True),
                             ("layers", []), ("layers", ["behind_path", "behind_path"]),
                             ("layers", ["enemy_spawn"]), ("anchor", "unknown")):
            with self.subTest(field=field, value=value):
                library = {"schema_version": 1, "biome_id": "fixture_a", "scenery": copy.deepcopy(biome["scenery"])}
                library["scenery"][0]["generation"][field] = value
                with self.assertRaises(ValueError):
                    validate_scenery(library, biome, set())

    def test_visual_ids_cannot_duplicate_scenery_ground_or_legacy_assets(self):
        self.add_scenery()
        path = self.root / "fixture_a/SCENERY.toml"
        original = path.read_text()
        for duplicate in ("fixture_a_sky", "fixture_a_path", "fixture_a_prop", "fixture_b_prop"):
            with self.subTest(duplicate=duplicate):
                path.write_text(original.replace('id = "fixture_a_tree"', f'id = "{duplicate}"'))
                with self.assertRaisesRegex(ValueError, "duplicate"):
                    load_content(self.root)

    def test_registered_scenery_validates_owner_version_fields_and_path(self):
        self.add_scenery()
        path = self.root / "fixture_a/SCENERY.toml"
        original = path.read_text()
        for before, after, error in (("fixture_a", "wrong_biome", "scenery biome ID mismatch"),
                                     ("schema_version = 1", "schema_version = 2", "unsupported schema_version"),
                                     ("height_scale", "height_scal", "missing fields")):
            with self.subTest(error=error):
                path.write_text(original.replace(before, after, 1))
                with self.assertRaisesRegex(ValueError, error):
                    load_content(self.root)
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            load_content(self.root)
        self.replace("catalog.toml", 'scenery_file = "fixture_a/SCENERY.toml"', 'scenery_file = "../SCENERY.toml"')
        with self.assertRaisesRegex(ValueError, "within the content directory"):
            load_content(self.root)

    def test_empty_scenery_file_does_not_require_scene_art(self):
        self.replace("catalog.toml", 'enemies_file = "fixture_a/ENEMIES.toml"',
                     'enemies_file = "fixture_a/ENEMIES.toml"\nscenery_file = "fixture_a/SCENERY.toml"')
        (self.root / "fixture_a/SCENERY.toml").write_text('schema_version = 1\nbiome_id = "fixture_a"\nscenery = []\n')
        self.assertEqual(load_content(self.root)["biomes"]["fixture_a"]["scenery"], [])


if __name__ == "__main__":
    unittest.main()
