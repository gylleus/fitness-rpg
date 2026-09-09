"""Fixed-grid, mask-aware pixel conversion and lossless sprite-sheet export.

Conservative mode uses pinned Pyxelate geometry, NOT stock Pyx.transform().
RGB and coverage are processed separately; hidden background RGB is discarded.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from skimage.color import rgb2lab, deltaE_ciede2000
from skimage.transform import resize

from common import ROOT, STUDY, PYX_REV, save_json, sha256

sys.path.insert(0, str(STUDY / "vendor" / f"pyxelate-{PYX_REV}"))


def palette_colors():
    colors = json.loads((ROOT / "palette.json").read_text())["colors"]
    return np.array([list(bytes.fromhex(c.lstrip("#"))) for c in colors], dtype=np.uint8)


def extend_foreground(rgba):
    """Replace uncertain edge/background RGB with nearest confident foreground.

    This intentionally removes soft glow and can simplify translucent glass.
    It prevents matte halos, but is not a physical alpha-matting reconstruction.
    Fully hidden RGB cannot affect any visible result (tested invariant).
    """
    a = np.asarray(rgba.convert("RGBA"))
    confident = a[..., 3] >= 250
    if not confident.any():
        confident = a[..., 3] >= 128
    if not confident.any():
        raise ValueError("Empty foreground mask")
    _, indices = ndimage.distance_transform_edt(~confident, return_indices=True)
    rgb = a[..., :3][tuple(indices)]
    return Image.fromarray(rgb, "RGB")


def map_palette(rgb, colors=None, metric="ciede2000"):
    colors = palette_colors() if colors is None else colors
    lab = rgb2lab(np.asarray(rgb.convert("RGB")) / 255.0)
    palette_lab = rgb2lab(colors[None, :, :] / 255.0)[0]
    if metric == "ciede2000":
        distance = deltaE_ciede2000(lab[:, :, None, :], palette_lab[None, None, :, :])
    elif metric == "cie76":
        distance = ((lab[:, :, None, :] - palette_lab) ** 2).sum(-1)
    else:
        raise ValueError(f"Unknown palette metric: {metric}")
    closest = distance.argmin(-1)
    return Image.fromarray(colors[closest], "RGB")


def convert(rgba, size, method="conservative", mask_resize="coverage", threshold=128, color_metric="ciede2000"):
    from pyxelate import Pal, Pyx
    if rgba.size[0] != rgba.size[1]:
        raise ValueError("Use one square, aspect-preserving clip crop before conversion")
    rgba = rgba.convert("RGBA")
    rgb = extend_foreground(rgba)
    colors = palette_colors()
    if method == "nearest":
        reduced = rgb.resize((size, size), Image.Resampling.NEAREST)
    elif method == "conservative":
        geometry = Pyx(width=size, height=size, palette=Pal.from_rgb(colors.tolist()),
                       svd=False, dither="none", sobel=3, depth=1)
        working = resize(np.asarray(rgb), (size * 3, size * 3), anti_aliasing=True)
        working = geometry._pyxelate(geometry._median(working))
        reduced = Image.fromarray(np.clip(np.rint(working * 255), 0, 255).astype(np.uint8))
    else:
        raise ValueError(method)
    result = np.array(map_palette(reduced, colors, color_metric).convert("RGBA"))
    alpha = rgba.getchannel("A").resize((size, size), Image.Resampling.BOX
        if mask_resize == "coverage" else Image.Resampling.NEAREST)
    result[..., 3] = (np.asarray(alpha) >= threshold).astype(np.uint8) * 255
    result[result[..., 3] == 0, :3] = 0
    return Image.fromarray(result, "RGBA")


def fixed_crop(frames, margin=0.08):
    if not frames or len({f.size for f in frames}) != 1:
        raise ValueError("All frames must have the same source dimensions")
    boxes = [f.getchannel("A").point(lambda x: 255 if x >= 128 else 0).getbbox() for f in frames]
    if any(b is None for b in boxes):
        raise ValueError("Empty frame mask")
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    side = math.ceil(max(x1 - x0, y1 - y0) / (1 - 2 * margin))
    left, top = math.floor((x0 + x1 - side) / 2), math.floor((y0 + y1 - side) / 2)
    box = (left, top, left + side, top + side)
    # Crop outside source bounds is padded with transparent pixels by Pillow.
    return [f.crop(box) for f in frames], list(box)


def ground_anchor(mask):
    """Use both boots in a lower band, not the single lowest scanline.

    The lowest scanline can switch between planted feet as their shading/masks
    change, causing a false horizontal jump of an entire stance width.
    """
    ys, xs = np.where(mask)
    if not len(xs):
        raise ValueError("Empty mask")
    bottom = int(ys.max())
    band = max(3, round((bottom - int(ys.min()) + 1) * 0.08))
    lower = mask.copy()
    lower[:max(0, bottom - band)] = False
    labels, _ = ndimage.label(lower, np.ones((3, 3)))
    tolerance = max(3, round((bottom - int(ys.min()) + 1) * 0.02))
    touching = np.unique(labels[max(0, bottom - tolerance):bottom + 1])
    touching = touching[touching > 0]
    # Ignore cape ends entering the band but not reaching the ground. This only
    # defines the measurement; it never deletes pixels from the exported mask.
    ground_x = np.where(np.isin(labels, touching))[1]
    return ((float(ground_x.min()) + float(ground_x.max()) + 1) / 2, float(bottom + 1))


def mask_metrics(frames, anchor="ground"):
    masks = [np.asarray(f.getchannel("A")) >= 128 for f in frames]
    areas = np.array([m.sum() for m in masks], dtype=float)
    anchors, components = [], []
    for m in masks:
        ys, xs = np.where(m)
        if not len(xs):
            raise ValueError("Empty mask")
        anchors.append(ground_anchor(m))
        labels, _ = ndimage.label(m, np.ones((3, 3)))
        components.append(int(np.sum(np.bincount(labels.ravel())[1:] <= 2)))
    adjacent_area = float(np.max(np.abs(np.diff(areas)) / np.maximum(areas[:-1], 1))) if len(areas) > 1 else 0
    drift = np.ptp(np.array(anchors), axis=0) / frames[0].width
    border = any(m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any() for m in masks)
    return {"max_adjacent_area_change": adjacent_area, "area_ratio": float(areas.max() / max(1, areas.min())),
            "anchor_drift_xy_fraction": drift.tolist(), "touches_source_border": bool(border),
            "tiny_components_per_frame": components, "anchor_mode": anchor}


def select_loop(frames, fps=24, export_frames=8, min_gap=12, min_motion=0.018, min_shape_motion=0):
    """Find closure + velocity agreement; emit no duplicate endpoint.

    Scores are heuristics, not an anatomy/identity evaluator. No crossfade or
    ping-pong silently invents a loop. Static clips are rejected by QC.
    """
    if len(frames) < min_gap + 2:
        raise ValueError(f"Need at least {min_gap + 2} frames for loop selection")
    features = []
    for frame in frames:
        a = np.asarray(frame.resize((32, 32), Image.Resampling.BOX), dtype=float) / 255
        a[..., :3] *= a[..., 3:4]
        features.append(a)
    features = np.stack(features)
    occupancy = max(0.01, float(features[..., 3].mean()))
    masks = np.stack([np.asarray(f.getchannel("A")) >= 128 for f in frames]).reshape(len(frames), -1).astype(np.float32)
    intersections = masks @ masks.T
    areas = masks.sum(1)
    shape_changes = 1 - intersections / np.maximum(1, areas[:, None] + areas[None, :] - intersections)

    def distance(a, b):
        return float(np.mean(np.abs(a - b)) / occupancy)

    candidates = []
    for start in range(len(frames) - min_gap):
        for end in range(start + min_gap, len(frames) - 1):
            seam = distance(features[start], features[end])
            velocity = distance(features[start + 1] - features[start], features[end + 1] - features[end])
            excursion = max(distance(features[start], f) for f in features[start:end])
            shape_excursion = float(shape_changes[start, start:end].max())
            candidates.append((seam + velocity * 0.5, -excursion, start, end, seam, velocity, shape_excursion))
    moving = [c for c in candidates if -c[1] >= min_motion and c[6] >= min_shape_motion]
    _, _, start, end, seam, velocity, shape_excursion = min(moving or candidates)
    indices = np.linspace(start, end, export_frames, endpoint=False).astype(int).tolist()
    if len(set(indices)) != export_frames:
        raise ValueError("Loop too short for requested frame count")
    duration_ms = (end - start) / fps * 1000
    # Distribute rounding so exported timing matches the selected interval.
    boundaries = np.rint(np.arange(export_frames + 1) * duration_ms / export_frames).astype(int)
    motion = max(distance(features[start], f) for f in features[start:end])
    return {"start": start, "end_exclusive": end, "indices": indices,
            "durations_ms": np.diff(boundaries).tolist(), "seam_score": seam,
            "velocity_score": velocity, "motion_excursion": motion, "shape_excursion": shape_excursion}


def quality(metrics, loop, gates, anchor="ground", mask_agreement=None):
    reasons = []
    if metrics["touches_source_border"]:
        reasons.append("foreground_touches_source_border")
    if metrics["max_adjacent_area_change"] > gates["max_area_jump"]:
        reasons.append("mask_area_jump")
    if metrics["area_ratio"] > gates["max_area_ratio"]:
        reasons.append("silhouette_size_drift")
    if anchor != "floating" and max(metrics["anchor_drift_xy_fraction"]) > gates["max_anchor_drift"]:
        reasons.append("anchor_drift")
    if loop["motion_excursion"] < gates["min_motion"]:
        reasons.append("insufficient_motion")
    if loop.get("shape_excursion", 0) < gates.get("min_shape_motion", 0):
        reasons.append("insufficient_shape_motion")
    if loop["seam_score"] > gates["max_seam"]:
        reasons.append("loop_seam")
    if loop["velocity_score"] > gates["max_velocity_seam"]:
        reasons.append("loop_velocity_seam")
    if mask_agreement is not None and mask_agreement < gates["min_mask_iou"]:
        reasons.append("tracker_segmenter_disagreement")
    return {"passed": not reasons, "reasons": reasons, "gates": gates,
            "note": "Heuristics only; passing does not certify anatomy, equipment, or motion compliance."}


def checker(size, cell=8):
    y, x = np.indices((size[1], size[0]))
    a = np.where(((x // cell + y // cell) % 2)[..., None], [65, 70, 82], [42, 47, 58]).astype(np.uint8)
    return Image.fromarray(a, "RGB").convert("RGBA")


def export(frames, loop, out, name, pivot, metadata_extra=None):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    selected = [frames[i] for i in loop["indices"]]
    size = selected[0].width
    sheet = Image.new("RGBA", (size * len(selected), size))
    records = []
    allowed = set(map(tuple, palette_colors()))
    for index, (frame, duration) in enumerate(zip(selected, loop["durations_ms"])):
        a = np.asarray(frame)
        if frame.size != (size, size) or not set(np.unique(a[..., 3])) <= {0, 255}:
            raise ValueError("Invalid frame dimensions/alpha")
        if not set(map(tuple, a[a[..., 3] > 0, :3])) <= allowed:
            raise ValueError("Visible color outside ENDESGA 32")
        path = out / f"frame-{index:03d}.png"
        frame.save(path)
        sheet.paste(frame, (index * size, 0))
        records.append({"filename": path.name, "frame": {"x": index * size, "y": 0, "w": size, "h": size},
                        "rotated": False, "trimmed": False, "spriteSourceSize": {"x": 0, "y": 0, "w": size, "h": size},
                        "sourceSize": {"w": size, "h": size}, "duration": duration,
                        "source_frame": loop["indices"][index], "sha256": sha256(path)})
    sheet.save(out / "spritesheet.png")
    selected[0].save(out / "preview.apng", format="PNG", save_all=True, append_images=selected[1:],
                     duration=loop["durations_ms"], loop=0, disposal=0, blend=0)
    previews = [Image.alpha_composite(checker(f.size), f).convert("RGB").resize((size * 4, size * 4), Image.Resampling.NEAREST) for f in selected]
    previews[0].save(out / "preview.gif", save_all=True, append_images=previews[1:],
                     duration=loop["durations_ms"], loop=0, optimize=False, disposal=2)
    # GIF is a checkerboard viewing aid; PNG/APNG carry authoritative transparency.
    save_json(out / "spritesheet.json", {"frames": records, "meta": {"image": "spritesheet.png",
        "format": "RGBA8888", "size": {"w": sheet.width, "h": sheet.height}, "scale": "1",
        "frameTags": [{"name": name, "from": 0, "to": len(selected) - 1, "direction": "forward"}],
        "pivot": {"x": pivot[0], "y": pivot[1], "units": "normalized_frame"},
        "palette": "ENDESGA 32", "loop": loop, **(metadata_extra or {})}})


def comparison(rows, out):
    """Each row: (label, [(column label, image), ...]); integer NN enlargement."""
    cols = max(len(panels) for _, panels in rows)
    sheet = Image.new("RGB", (cols * 276 + 24, len(rows) * 308 + 40), "#181425")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    for row, (label, panels) in enumerate(rows):
        y = row * 308 + 16
        draw.text((12, y), label, fill="white", font=font)
        for col, (title, panel) in enumerate(panels):
            x = col * 276 + 12
            scale = max(1, 256 // max(panel.size))
            shown = panel.resize((panel.width * scale, panel.height * scale), Image.Resampling.NEAREST)
            bg = checker(shown.size)
            bg.alpha_composite(shown.convert("RGBA"))
            sheet.paste(bg.convert("RGB"), (x, y + 40))
            draw.text((x, y + 20), f"{title} ({panel.width}px, {scale}x NN)", fill="#c0cbdc", font=font)
    sheet.save(out)
