"""Regeneration contracts using temporary runs and authored pixels, without inference."""
import argparse
from contextlib import redirect_stderr
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

import sprites
import run_state


class ForceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.definition = self.root / "prop.toml"
        self.definition.write_text('schema_version = 1\n[[assets]]\nid = "chest"\n'
                                   'name = "Chest"\nkind = "prop"\n'
                                   'visual_description = "A squat wooden chest."\n')
        self.reference = self.root / "chest.png"
        Image.new("RGBA", (32, 32), "red").save(self.reference)
        self.args = argparse.Namespace(run=self.root / "run", definition=self.definition,
            reference=self.reference, size=None, frame_step=None, facing=None, asset=None,
            actions=None, seed=1, reference_lora=.65, captions=None, force=False)

    def old_run(self):
        sprites.plan(self.args)
        self.marker = self.args.run / "sprites.zip"
        self.marker.write_bytes(b"old export")
        self.old_config = (self.args.run / "config.json").read_bytes()
        self.args.force = True

    def assert_old_run(self):
        self.assertEqual(self.marker.read_bytes(), b"old export")
        self.assertEqual((self.args.run / "config.json").read_bytes(), self.old_config)

    def cli(self, *extra):
        return subprocess.run([sys.executable, str(sprites.ROOT / "sprites.py"), "reference",
            "--definition", str(self.definition), "--reference", str(self.reference),
            "--run", str(self.args.run), *extra], capture_output=True, text=True)

    def test_reference_cli_resumes_rejects_changes_and_force_regenerates(self):
        first = self.cli()
        self.assertEqual(first.returncode, 0, first.stderr)
        output = self.args.run / "references/chest/pixel-reference.png"
        original_pixels = output.read_bytes()
        original_config = (self.args.run / "config.json").read_bytes()
        for name in ("animations/stale.png", "exports/stale.png", "sprites.zip", "selection.json"):
            path = self.args.run / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"{}" if name == "selection.json" else b"stale output")
        resumed = self.cli()
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertIn("already verified", resumed.stdout)
        self.assertTrue((self.args.run / "sprites.zip").exists())
        Image.new("RGBA", (32, 32), "blue").save(self.reference)
        self.definition.write_text(self.definition.read_text().replace("wooden", "iron-bound"))
        rejected = self.cli()
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("--force", rejected.stderr)
        self.assertEqual(output.read_bytes(), original_pixels)
        self.assertEqual((self.args.run / "config.json").read_bytes(), original_config)
        replaced = self.cli("--force")
        self.assertEqual(replaced.returncode, 0, replaced.stderr)
        self.assertIn("Replaced entire run", replaced.stdout)
        self.assertEqual(output.read_bytes(), self.reference.read_bytes())
        self.assertIn("iron-bound", sprites.load(self.args.run)["source"]["text"])
        self.assertTrue((self.args.run / "reference-review.html").exists())
        for name in ("animations", "exports", "sprites.zip", "selection.json", "originals"):
            self.assertFalse((self.args.run / name).exists(), name)

    def test_force_replaces_identical_plan_and_keeps_seed(self):
        self.old_run()
        sprites.plan(self.args)
        self.assertFalse(self.marker.exists())
        self.assertEqual((self.args.run / "config.json").read_bytes(), self.old_config)
        self.assertEqual((self.args.run / "inputs/chest/image.png").read_bytes(), self.reference.read_bytes())

    def test_invalid_recipe_settings_and_pixels_leave_old_run(self):
        self.old_run()
        self.args.actions = ["missing"]
        with self.assertRaisesRegex(ValueError, "Actions"):
            sprites.plan(self.args)
        self.assert_old_run()
        self.args.actions = None
        self.args.reference = self.root / "missing.png"
        with self.assertRaises(FileNotFoundError):
            sprites.plan(self.args)
        self.assert_old_run()
        self.definition.write_text("invalid toml")
        with self.assertRaises(ValueError):
            sprites.plan(self.args)
        self.assert_old_run()

    def test_staging_and_install_failures_preserve_old_run(self):
        self.old_run()
        with patch.object(run_state, "snapshot_inputs", side_effect=OSError("copy failed")):
            with self.assertRaisesRegex(OSError, "copy failed"):
                sprites.plan(self.args)
        self.assert_old_run()
        rename = Path.rename

        def fail_install(path, target):
            if path.name == "next":
                raise OSError("install failed")
            return rename(path, target)

        with patch.object(Path, "rename", fail_install):
            with self.assertRaisesRegex(OSError, "install failed"):
                sprites.plan(self.args)
        self.assert_old_run()
        self.assertFalse(list(self.root.glob(".run-reset-*")))

    def test_inputs_inside_run_are_rejected_before_cleanup(self):
        self.old_run()
        inside = self.args.run / "selected.png"
        inside.write_bytes(self.reference.read_bytes())
        recipe = self.args.run / "recipe.toml"
        recipe.write_bytes(self.definition.read_bytes())
        for overrides in ({"reference": inside}, {"definition": recipe},
                          {"reference": None, "guide_image": inside, "guide_strength": .6}):
            with self.subTest(overrides=overrides):
                args = argparse.Namespace(**(vars(self.args) | overrides))
                with self.assertRaisesRegex(ValueError, "Copy it outside --run"):
                    sprites.plan(args)
                self.assert_old_run()
                self.assertTrue(inside.exists())
                self.assertTrue(recipe.exists())

    def test_force_rejects_unknown_directories_and_symlinks(self):
        self.args.force = True
        self.args.run.mkdir()
        keep = self.args.run / "keep.txt"
        keep.write_text("unrelated")
        with self.assertRaisesRegex(ValueError, "existing sprite run"):
            sprites.plan(self.args)
        self.assertEqual(keep.read_text(), "unrelated")
        alias = self.root / "alias"
        alias.symlink_to(self.args.run, target_is_directory=True)
        self.args.run = alias
        with self.assertRaisesRegex(ValueError, "symlinked"):
            sprites.plan(self.args)
        self.assertEqual(keep.read_text(), "unrelated")

    def test_force_allows_new_and_empty_directories(self):
        self.args.force = True
        sprites.plan(self.args)
        self.assertTrue((self.args.run / "config.json").exists())
        self.args.run = self.root / "empty"
        self.args.run.mkdir()
        sprites.plan(self.args)
        self.assertTrue((self.args.run / "config.json").exists())

    def test_force_protects_project_and_external_symlink_targets(self):
        self.old_run()
        external = self.root / "external"
        external.mkdir()
        keep = external / "keep.txt"
        keep.write_text("keep")
        (self.args.run / "linked-output").symlink_to(external, target_is_directory=True)
        sprites.plan(self.args)
        self.assertEqual(keep.read_text(), "keep")
        self.args.run = sprites.REPO
        with self.assertRaisesRegex(ValueError, "project, home or working directory"):
            sprites.plan(self.args)

    def test_all_and_enemy_adapter_force_reach_the_planner(self):
        import enemy_adapter
        for enemy in (False, True):
            with self.subTest(enemy=enemy):
                argv = ["sprites", "all", "--force", "--run", str(self.args.run)]
                argv += ["--roster", "roster.toml"] if enemy else ["--definition", str(self.definition)]
                module = enemy_adapter if enemy else sprites
                with patch.object(sys, "argv", argv), patch.object(module, "plan") as plan, \
                        patch.object(sprites, "child") as child:
                    sprites.main(enemy_adapter=enemy)
                self.assertTrue(plan.call_args.args[0].force)
                self.assertEqual([call.args[0] for call in child.call_args_list],
                                 ["references", "prepare", "animate", "export", "review", "package"])

    def test_cli_force_requires_planning_command_source_and_explicit_run(self):
        invalid = [
            (["animate", "--run", str(self.args.run), "--force"], False),
            (["reference", "--run", str(self.args.run), "--force"], False),
            (["plan", "--roster", "unused.toml", "--force"], True),
        ]
        for argv, enemy_adapter in invalid:
            with self.subTest(argv=argv), patch.object(sys, "argv", ["sprites", *argv]), \
                    redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                sprites.main(enemy_adapter=enemy_adapter)
            self.assertEqual(error.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
