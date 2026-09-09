#!/usr/bin/env python3
"""Validate on-disk game exports. These checks do not rate artistic quality."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent / "sprite-animation"
sys.path.insert(0, str(BASE))
import numpy as np
from PIL import Image
from common import save_json, sha256
from pixels import palette_colors


def check(condition, message):
    if not condition:
        raise ValueError(message)


def validate(job):
    root = ROOT / "outputs" / job
    report = json.loads((root / "assessment.json").read_text())
    generation = report["generation"]
    length = generation["generation"]["length"]
    side = generation["generation"]["size"]
    source = sorted((root / "frames").glob("*.png"))
    check(len(source) == length, "Wrong raw frame count")
    check(all(Image.open(p).size == (side, side) for p in source), "Wrong raw dimensions")
    check(sha256(root / "reference.png") == generation["reference_sha256"], "Reference changed")
    allowed = set(map(tuple, palette_colors()))
    result = {"job": job, "raw_frames": len(source), "variants": {},
        "scope": "File integrity, dimensions, alpha, palette, atlas mapping and timing only; not artistic approval."}
    for name in report["variants"]:
        folder = root / "export" / name
        size = int(name.rsplit("-", 1)[-1])
        all_frames = sorted((folder / "all-frames").glob("*.png"))
        check(len(all_frames) == length, f"{name}: wrong processed frame count")
        colors = set()
        for path in all_frames:
            im = Image.open(path)
            check(im.mode == "RGBA" and im.size == (size, size), f"Invalid PNG: {path}")
            a = np.asarray(im)
            check(set(np.unique(a[..., 3])) <= {0, 255}, f"Nonbinary alpha: {path}")
            visible = set(map(tuple, a[a[..., 3] > 0, :3]))
            check(visible <= allowed, f"Out-of-palette color: {path}")
            colors.update(visible)
        expected_ms = (length - 1) / generation["generation"]["fps"] * 1000
        atlas_counts = {}
        for cadence, count in (("", 12), ("full-rate", length - 1)):
            atlas_folder = folder / cadence
            atlas = json.loads((atlas_folder / "spritesheet.json").read_text())
            sheet = Image.open(atlas_folder / "spritesheet.png").convert("RGBA")
            records = atlas["frames"]
            check(len(records) == count and sheet.size == (size * count, size), f"{name}: invalid atlas")
            for record in records:
                path = atlas_folder / record["filename"]
                check(sha256(path) == record["sha256"], f"Changed atlas frame: {path}")
                a = np.asarray(Image.open(path).convert("RGBA"))
                r = record["frame"]
                tile = sheet.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
                check(np.array_equal(a, np.asarray(tile)), f"Atlas tile mismatch: {path}")
                original = Image.open(all_frames[record["source_frame"]]).convert("RGBA")
                check(np.array_equal(a, np.asarray(original)), f"Source index mismatch: {path}")
            check(abs(sum(r["duration"] for r in records) - expected_ms) <= 1, f"{name}: atlas timing mismatch")
            atlas_counts[cadence or "compact"] = len(records)
        animation_counts = {}
        for filename in ("preview.apng", "full.apng", "full-rate/preview.apng", "preview.gif", "full-rate/preview.gif"):
            with Image.open(folder / filename) as im:
                check(im.info.get("loop") == 0, f"{name}: animation does not repeat")
                total_ms = 0
                for i in range(im.n_frames):
                    im.seek(i)
                    total_ms += im.info.get("duration", 0)
                # PNG encoders can combine identical adjacent frames; duration
                # is authoritative, so do not require a fixed encoded count.
                check(abs(total_ms - expected_ms) <= 2, f"{name}: animation timing mismatch: {filename}")
                animation_counts[filename] = im.n_frames
        result["variants"][name] = {"processed_frames": length, "atlas_frames": atlas_counts,
            "size": size, "visible_colors": len(colors), "duration_ms": expected_ms,
            "encoded_animation_frames": animation_counts, "status": "valid"}
    save_json(root / "validation.json", result)
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("job")
    validate(p.parse_args().job)
