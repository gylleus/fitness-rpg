"""Persist plans, or replace a run after validating and staging its new inputs."""
import json
from pathlib import Path
import shutil
import tempfile

from sprites import REPO, entries, save_json
from reference_assets import snapshot_inputs


def validate_reset(run, args, config, copies):
    if run.is_symlink():
        raise ValueError("--force cannot replace a symlinked run directory")
    run = run.resolve()
    for protected in (REPO, Path.cwd(), Path.home()):
        if protected == run or run in protected.parents:
            raise ValueError(f"--force cannot replace a project, home or working directory: {run}")
    if run.exists():
        if not run.is_dir():
            raise ValueError("--run must be a directory")
        if any(run.iterdir()):
            target = run / "config.json"
            try:
                previous = json.loads(target.read_text()) if not target.is_symlink() else None
            except (OSError, ValueError):
                previous = None
            if (not isinstance(previous, dict) or previous.get("schema_version") not in (1, 2)
                    or not isinstance(previous.get("assets", previous.get("enemies")), list)
                    or not all(isinstance(previous.get(k), dict) for k in
                               ("reference_generation", "animation_generation", "export"))):
                raise ValueError("--force only replaces an existing sprite run or an empty directory")

    inputs = [getattr(args, key, None) for key in
              ("definition", "roster", "captions", "motions", "reference", "reference_inputs",
               "reference_guides", "guide_image")]
    if config["source"].get("adapter") == "enemy-roster":
        inputs.append(args.content_dir)
    inputs.extend(source for source, _, _ in copies)
    for entry in entries(config):
        if entry.get("reference_input"):
            inputs.append(Path(entry["reference_input"]["origin"]))
        if entry.get("reference_guide"):
            inputs.append(run / entry["reference_guide"]["image"])
    for source in inputs:
        if source is not None and Path(source).resolve().is_relative_to(run):
            raise ValueError(f"--force would delete an input: {source}. Copy it outside --run first.")


def save_plan(args, config, copies):
    run = args.run
    target = run / "config.json"
    if not getattr(args, "force", False):
        run.mkdir(parents=True, exist_ok=True)
        if target.exists() and json.loads(target.read_text()) != config:
            raise ValueError("Run already has different inputs/settings. Choose a new --run directory "
                             "or use --force to replace the entire run.")
        snapshot_inputs(run, copies)
        save_json(target, config)
        return

    validate_reset(run, args, config, copies)
    run.parent.mkdir(parents=True, exist_ok=True)
    # Stage on the same filesystem. Validation/copy failures leave the old run intact.
    with tempfile.TemporaryDirectory(prefix=f".{run.name}-reset-", dir=run.parent) as temp:
        staged = Path(temp) / "next"
        # Keep the backup outside automatic cleanup in case a rollback itself fails.
        previous = Path(temp).with_name(Path(temp).name + "-previous")
        staged.mkdir()
        snapshot_inputs(staged, copies)
        save_json(staged / "config.json", config)
        replaced = run.exists()
        if replaced:
            run.rename(previous)
        try:
            staged.rename(run)
        except OSError:
            if replaced:
                previous.rename(run)
            raise
        if replaced:
            shutil.rmtree(previous)
    if replaced:
        print(f"Replaced entire run: {run}", flush=True)
