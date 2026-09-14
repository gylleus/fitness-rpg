#!/usr/bin/env python3
"""Import authored frame rectangles/ground anchors into the standard export format.

CPU only. The recipe records manual sheet layout corrections; it never guesses
feet, fits individual poses, interpolates motion, or invents Wan provenance.
"""
from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import re
import sys

from sprites import BASE, save_json, sha256
sys.path.insert(0, str(BASE))
import numpy as np
from PIL import Image
from pixels import convert, fixed_crop, comparison
from asset_palette import palette_contract


def import_sheet(recipe_path, out):
    recipe = json.loads(recipe_path.read_text())
    if not recipe.get("actions") or any(not re.fullmatch(r"[a-z][a-z0-9_]*", key) for key in [recipe["asset_id"], *recipe["actions"]]):
        raise ValueError("A sheet recipe needs safe entity/action IDs and at least one action")
    actions, provenance = {}, {}
    canvas_size, ground = 640, (320, 560)
    for action, spec in recipe["actions"].items():
        source = (recipe_path.parent / spec["image"]).resolve()
        image = Image.open(source).convert("RGBA")
        if sha256(source) != spec["sha256"]:
            raise ValueError(f"Source changed: {source}")
        pixels = np.array(image)
        if "background" in spec:
            key = np.array(spec["background"], dtype=int)
            pixels[..., 3] = (np.abs(pixels[..., :3].astype(int) - key).max(axis=2) > spec["tolerance"]) * 255
            pixels[pixels[..., 3] == 0] = 0
            image = Image.fromarray(pixels)
        sequence = []
        if len(spec["frames"]) != len(spec["durations_ms"]):
            raise ValueError("Each authored frame needs a duration")
        for frame in spec["frames"]:
            x, y, w, h = frame["rect"]
            if min(x, y) < 0 or min(w, h) <= 0 or x+w > image.width or y+h > image.height:
                raise ValueError("Frame rectangle outside source sheet")
            tile = image.crop((x, y, x+w, y+h))
            ox, oy = frame["origin"]
            left, top = round(ground[0]+x-ox), round(ground[1]+y-oy)
            if min(left, top) < 0 or left+w > canvas_size or top+h > canvas_size:
                raise ValueError("Pose exceeds shared import canvas")
            aligned = Image.new("RGBA", (canvas_size, canvas_size))
            aligned.paste(tile, (left, top))
            if aligned.getbbox() is None:
                raise ValueError("Empty imported pose")
            sequence.append(aligned)
        actions[action] = sequence
        provenance[action] = {"source": spec["image"], "sha256": sha256(source)}
    all_frames = [im for seq in actions.values() for im in seq]
    _, box = fixed_crop(all_frames, margin=.06)
    side = box[2]-box[0]
    size = recipe.get("size", 128)
    if type(size) is not int or not 16 <= size <= 256:
        raise ValueError("Use an output size from 16 to 256 pixels")
    pivot = [(ground[i]-box[i])/side for i in (0, 1)]
    idle = actions[recipe.get("reference_action", "idle")][0].getbbox()
    idle_height = (idle[3]-idle[1])*size/side
    manifest = {"asset_id": recipe["asset_id"], "name": recipe["name"],
        "facing": recipe["facing"], "frame_size": [size, size], "pivot": pivot,
        "height_scale": recipe.get("height_scale", 1), "reference_idle_height_px": idle_height,
        "shared_crop": box, "actions": {}, "source": provenance,
        "backend": recipe.get("backend", "authored sheet import"),
        "recipe_sha256": sha256(recipe_path), "palette_contract": palette_contract(),
        "code_sha256": {"sheet_import.py": sha256(Path(__file__)), "pixels.py": sha256(BASE/"pixels.py")},
        "framing": "Explicit source rectangles and ground origins; one union crop/scale for all actions."}
    rows = []
    for action, sequence in actions.items():
        spec = recipe["actions"][action]
        if type(spec["loop"]) is not bool or (action == "death" and spec["loop"]):
            raise ValueError("Actions need explicit loop flags; death cannot loop")
        if any(type(d) is not int or d <= 0 for d in spec["durations_ms"]):
            raise ValueError("Durations must be positive integer milliseconds")
        dest = out / action / "nearest"
        dest.mkdir(parents=True, exist_ok=True)
        frames = [convert(im.crop(box), size, "nearest", color_metric="ciede2000") for im in sequence]
        sheet = Image.new("RGBA", (4*size, math.ceil(len(frames)/4)*size))
        records = []
        for i, frame in enumerate(frames):
            x, y = i % 4*size, i//4*size
            name = f"frame-{i:03d}.png"
            frame.save(dest / name)
            sheet.paste(frame, (x, y))
            records.append({"filename": name, "sha256": sha256(dest/name),
                "frame": {"x": x, "y": y, "w": size, "h": size},
                "duration": spec["durations_ms"][i], "source_frame": i})
        sheet.save(dest / "spritesheet.png")
        save_json(dest / "spritesheet.json", {"frames": records,
            "meta": {"image": "spritesheet.png", "size": {"w": sheet.width, "h": sheet.height}, "repeat": spec["loop"]}})
        manifest["actions"][action] = {"timing": {"repeat": spec["loop"]}}
        frames[0].save(out / f"{action}-first.png")
        frames[0].save(dest / "preview.gif", save_all=True, append_images=frames[1:], duration=spec["durations_ms"], loop=0, disposal=2)
        rows.append((action, [(str(i), frame) for i, frame in enumerate(frames)]))
    comparison(rows, out / "comparison.png")
    save_json(out / "manifest.json", manifest)
    print(f"Imported {recipe['asset_id']}: {len(actions)} actions, {len(all_frames)} frames → {out}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    import_sheet(args.recipe.resolve(), args.out.resolve())
