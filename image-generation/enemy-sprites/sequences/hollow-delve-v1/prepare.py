#!/usr/bin/env python3
"""Rebuild the authored 6-column, 4-action imagegen sheets on CPU.

Only extract, align, quantize and pack existing poses; never synthesize motion.
Run with uv run sprite-python image-generation/enemy-sprites/sequences/hollow-delve-v1/prepare.py.
"""
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

ACTIONS = ("idle", "walk", "attack", "death")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n")


def main():
    roster = json.loads((HERE / "roster.json").read_text())
    sources = json.loads((HERE / "sources.json").read_text())
    for enemy in roster["enemies"]:
        folder = HERE / enemy["id"]
        source = folder / "sheet-source.png"
        if sha(source) != sources[enemy["id"]]["sha256"]:
            raise ValueError(f"Source changed: {source}")
        pixels = np.array(Image.open(source).convert("RGBA"))
        labels, _ = ndimage.label(pixels[..., 3] > 128, np.ones((3, 3)))
        areas = np.bincount(labels.ravel())
        objects = ndimage.find_objects(labels)
        subjects = []
        for label in np.flatnonzero(areas[1:] > 500) + 1:
            ys, xs = objects[label - 1]
            subjects.append((int(label), [xs.start, ys.start, xs.stop, ys.stop]))
        if len(subjects) != 24:
            raise ValueError(f"Expected 24 connected poses: {source}, got {len(subjects)}")
        # Windups cross nominal row/cell boundaries; connected components keep
        # weapons, limbs and slime lobes intact. Read four rows of six by center.
        subjects.sort(key=lambda item: item[1][1] + item[1][3])
        subjects = [item for row in range(4) for item in sorted(subjects[row*6:row*6+6], key=lambda item: item[1][0])]
        first = subjects[0][1]
        anchor_x = (first[0] + first[2]) / 2
        column_width = pixels.shape[1] / 6
        recipe = {"schema_version": 1, "asset_id": enemy["id"], "name": enemy["name"],
                  "facing": "left", "size": 128, "height_scale": enemy["visual"]["height_scale"],
                  "backend": "built-in imagegen frame sheet; deterministic CPU import",
                  "layout_note": "Alpha-connected extraction, fixed grid-column x anchor, floor-aligned attached pixels. One scale and union crop across all 24 poses; no per-frame resizing.",
                  "actions": {}}
        audit = {"source_sha256": sha(source), "source_size": list(Image.open(source).size),
                 "alpha_threshold": 128, "anchor_x": anchor_x, "actions": {},
                 "removed_detached_pixels": int(sum(areas[1:]) - sum(areas[label] for label, _ in subjects))}
        for row, action in enumerate(ACTIONS):
            sheet = Image.new("RGBA", (2560, 1280))
            frames, boxes = [], []
            for i, (label, box) in enumerate(subjects[row*6:row*6+6]):
                x0, y0, x1, y1 = box
                rgba = pixels[y0:y1, x0:x1].copy()
                rgba[..., 3] = (labels[y0:y1, x0:x1] == label).astype(np.uint8) * 255
                rgba[rgba[..., 3] == 0] = 0
                pose = Image.fromarray(rgba)
                left, top = round(320 + x0 - anchor_x - i * column_width), 560 - pose.height
                if min(left, top) < 0 or left + pose.width > 640:
                    raise ValueError(f"Pose outside shared canvas: {enemy['id']} {action} {i}")
                x, y = i % 4 * 640, i // 4 * 640
                sheet.paste(pose, (x + left, y + top))
                frames.append({"rect": [x, y, 640, 640], "origin": [x + 320, y + 560]})
                boxes.append(box)
            layout = folder / f"{action}-layout.png"
            sheet.save(layout)
            durations = {"idle": [180]*6, "walk": [110]*6,
                         "attack": [100, 160, 100, 80, 140, 140],
                         "death": [100, 120, 130, 140, 160, 250]}[action]
            recipe["actions"][action] = {"image": layout.name, "sha256": sha(layout),
                "loop": action in ("idle", "walk"), "durations_ms": durations, "frames": frames}
            audit["actions"][action] = {"source_boxes": boxes, "frame_count": 6}
        save(folder / "import.json", recipe)
        save(folder / "extraction.json", audit)
        import_sheet(folder / "import.json", folder / "export")


if __name__ == "__main__":
    main()
