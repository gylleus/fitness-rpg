"""Bundle selected exported entity atlases for Metro, with optional frame skipping."""
from __future__ import annotations
import argparse
import json
import math
import os
from pathlib import Path
import re
import tempfile

from sprites import REPO, save_json, sha256
from export_sheet import skip_frames
from PIL import Image


def valid_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", value):
        raise ValueError(f"Invalid entity/action ID: {value!r}")
    return value


def bundle(recipe_path, out, registry, frame_step=None):
    recipe = json.loads(recipe_path.read_text())
    catalog = {"schema_version": 1, "entities": {}}
    sources, images = {}, {}
    if not recipe.get("entities"):
        raise ValueError("Bundle recipe needs entities")
    # Validate/render the entire batch before publishing any game asset.
    with tempfile.TemporaryDirectory(prefix="frpg-sprites-") as tmp:
        staging = Path(tmp)
        for spec in recipe["entities"]:
            path = (recipe_path.parent / spec["manifest"]).resolve()
            manifest = json.loads(path.read_text())
            key = valid_id(manifest.get("asset_id", manifest.get("enemy_id")))
            if key in catalog["entities"]:
                raise ValueError(f"Duplicate entity: {key}")
            step = frame_step if frame_step is not None else spec.get("frame_step", 1)
            if type(step) is not int or step < 1:
                raise ValueError("Frame step must be a positive integer")
            size = manifest["frame_size"]
            pivot = manifest["pivot"]
            idle_height = manifest["reference_idle_height_px"]
            height_scale = manifest["height_scale"]
            if len(size) != 2 or any(type(n) is not int or n <= 0 for n in size):
                raise ValueError("Invalid frame size")
            if len(pivot) != 2 or any(not math.isfinite(n) or not 0 <= n <= 1 for n in pivot):
                raise ValueError("Invalid normalized pivot")
            if not math.isfinite(idle_height) or idle_height <= 0 or not math.isfinite(height_scale) or height_scale <= 0:
                raise ValueError("Invalid display scale")
            if manifest["facing"] not in ("left", "right"):
                raise ValueError("Invalid facing")
            entity = {"name": manifest["name"], "facing": manifest["facing"],
                "frameSize": size, "pivot": pivot, "idleHeight": idle_height,
                "heightScale": height_scale, "actions": {}}
            selected = spec.get("actions", list(manifest["actions"]))
            if not selected:
                raise ValueError("Entity needs at least one action")
            sources[key] = {"manifest": os.path.relpath(path, REPO), "sha256": sha256(path), "frame_step": step, "sheets": {}}
            for action in selected:
                valid_id(action)
                if action not in manifest["actions"]:
                    raise ValueError(f"Missing action: {key}/{action}")
                folder = path.parent / action / spec.get("variant", "nearest")
                atlas_path = folder / "spritesheet.json"
                atlas = json.loads(atlas_path.read_text())
                sheet_path = folder / "spritesheet.png"
                sheet = Image.open(sheet_path).convert("RGBA")
                records = atlas["frames"]
                repeat = atlas["meta"]["repeat"]
                if type(repeat) is not bool or (action == "death" and repeat):
                    raise ValueError("Invalid loop flag")
                if not records or any(type(r["duration"]) is not int or r["duration"] <= 0 for r in records):
                    raise ValueError("Invalid frame durations")
                # Check all source cells, including skipped cells, before selecting.
                tiles = []
                for record in records:
                    r = record["frame"]
                    if [r["w"], r["h"]] != size or min(r["x"], r["y"]) < 0 or r["x"]+r["w"] > sheet.width or r["y"]+r["h"] > sheet.height:
                        raise ValueError("Frame rectangle outside atlas")
                    tile = sheet.crop((r["x"], r["y"], r["x"]+r["w"], r["y"]+r["h"]))
                    if tile.getbbox() is None:
                        raise ValueError("Empty atlas frame")
                    if "sha256" in record:
                        original = folder / record["filename"]
                        if sha256(original) != record["sha256"] or Image.open(original).convert("RGBA").tobytes() != tile.tobytes():
                            raise ValueError("Atlas/frame hash mismatch")
                    tiles.append(tile)
                schedule = {"indices": list(range(len(records))), "durations_ms": [r["duration"] for r in records], "repeat": repeat}
                if len(records) > 1:
                    schedule = skip_frames(schedule, step)
                columns = min(8, len(schedule["indices"]))
                packed = Image.new("RGBA", (columns*size[0], math.ceil(len(schedule["indices"])/columns)*size[1]))
                frames = []
                for i, (index, duration) in enumerate(zip(schedule["indices"], schedule["durations_ms"])):
                    x, y = i % columns*size[0], i//columns*size[1]
                    packed.paste(tiles[index], (x, y))
                    frames.append({"x": x, "y": y, "duration": duration, "sourceFrame": records[index]["source_frame"]})
                filename = f"{key}--{action}.png"
                packed.save(staging/filename)
                image_key = f"{key}/{action}"
                images[image_key] = filename
                entity["actions"][action] = {"image": image_key, "loop": repeat,
                    "duration": sum(schedule["durations_ms"]), "frames": frames}
                sources[key]["sheets"][action] = {"atlas_sha256": sha256(atlas_path), "image_sha256": sha256(sheet_path), "output_sha256": sha256(staging/filename)}
            catalog["entities"][key] = entity
        save_json(staging/"catalog.json", catalog)
        save_json(staging/"provenance.json", {"recipe_sha256": sha256(recipe_path), "entities": sources})
        out.mkdir(parents=True, exist_ok=True)
        registry.parent.mkdir(parents=True, exist_ok=True)
        for path in staging.iterdir():
            (out/path.name).write_bytes(path.read_bytes())
        relative = os.path.relpath(out, registry.parent).replace(os.sep, "/")
        imports = "\n".join(f"  {json.dumps(key)}: require({json.dumps(relative+'/'+name)})," for key, name in images.items())
        registry.write_text(f'// Generated by uv run sprites bundle. Do not edit by hand.\nimport catalog from "{relative}/catalog.json";\nimport type {{ SpriteCatalog }} from "./types";\n\nexport const spriteCatalog = catalog as unknown as SpriteCatalog;\nexport const spriteImages: Record<string, number> = {{\n{imports}\n}};\n')
    print(f"Bundled {len(catalog['entities'])} entities / {len(images)} sheets → {out}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, default=REPO/"image-generation/game-sprites.json")
    parser.add_argument("--out", type=Path, default=REPO/"assets/sprites")
    parser.add_argument("--registry", type=Path, default=REPO/"src/sprites/generated.ts")
    parser.add_argument("--frame-step", type=int, help="Keep every Nth already-exported frame; retain one-shot endpoints and total duration")
    args = parser.parse_args(argv)
    bundle(args.recipe.resolve(), args.out.resolve(), args.registry.resolve(), args.frame_step)


if __name__ == "__main__":
    main()
