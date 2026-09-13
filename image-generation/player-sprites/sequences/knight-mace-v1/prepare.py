#!/usr/bin/env python3
"""Import the reviewed knight sheet with one shared scale and physical anchors."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "image-generation/sprite-pipeline"))
from sheet_import import import_sheet


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def walking_poses():
    """Register the higher-resolution walk sheet before the shared 128px import."""
    spec = json.loads((HERE / "walk-source.json").read_text())
    source = HERE / spec["source"]
    if sha(source) != spec["sha256"]:
        raise ValueError("Knight walking source changed")
    rgba = np.array(Image.open(source).convert("RGBA"))
    rgb = rgba[..., :3].astype(int)
    # Saturated magenta is outside the knight palette; the channel difference
    # also removes mixed key pixels without punching holes in gray armor.
    keyed = (rgb[..., 0] - rgb[..., 1] > 40) & (rgb[..., 2] - rgb[..., 1] > 40)
    labels, _ = ndimage.label(~keyed, np.ones((3, 3)))
    areas = np.bincount(labels.ravel())
    objects = ndimage.find_objects(labels)
    poses = []
    for label in np.flatnonzero(areas[1:] > 500) + 1:
        ys, xs = objects[label - 1]
        poses.append((int(label), [xs.start, ys.start, xs.stop, ys.stop]))
    if len(poses) != 6:
        raise ValueError(f"Expected six complete walking poses, got {len(poses)}")
    poses.sort(key=lambda item: item[1][1] + item[1][3])
    poses = [p for row in range(2) for p in sorted(poses[row*3:row*3+3], key=lambda item: item[1][0])]
    scale = spec["scale"]  # One fixed scale for the entire walk, never per-pose fitting.
    results = []
    for i, (label, box) in enumerate(poses):
        x0, y0, x1, y1 = box
        tile = rgba[y0:y1, x0:x1].copy()
        tile[..., 3] = (labels[y0:y1, x0:x1] == label).astype(np.uint8) * 255
        tile[tile[..., 3] == 0] = 0
        pose = Image.fromarray(tile).resize((round((x1-x0)*scale), round((y1-y0)*scale)), Image.Resampling.NEAREST)
        left = round(320 + (x0-spec["origins_x"][i])*scale)
        top = 560 - round((spec["ground_contacts_y"][i]-y0)*scale)
        results.append((pose, left, top, box))
    return results, spec


def main():
    source = HERE / "sheet-source.png"
    provenance = json.loads((HERE / "source.json").read_text())
    if sha(source) != provenance["sha256"]:
        raise ValueError("Knight source image changed")
    contacts = json.loads((HERE / "ground-contacts.json").read_text())
    pixels = np.array(Image.open(source).convert("RGBA"))
    labels, _ = ndimage.label(pixels[..., 3] > 128, np.ones((3, 3)))
    areas = np.bincount(labels.ravel())
    objects = ndimage.find_objects(labels)
    subjects = []
    for label in np.flatnonzero(areas[1:] > 500) + 1:
        ys, xs = objects[label - 1]
        subjects.append((int(label), [xs.start, ys.start, xs.stop, ys.stop]))
    if len(subjects) != 24:
        raise ValueError(f"Expected 24 complete connected knight poses, got {len(subjects)}")
    subjects.sort(key=lambda item: item[1][1] + item[1][3])
    subjects = [item for row in range(4) for item in sorted(subjects[row*6:row*6+6], key=lambda item: item[1][0])]
    first = subjects[0][1]
    anchor_x = (first[0] + first[2]) / 2
    recipe = {"schema_version": 1, "asset_id": "barbarian_player", "name": "Knight",
        "facing": "right", "size": 128, "height_scale": 1,
        "backend": "built-in imagegen frame sheet; deterministic CPU import",
        "layout_note": "Stable legacy player ID. Explicit body contacts; mace spikes may extend below the resting body. Fixed column anchor and one union crop/scale for all poses.",
        "actions": {}}
    audit = {"source_sha256": sha(source), "source_size": list(Image.open(source).size),
        "alpha_threshold": 128, "anchor_x": anchor_x, "actions": {},
        "removed_detached_pixels": int(sum(areas[1:]) - sum(areas[label] for label, _ in subjects))}
    durations = {"idle": [200]*6, "walk": [140, 130, 130, 140, 130, 130],
        "attack": [120, 160, 120, 100, 140, 160], "death": [100, 120, 130, 140, 160, 250]}
    walk, walk_spec = walking_poses()
    for row, action in enumerate(("idle", "walk", "attack", "death")):
        sheet = Image.new("RGBA", (2560, 1280))
        frames, boxes = [], []
        for i, (label, box) in enumerate(subjects[row*6:row*6+6]):
            x0, y0, x1, y1 = box
            rgba = pixels[y0:y1, x0:x1].copy()
            rgba[..., 3] = (labels[y0:y1, x0:x1] == label).astype(np.uint8) * 255
            rgba[rgba[..., 3] == 0] = 0
            pose = Image.fromarray(rgba)
            left = round(320 + x0 - anchor_x - i * pixels.shape[1] / 6)
            top = 560 + y0 - contacts[action][i]
            if action == "walk":
                pose, left, top, box = walk[i]
            if min(left, top) < 0 or left + pose.width > 640 or top + pose.height > 640:
                raise ValueError(f"Pose outside shared canvas: {action} {i}")
            x, y = i % 4 * 640, i // 4 * 640
            sheet.paste(pose, (x + left, y + top))
            frames.append({"rect": [x, y, 640, 640], "origin": [x + 320, y + 560]})
            boxes.append(box)
        layout = HERE / f"{action}-layout.png"
        sheet.save(layout)
        recipe["actions"][action] = {"image": layout.name, "sha256": sha(layout),
            "loop": action in ("idle", "walk"), "durations_ms": durations[action], "frames": frames}
        audit["actions"][action] = {"source_boxes": boxes, "ground_contacts_y": contacts[action], "frame_count": 6}
        if action == "walk":
            audit["actions"][action].update({"source": walk_spec["source"],
                "source_sha256": walk_spec["sha256"], "source_scale": walk_spec["scale"],
                "ground_contacts_y": walk_spec["ground_contacts_y"], "origins_x": walk_spec["origins_x"],
                "key_rule": "red-green > 40 and blue-green > 40"})
    save(HERE / "import.json", recipe)
    save(HERE / "extraction.json", audit)
    import_sheet(HERE / "import.json", HERE / "export")


if __name__ == "__main__":
    main()
