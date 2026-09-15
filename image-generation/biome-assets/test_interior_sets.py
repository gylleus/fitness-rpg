import unittest

from interior_sets import make_set_plan


class InteriorSetTests(unittest.TestCase):
    def test_complete_sets_share_roles_and_keep_distinct_decorations(self):
        libraries = set()
        for theme in ("volcano_tunnel", "frost_cave", "crypt", "castle"):
            plan = make_set_plan(theme, "new_location")
            self.assertEqual(plan, make_set_plan(theme, "new_location"))
            self.assertEqual([a["kind"] for a in plan["assets"]], ["background"]*3 + ["ground", "prop_sheet"])
            sheet = plan["assets"][-1]["sheet"]
            self.assertEqual(sheet["columns"] * sheet["rows"], len(sheet["props"]))
            self.assertEqual(len({p["id"] for p in sheet["props"]}), 8)
            self.assertTrue(all(p["generation"]["anchor"] == "ground" for p in sheet["props"]))
            libraries.add(tuple(p["name"] for p in sheet["props"]))
        self.assertEqual(len(libraries), 4)
