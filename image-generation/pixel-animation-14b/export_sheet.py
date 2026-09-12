#!/usr/bin/env python3
"""Export an existing masked animation at a chosen size, with one fixed crop."""
import argparse
import json
import math
import os
from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile

os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")
ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent / "sprite-animation"
sys.path.insert(0, str(BASE))
import numpy as np
from PIL import Image
from threadpoolctl import threadpool_limits
from common import PYX_REV, save_json, sha256
from pixels import convert, fixed_crop, comparison, palette_colors
from analyze import export, transition_metrics


def skip_frames(loop, frame_step=1):
    """Keep every Nth displayed frame, carrying skipped time into its hold."""
    indices, durations = loop["indices"], loop["durations_ms"]
    if not isinstance(frame_step, int) or frame_step < 1:
        raise ValueError("Frame step must be a positive integer")
    if len(indices) != len(durations) or len(indices) < 2 or any(d <= 0 for d in durations):
        raise ValueError("Invalid source loop")
    positions = list(range(0, len(indices), frame_step))
    # A one-shot's settled ending is meaningful (especially death). Keep it
    # even when the stride misses it, borrowing its hold from the prior group.
    if loop.get("repeat") is False and positions[-1] != len(indices) - 1:
        positions.append(len(indices) - 1)
    if len(positions) < 2:
        raise ValueError("Frame step must retain at least two poses")
    return {**loop, "indices": [indices[p] for p in positions],
        "durations_ms": [sum(durations[p:end]) for p, end in zip(positions, positions[1:] + [len(indices)])],
        "frame_step": frame_step,
        "selection": "Every Nth displayed source frame, plus the final pose for one-shots. Omitted frame times extend the previous pose. Full duration preserved."}


def verify(folder, size, count, duration, columns):
    atlas = json.loads((folder / "spritesheet.json").read_text())
    sheet = Image.open(folder / "spritesheet.png").convert("RGBA")
    expected = (columns * size, math.ceil(count / columns) * size)
    if sheet.size != expected or len(atlas["frames"]) != count:
        raise ValueError("Wrong sheet dimensions or frame count")
    allowed = set(map(tuple, palette_colors()))
    used = set()
    for record in atlas["frames"]:
        path = folder / record["filename"]
        im = Image.open(path)
        a = np.asarray(im)
        if im.mode != "RGBA" or im.size != (size, size) or not set(np.unique(a[..., 3])) <= {0, 255}:
            raise ValueError("Invalid frame dimensions/alpha")
        colors = set(map(tuple, a[a[..., 3] > 0, :3]))
        if not colors <= allowed or sha256(path) != record["sha256"]:
            raise ValueError("Invalid palette or frame hash")
        if a[0, :, 3].any() or a[-1, :, 3].any() or a[:, 0, 3].any() or a[:, -1, 3].any():
            raise ValueError("Sprite touches frame border; increase the margin")
        used.update(colors)
        r = record["frame"]
        tile = sheet.crop((r["x"], r["y"], r["x"] + size, r["y"] + size))
        if not np.array_equal(np.asarray(tile), a):
            raise ValueError("Atlas tile does not match its frame")
    for index in range(count, columns * math.ceil(count / columns)):
        x, y = (index % columns) * size, (index // columns) * size
        if sheet.crop((x, y, x + size, y + size)).getbbox() is not None:
            raise ValueError("Unused atlas cells must be transparent")
    if sum(r["duration"] for r in atlas["frames"]) != duration:
        raise ValueError("Atlas timing mismatch")
    for name in ("preview.apng", "preview.gif"):
        with Image.open(folder / name) as im:
            # Pillow writes a one-pose APNG as an ordinary PNG, without timing.
            # The atlas remains authoritative for the static preview hold.
            if count == 1 and not getattr(im, "is_animated", False):
                continue
            if im.info.get("loop") != 0:
                raise ValueError("Preview does not loop")
            total = 0
            for i in range(im.n_frames):
                im.seek(i)
                total += im.info["duration"]
            if abs(total - duration) > (5 if name.endswith("gif") else 1):
                raise ValueError("Preview duration mismatch")
    return {"status": "valid", "frame_size": [size, size], "frames": count,
        "sheet_size": list(sheet.size), "visible_colors": len(used), "duration_ms": duration,
        "alpha": "binary", "padding_cells": columns * math.ceil(count / columns) - count}


def make_sheet(job, size=64, columns=8, margin=.08, frame_step=1):
    if not 16 <= size <= 256 or not 1 <= columns <= 64 or not 0 < margin < .3:
        raise ValueError("Use size 16..256, columns 1..64 and margin between 0 and 0.3")
    source = ROOT / "outputs" / job
    report = json.loads((source / "assessment.json").read_text())
    loop = skip_frames(report["full_rate_loop"], frame_step)
    paths = sorted((source / "tracking/cutouts").glob("*.png"))
    if len(paths) != report["generation"]["frames"]:
        raise ValueError("Incomplete tracked sequence")
    frames = [Image.open(p).convert("RGBA") for p in paths]
    cropped, box = fixed_crop(frames, margin=margin)
    side = box[2] - box[0]
    pivot = [(report["pivot"][i] * frames[0].size[i] - box[i]) / side for i in (0, 1)]
    suffix = f"-step-{frame_step}" if frame_step != 1 else ""
    out = ROOT / "outputs" / f"{job}-{size}-sheet{suffix}"
    out.mkdir(exist_ok=True)
    manifest = {"source_job": job, "source_generation": report["generation"],
        "source_cutout_sha256": {p.name: sha256(p) for p in paths},
        "size": size, "columns": columns, "crop": box, "margin": margin,
        "frame_step": frame_step, "source_fps": report["generation"]["generation"]["fps"],
        "average_displayed_fps": len(loop["indices"]) * 1000 / sum(loop["durations_ms"]),
        "crop_policy": "One square union crop across every frame, no per-frame repositioning or aspect stretch",
        "pivot": pivot, "loop": loop, "pyxelate_revision": PYX_REV,
        "pyxelate_settings": {"mode": "conservative geometry + separate CIEDE2000 palette mapping",
            "svd": False, "dither": "none", "sobel": 3, "depth": 1},
        "palette": json.loads((BASE / "palette.json").read_text()),
        "code_sha256": {p.name: sha256(p) for p in (Path(__file__), BASE / "pixels.py", ROOT / "analyze.py", ROOT / "previews.py")},
        "variants": {}}
    rows = []
    with threadpool_limits(limits=4):
        for label, method in (("nearest", "nearest"), ("pyxelate", "conservative")):
            print(f"{job}: {label} at {size}px", flush=True)
            sequence = {i: convert(cropped[i], size, method, color_metric="ciede2000") for i in loop["indices"]}
            folder = out / label
            export(sequence, loop, folder, report["generation"]["job"]["preset"], pivot,
                {"method": label, "source_job": job, "fixed_source_crop": box})
            atlas = json.loads((folder / "spritesheet.json").read_text())
            count = len(atlas["frames"])
            sheet = Image.new("RGBA", (columns * size, math.ceil(count / columns) * size))
            for i, record in enumerate(atlas["frames"]):
                x, y = (i % columns) * size, (i // columns) * size
                sheet.paste(sequence[record["source_frame"]], (x, y))
                record["frame"]["x"], record["frame"]["y"] = x, y
            sheet.save(folder / "spritesheet.png")
            atlas["meta"]["size"] = {"w": sheet.width, "h": sheet.height}
            atlas["meta"]["grid"] = {"columns": columns, "rows": math.ceil(count / columns), "order": "row-major"}
            save_json(folder / "spritesheet.json", atlas)
            displayed = [sequence[i] for i in loop["indices"]]
            checked = verify(folder, size, count, sum(loop["durations_ms"]), columns)
            checked["loop_metrics"] = transition_metrics(displayed)
            manifest["variants"][label] = checked
            chosen = sorted(set([0, count // 3, 2 * count // 3, count - 1]))
            rows.append((f"{label}: {size}x{size}, every {frame_step} frame(s), ENDESGA 32",
                [(f"source {loop['indices'][i]}", displayed[i]) for i in chosen]))
    comparison(rows, out / "comparison.png")
    save_json(out / "manifest.json", manifest)
    command = f"image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/export_sheet.py --job {job} --size {size} --columns {columns} --margin {margin} --frame-step {frame_step}"
    (out / "README.md").write_text(f"# {job}: {size}px animation export\n\nEach frame is {size}x{size}; each sheet is {columns*size}x{math.ceil(count/columns)*size}, read left to right, top to bottom. Use the first {count} cells. The remaining cells are transparent padding. Frame {len(frames)-1} from the original generation remains an unused boundary frame.\n\nKeeps every {frame_step} frame(s), giving {manifest['average_displayed_fps']:g} displayed poses/second on average. The loop retains its original {sum(loop['durations_ms'])/1000:g}-second duration; skipped frames become longer holds. This changes cadence, not motion speed. The last hold can be shorter if the stride does not evenly divide the source frame count.\n\nBoth methods use the same fixed crop, pivot, ENDESGA palette and pre-removed background. Generation remains the original {frames[0].width}px Wan clip; no new inference is needed. Pyxelate uses its conservative reducer, with dithering and SVD disabled, followed by explicit palette mapping.\n\nPNG frames/APNG have transparency. The enlarged GIF is a viewing aid with a checkerboard background. Use spritesheet.json for coordinates, original source-frame indices and durations.\n\nReproduce within this repository:\n\n```bash\n{command}\n```\n")
    archive = out / "spritesheets.zip"
    with ZipFile(archive, "w", ZIP_DEFLATED) as z:
        for path in sorted(out.rglob("*")):
            if path.is_file() and path != archive:
                z.write(path, str(path.relative_to(out)))
        z.write(Path(__file__), "export_sheet.py")
    with ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError("Archive CRC validation failed")
    print(out, flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--job", default="knight-pixel")
    p.add_argument("--size", type=int, default=64)
    p.add_argument("--columns", type=int, default=8)
    p.add_argument("--margin", type=float, default=.08)
    p.add_argument("--frame-step", type=int, default=1, help="Keep every Nth frame and preserve the full loop duration")
    args = p.parse_args()
    make_sheet(args.job, args.size, args.columns, args.margin, args.frame_step)
