from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from biome_assets import make_plan, prepare, save, sha
from interiors import make_interior_plan, prepared_scene, validate_scene


class InteriorTests(unittest.TestCase):
    def test_all_themes_share_layer_contract_but_keep_distinct_materials(self):
        materials = set()
        for theme in ("limestone_tunnel", "frost_cave", "volcano_tunnel", "crypt", "castle"):
            plan = make_interior_plan(theme)
            self.assertEqual(plan, make_interior_plan(theme))
            self.assertEqual([a["transparent"] for a in plan["assets"]], [False, True, True])
            self.assertEqual([a["export"]["resolution"] for a in plan["assets"]], ["world"] * 3)
            self.assertEqual([a["parallax"] for a in plan["interior"]["layers"]], [.1, .32, .68])
            for asset in plan["assets"]:
                self.assertIn(plan["style"]["background"], asset["prompt"])
                self.assertIn(plan["style"]["style"], asset["prompt"])
            materials.add(plan["assets"][0]["source_definition"]["visual_description"])
        self.assertEqual(len(materials), 5)

    def test_canonical_cave_planning_uses_interior_recipe(self):
        plan = make_plan("hollow_delve", "background")
        self.assertIn("interior", plan)
        self.assertEqual([a["id"] for a in plan["assets"]], ["hollow_delve_depth", "hollow_delve_wall", "hollow_delve_roof"])

    def test_world_resolution_and_measured_roof_anchor_survive_preparation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = make_interior_plan("limestone_tunnel")
            save(root / "plan.json", plan)
            sources = {"schema_version": 1, "plan_sha256": sha(root / "plan.json"), "assets": {}}
            for asset in plan["assets"]:
                width, height = (1600, 600) if asset["id"].endswith("roof") else (1600, 900)
                pixels = np.full((height, width, 4), (40, 50, 60, 255), dtype=np.uint8)
                if asset["transparent"]:
                    pixels[height*2//3:, :, 3] = 0
                image = root / f"{asset['id']}.png"
                Image.fromarray(pixels).save(image)
                sources["assets"][asset["id"]] = {"image": image.name, "sha256": sha(image),
                    "prompt_sha256": asset["prompt_sha256"], "backend": "test"}
            save(root / "sources.json", sources)
            manifest = prepare(root / "plan.json", root / "sources.json", root / "prepared")
            self.assertEqual(manifest["assets"]["limestone_tunnel_depth"]["size"], [960, 540])
            self.assertEqual(manifest["interior"]["layers"][2]["origin_y"], 160)
            self.assertEqual(manifest, prepare(root / "plan.json", root / "sources.json", root / "prepared"))

    def test_ceiling_must_connect_to_top_and_leave_clearance(self):
        plan = make_interior_plan("crypt")
        images = {asset["id"]: Image.new("RGBA", (64, 36), (30, 40, 50, 255)) for asset in plan["assets"]}
        with self.assertRaisesRegex(ValueError, "transparent clearance"):
            prepared_scene(plan, images)
        images["crypt_roof"] = Image.new("RGBA", (64, 24))
        with self.assertRaisesRegex(ValueError, "transparent clearance"):
            prepared_scene(plan, images)
        roof = images["crypt_roof"]
        roof.paste((30, 40, 50, 255), (0, 4, 64, 16))
        resolved = prepared_scene(plan, images)["layers"][2]
        self.assertEqual(resolved["cap_y"], 40)
        self.assertEqual(resolved["origin_y"], 160)

    def test_invalid_geometry_and_parallax_rejected(self):
        plan = make_interior_plan("castle")
        for value in (-1, float("nan"), 1.1):
            scene = deepcopy(plan["interior"])
            scene["layers"][0]["parallax"] = value
            with self.assertRaises(ValueError):
                validate_scene(scene)
        scene = deepcopy(plan["interior"])
        scene["ceiling_clearance"] = 64
        with self.assertRaisesRegex(ValueError, "room for actors"):
            validate_scene(scene)


if __name__ == "__main__":
    unittest.main()
