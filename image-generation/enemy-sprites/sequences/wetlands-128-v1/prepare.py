#!/usr/bin/env python3
"""Rebuild this authored imagegen set on CPU; no generation or pose synthesis.

Eight connected subjects are extracted from each immutable source sheet.
One scale per action matches its first ready pose to idle, then the existing
importer uses a single crop and scale across the complete entity.
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
KEY = np.array([139, 155, 180], dtype=np.int16)
TOLERANCE = 26


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def extract(path):
    record = json.loads(path.with_suffix(".json").read_text())
    if sha(path) != record["sha256"]:
        raise ValueError(f"Source checksum changed: {path}")
    rgb = np.asarray(Image.open(path).convert("RGB"))
    mask = np.abs(rgb.astype(np.int16) - KEY).max(axis=2) > TOLERANCE
    labels, _ = ndimage.label(mask, np.ones((3, 3)))
    areas = np.bincount(labels.ravel())
    subjects = np.flatnonzero(areas[1:] > 1000) + 1
    if len(subjects) != 8:
        raise ValueError(f"Expected eight isolated poses, got {len(subjects)}: {path}")
    objects = ndimage.find_objects(labels)
    boxes = []
    for label in subjects:
        ys, xs = objects[label - 1]
        boxes.append((int(label), [xs.start, ys.start, xs.stop, ys.stop]))
    # Source rows can drift across the nominal halfway line. Split by center,
    # then sort each group from left to right, preserving authored row order.
    boxes.sort(key=lambda item: item[1][1] + item[1][3])
    boxes = sorted(boxes[:4], key=lambda item: item[1][0]) + sorted(boxes[4:], key=lambda item: item[1][0])
    poses = []
    for label, box in boxes:
        x0, y0, x1, y1 = box
        rgba = np.dstack((rgb[y0:y1, x0:x1], (labels[y0:y1, x0:x1] == label).astype(np.uint8) * 255))
        rgba[rgba[..., 3] == 0] = 0
        poses.append(Image.fromarray(rgba, "RGBA"))
    return poses, [box for _, box in boxes], int(sum(areas[1:]) - sum(areas[subjects]))


def main():
    roster_path = HERE / "roster.json"
    roster = json.loads(roster_path.read_text())["enemies"]
    report = {"backend": "built-in imagegen sheets; deterministic CPU import",
              "source_roster_sha256": sha(roster_path), "entities": {}}
    for enemy in roster:
        folder = HERE / enemy["id"]
        actions = {action: extract(folder / f"{action}-source.png") for action in ACTIONS}
        # A single action-wide factor corrects independently generated sheets.
        # No per-pose fitting: the authored compression and follow-through stay.
        ready_heights = {action: data[0][0].height for action, data in actions.items()}
        target_height = min(360, *[min(580 * ready_heights[action] / pose.width,
                                          510 * ready_heights[action] / pose.height)
                                   for action, data in actions.items() for pose in data[0]])
        for action, (_, boxes, _) in actions.items():
            width = Image.open(folder / f"{action}-source.png").width / 4
            center = (boxes[0][0] + boxes[0][2]) / 2
            for i, box in enumerate(boxes):
                anchor = center + (i % 4) * width
                extent = max(anchor - box[0], box[2] - anchor)
                target_height = min(target_height, 296 * ready_heights[action] / extent)
        recipe = {"schema_version": 1, "asset_id": enemy["id"], "name": enemy["name"],
                  "facing": "left", "size": 128, "height_scale": enemy["visual"]["height_scale"],
                  "backend": "built-in imagegen frame sheets, imported on CPU",
                  "layout_note": "Connected subject extraction; documented action-wide scale; fixed x anchor per source grid column; source floor alignment; no per-frame rescaling.",
                  "actions": {}}
        entity_report = {"actions": {}, "target_ready_height": target_height}
        for action, (poses, boxes, removed) in actions.items():
            factor = target_height / ready_heights[action]
            # Match the ready pose's horizontal anchor across sheets, retaining
            # each subsequent pose's motion relative to its source cell center.
            first_center = (boxes[0][0] + boxes[0][2]) / 2
            source_width = Image.open(folder / f"{action}-source.png").width
            cell_width = source_width / 4
            sheet = Image.new("RGBA", (2560, 1280))
            frames = []
            for i, (pose, box) in enumerate(zip(poses, boxes)):
                tile = pose.resize((round(pose.width * factor), round(pose.height * factor)), Image.Resampling.NEAREST)
                left = round(320 + (box[0] - (first_center + (i % 4) * cell_width)) * factor)
                # Align to the lowest attached pixel; airborne toad contact is
                # explicitly restored below instead of fitting its flight down.
                bottom = 560
                if enemy["id"] == "bog_toad" and action == "attack" and i == 3:
                    bottom -= round(24 * factor)
                top = bottom - tile.height
                if left < 0 or top < 0 or left + tile.width > 640 or bottom > 640:
                    raise ValueError(f"Pose exceeds import canvas: {enemy['id']} {action} {i}")
                x, y = (i % 4) * 640, (i // 4) * 640
                sheet.paste(tile, (x + left, y + top))
                frames.append({"rect": [x, y, 640, 640], "origin": [x + 320, y + 560]})
            layout = folder / f"{action}-layout.png"
            sheet.save(layout)
            durations = [150] * 8 if action == "idle" else [100] * 8
            if action == "attack" and enemy["id"] == "root_hulk":
                durations = [100, 100, 150, 70, 100, 100, 100, 80]
            recipe["actions"][action] = {"image": layout.name, "sha256": sha(layout),
                "loop": action in ("idle", "walk"), "durations_ms": durations, "frames": frames}
            entity_report["actions"][action] = {"source_image": f"{action}-source.png",
                "source_sha256": sha(folder / f"{action}-source.png"), "source_boxes": boxes,
                "ready_height": ready_heights[action], "action_scale": factor,
                "removed_detached_pixels": removed, "frame_count": len(poses)}
        save(folder / "import.json", recipe)
        save(folder / "extraction.json", entity_report)
        import_sheet(folder / "import.json", folder / "export")
        entity_report["manifest_sha256"] = sha(folder / "export/manifest.json")
        report["entities"][enemy["id"]] = entity_report
    save(HERE / "preparation.json", report)


if __name__ == "__main__":
    main()
