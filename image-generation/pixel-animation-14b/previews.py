#!/usr/bin/env python3
"""Rebuild GIF viewing aids with centisecond timing; PNGs stay authoritative."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "sprite-animation"))
import numpy as np
from PIL import Image
from pixels import checker


def gif_preview(folder):
    folder = Path(folder)
    atlas = json.loads((folder / "spritesheet.json").read_text())
    records = atlas["frames"]
    # GIF stores centiseconds. Round cumulative boundaries instead of each
    # duration so 44 frames at 16fps still span exactly 2750ms.
    boundaries = np.rint(np.cumsum([0] + [r["duration"] for r in records]) / 10) * 10
    durations = np.diff(boundaries).astype(int).tolist()
    frames = []
    for record in records:
        im = Image.open(folder / record["filename"]).convert("RGBA")
        frames.append(Image.alpha_composite(checker(im.size), im).convert("RGB").resize(
            (im.width * 4, im.height * 4), Image.Resampling.NEAREST))
    frames[0].save(folder / "preview.gif", save_all=True, append_images=frames[1:],
        duration=durations, loop=0, optimize=False, disposal=2)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("jobs", nargs="*")
    args = p.parse_args()
    jobs = args.jobs or [p.parent.name for p in (ROOT / "outputs").glob("*/assessment.json")]
    for job in jobs:
        for path in (ROOT / "outputs" / job / "export").glob("**/spritesheet.json"):
            gif_preview(path.parent)
        print("GIF timing rebuilt:", job)
