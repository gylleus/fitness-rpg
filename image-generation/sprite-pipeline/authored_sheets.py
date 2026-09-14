"""Extract authored poses using portable recipes, then use the shared atlas importer.

No biome IDs, inferred motion, per-frame fitting, or model execution lives here.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re

import numpy as np
from PIL import Image
from scipy import ndimage

from sprites import save_json, sha256
from sheet_import import import_sheet


def extract(path, spec):
    if sha256(path) != spec["sha256"]:
        raise ValueError(f"Source checksum changed: {path}")
    pixels = np.array(Image.open(path).convert("RGBA"))
    mask_spec = spec["mask"]
    if mask_spec["kind"] == "alpha":
        mask = pixels[..., 3] > mask_spec["threshold"]
    elif mask_spec["kind"] == "color_key":
        key = np.array(mask_spec["color"], dtype=np.int16)
        mask = (np.abs(pixels[..., :3].astype(np.int16) - key).max(axis=2) > mask_spec["tolerance"]) & (pixels[..., 3] > 0)
    else:
        raise ValueError("Mask kind must be alpha or color_key")
    labels, _ = ndimage.label(mask, np.ones((3, 3)))
    areas = np.bincount(labels.ravel())
    objects = ndimage.find_objects(labels)
    subjects = []
    for label in np.flatnonzero(areas[1:] > spec["min_area"]) + 1:
        ys, xs = objects[label - 1]
        subjects.append((int(label), [xs.start, ys.start, xs.stop, ys.stop]))
    columns, rows = spec["columns"], spec["rows"]
    if len(subjects) != columns * rows:
        raise ValueError(f"Expected {columns * rows} connected poses, got {len(subjects)}: {path}")
    subjects.sort(key=lambda item: item[1][1] + item[1][3])
    subjects = [item for row in range(rows) for item in sorted(
        subjects[row*columns:(row+1)*columns], key=lambda item: item[1][0])]
    poses = []
    for label, box in subjects:
        x0, y0, x1, y1 = box
        rgba = pixels[y0:y1, x0:x1].copy()
        rgba[..., 3] = (labels[y0:y1, x0:x1] == label).astype(np.uint8) * 255
        rgba[rgba[..., 3] == 0] = 0
        poses.append(Image.fromarray(rgba))
    return {"poses": poses, "boxes": [box for _, box in subjects],
            "column_width": pixels.shape[1] / columns,
            "size": [pixels.shape[1], pixels.shape[0]],
            "removed_detached_pixels": int(sum(areas[1:]) - sum(areas[label] for label, _ in subjects))}


def positive(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def validate(recipe):
    if recipe.get("schema_version") != 1 or not recipe.get("assets"):
        raise ValueError("Expected schema_version 1 and nonempty assets")
    ids = set()
    for asset in recipe["assets"]:
        key = asset["id"]
        if not re.fullmatch(r"[a-z][a-z0-9_]*", key) or key in ids:
            raise ValueError(f"Invalid or duplicate asset ID: {key}")
        ids.add(key)
        if asset["scale_mode"] not in ("source", "ready_pose"):
            raise ValueError("scale_mode must be source or ready_pose")
        if asset["facing"] not in ("left", "right") or not positive(asset["height_scale"]):
            raise ValueError("Invalid facing or height_scale")
        if type(asset["size"]) is not int or not 16 <= asset["size"] <= 256:
            raise ValueError("size must be 16..256")
        if not asset["actions"] or not asset["sources"]:
            raise ValueError("An asset needs sources and actions")
        for spec in asset["sources"].values():
            if any(type(spec[k]) is not int or spec[k] < 1 for k in ("columns", "rows")):
                raise ValueError("Source grid dimensions must be positive integers")
            if not positive(spec["min_area"]):
                raise ValueError("min_area must be positive")
            mask = spec["mask"]
            if mask["kind"] == "alpha":
                if type(mask["threshold"]) is not int or not 0 <= mask["threshold"] < 255:
                    raise ValueError("Invalid alpha threshold")
            elif mask["kind"] == "color_key":
                if len(mask["color"]) != 3 or any(type(n) is not int or not 0 <= n <= 255 for n in mask["color"]):
                    raise ValueError("Invalid color key")
                if type(mask["tolerance"]) is not int or not 0 <= mask["tolerance"] < 255:
                    raise ValueError("Invalid color tolerance")
            else:
                raise ValueError("Mask kind must be alpha or color_key")
        for action, spec in asset["actions"].items():
            if not re.fullmatch(r"[a-z][a-z0-9_]*", action):
                raise ValueError(f"Invalid action ID: {action}")
            source = asset["sources"][spec["source"]]
            indices = spec["indices"]
            if not indices or len(set(indices)) != len(indices) or any(type(i) is not int or not 0 <= i < source["rows"] * source["columns"] for i in indices):
                raise ValueError("Pose indices must be unique and inside the source grid")
            if len(spec["durations_ms"]) != len(indices) or not all(positive(n) for n in spec["durations_ms"]):
                raise ValueError("Every pose needs a positive duration")
            if type(spec["loop"]) is not bool or (action == "death" and spec["loop"]):
                raise ValueError("Invalid loop flag; death must be one-shot")
            for field in ("ground_contacts_y", "lift"):
                values = spec.get(field)
                if values is not None and (len(values) != len(indices) or any(type(n) not in (int, float) or not math.isfinite(n) for n in values)):
                    raise ValueError(f"{field} needs one finite value per pose")
            if "ground_contacts_y" in spec and "lift" in spec:
                raise ValueError("Choose ground_contacts_y or lift, not both")


def align(asset, sources):
    """Prepare all action layouts in memory so errors cannot leave partial exports."""
    actions = {}
    for action, spec in asset["actions"].items():
        source = sources[spec["source"]]
        actions[action] = {**source, "poses": [source["poses"][i] for i in spec["indices"]],
                           "boxes": [source["boxes"][i] for i in spec["indices"]]}
    heights = {action: data["poses"][0].height for action, data in actions.items()}
    target = None
    if asset["scale_mode"] == "ready_pose":
        target = min(360, *[min(580 * heights[action] / pose.width, 510 * heights[action] / pose.height)
                            for action, data in actions.items() for pose in data["poses"]])
        for action, data in actions.items():
            first = data["boxes"][0]
            spec = asset["actions"][action]
            columns = asset["sources"][spec["source"]]["columns"]
            center = (first[0] + first[2]) / 2 - (spec["indices"][0] % columns) * data["column_width"]
            for i, box in enumerate(data["boxes"]):
                anchor = center + (spec["indices"][i] % columns) * data["column_width"]
                extent = max(anchor - box[0], box[2] - anchor)
                if extent <= 0:
                    raise ValueError("Pose does not overlap its authored column anchor")
                target = min(target, 296 * heights[action] / extent)
    result = {}
    for action, data in actions.items():
        spec = asset["actions"][action]
        source_spec = asset["sources"][spec["source"]]
        factor = target / heights[action] if target is not None else 1
        first = (data if target is not None else sources[spec["source"]])["boxes"][0]
        center = (first[0] + first[2]) / 2
        if target is not None:
            center -= (spec["indices"][0] % source_spec["columns"]) * data["column_width"]
        sheet = Image.new("RGBA", (2560, math.ceil(len(data["poses"]) / 4) * 640))
        frames = []
        for i, (pose, box) in enumerate(zip(data["poses"], data["boxes"])):
            size = (round(pose.width * factor), round(pose.height * factor))
            if min(size) < 1:
                raise ValueError("Pose disappears at the requested scale")
            tile = pose.resize(size, Image.Resampling.NEAREST)
            column = spec["indices"][i] % source_spec["columns"]
            left = round(320 + (box[0] - center - column * data["column_width"]) * factor)
            top = 560 - tile.height - round(spec.get("lift", [0]*len(data["poses"]))[i] * factor)
            if "ground_contacts_y" in spec:
                top = round(560 + (box[1] - spec["ground_contacts_y"][i]) * factor)
            if min(left, top) < 0 or left + tile.width > 640 or top + tile.height > 640:
                raise ValueError(f"Pose exceeds shared canvas: {asset['id']} {action} {i}")
            x, y = i % 4 * 640, i // 4 * 640
            sheet.paste(tile, (x + left, y + top))
            frames.append({"rect": [x, y, 640, 640], "origin": [x + 320, y + 560]})
        result[action] = (sheet, frames, {"source_sha256": source_spec["sha256"],
            "source_boxes": data["boxes"], "action_scale": factor,
            "ground_contacts_y": spec.get("ground_contacts_y"), "lift": spec.get("lift"),
            "removed_detached_pixels": data["removed_detached_pixels"], "frame_count": len(frames)})
    return result


def prepare(recipe_path, out):
    recipe_path, out = Path(recipe_path).resolve(), Path(out).resolve()
    recipe = json.loads(recipe_path.read_text())
    validate(recipe)
    prepared = []
    for asset in recipe["assets"]:
        sources = {key: extract(recipe_path.parent / spec["image"], spec)
                   for key, spec in asset["sources"].items()}
        prepared.append((asset, align(asset, sources)))
    for asset, layouts in prepared:
        folder = out / asset["id"]
        folder.mkdir(parents=True, exist_ok=True)
        spec = {"schema_version": 1, "asset_id": asset["id"],
                **{key: asset[key] for key in ("name", "facing", "size", "height_scale", "backend", "layout_note")}, "actions": {}}
        audit = {"recipe_sha256": sha256(recipe_path), "actions": {}}
        for action, (sheet, frames, record) in layouts.items():
            image = folder / f"{action}-layout.png"
            sheet.save(image)
            spec["actions"][action] = {"image": image.name, "sha256": sha256(image),
                **{k: asset["actions"][action][k] for k in ("loop", "durations_ms")}, "frames": frames}
            audit["actions"][action] = record
        save_json(folder / "import.json", spec)
        save_json(folder / "extraction.json", audit)
        import_sheet(folder / "import.json", folder / "export")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    prepare(args.recipe, args.out)
