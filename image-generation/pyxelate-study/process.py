"""Pyxelate matrix and matched controls. No background removal or grid recovery."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
for key in ["OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"]:
    os.environ.setdefault(key, "4")

import copy
import hashlib
import importlib.metadata
import json
import time
import warnings

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pyxelate import Pyx
from skimage.color import rgb2lab
from threadpoolctl import threadpool_limits

NAMES = ["knight", "slime", "chest", "potion", "environment"]
METHODS = ["original", "nearest", "nearest_shared", "pyxelate_independent", "pyxelate_shared"]
LABELS = ["Original (preview)", "Nearest neighbor", "Nearest + shared palette", "Pyxelate / independent", "Pyxelate / shared"]


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def fit_size(size, bound):
    """Fit inside a square without cropping, stretching or adding background pixels."""
    w, h = size
    scale = bound / max(w, h)
    return max(1, round(w * scale)), max(1, round(h * scale))


def map_palette(image, colors):
    """Nearest CIELAB (Delta E 76), no dithering; exactly the exported Pyxelate colors."""
    a = np.asarray(image.convert("RGB"))
    lab = rgb2lab(a).reshape(-1, 3)
    pal_lab = rgb2lab(np.asarray(colors, dtype=np.uint8).reshape(1, -1, 3)).reshape(-1, 3)
    idx = np.argmin(((lab[:, None, :] - pal_lab[None, :, :]) ** 2).sum(axis=2), axis=1)
    return Image.fromarray(np.asarray(colors, dtype=np.uint8)[idx].reshape(a.shape))


def pyx_instance(bound, colors, size, svd=True):
    w, h = fit_size(size, bound)
    return Pyx(width=w, height=h, palette=colors, dither="none", svd=svd, sobel=3, depth=1, alpha=.6)


def record(path, name, method, bound, palette=None):
    im = Image.open(path)
    a = np.asarray(im)
    return {"path": str(path.relative_to(ROOT)), "asset": name, "method": method,
            "bound": bound, "size": list(im.size), "mode": im.mode,
            "palette_limit": palette, "actual_rgb_colors": int(len(np.unique(a[:, :, :3].reshape(-1, 3), axis=0))),
            "alpha_values": np.unique(a[:, :, 3]).tolist() if a.shape[2] == 4 else None,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def process():
    images = {n: Image.open(ROOT / "originals" / f"{n}.png").convert("RGB") for n in NAMES}
    arrays = {n: np.asarray(im) for n, im in images.items()}
    # Each sprite contributes exactly 256x256 palette-training samples, just as an
    # independent default fit of a 1024px image does. A 2x2 collage needs a 512 cap.
    collage = np.concatenate([
        np.concatenate([arrays["knight"], arrays["slime"]], axis=1),
        np.concatenate([arrays["chest"], arrays["potion"]], axis=1),
    ], axis=0)
    Image.fromarray(collage).save(ROOT / "metadata/shared-training-collage.png")
    records, timings, captured = [], [], []
    for bound in [64, 128]:
        dest = ROOT / "processed" / str(bound)
        for name, im in images.items():
            p = dest / "nearest" / f"{name}.png"
            p.parent.mkdir(parents=True, exist_ok=True)
            im.resize(fit_size(im.size, bound), Image.Resampling.NEAREST).save(p)
            records.append(record(p, name, "nearest", bound))
    for colors in [16, 32]:
        start = time.monotonic()
        shared = pyx_instance(64, colors, images["knight"].size)
        shared.BGM_RESIZE = 512
        with warnings.catch_warnings(record=True) as ws:
            warnings.simplefilter("always")
            shared.fit(collage)
            palette = shared.colors.reshape(-1, 3).astype(np.uint8)
        captured.extend({"stage": f"shared-{colors}", "warning": str(w.message)} for w in ws)
        save_json(ROOT / f"metadata/palette-shared-{colors}.json", palette.tolist())
        timings.append({"stage": f"fit shared {colors}", "seconds": time.monotonic() - start})
        print("Shared palette fitted:", colors, flush=True)
        for name, a in arrays.items():
            start = time.monotonic()
            independent = pyx_instance(64, colors, images[name].size)
            with warnings.catch_warnings(record=True) as ws:
                warnings.simplefilter("always")
                independent.fit(a)
                pal = independent.colors.reshape(-1, 3).astype(np.uint8)
            captured.extend({"stage": f"{name}-independent-{colors}", "warning": str(w.message)} for w in ws)
            save_json(ROOT / f"metadata/palette-{name}-{colors}.json", pal.tolist())
            timings.append({"stage": f"fit {name} {colors}", "seconds": time.monotonic() - start})
            for bound in [64, 128]:
                w, h = fit_size(images[name].size, bound)
                nearest = images[name].resize((w, h), Image.Resampling.NEAREST)
                outputs = {"nearest_shared": map_palette(nearest, palette)}
                for label, model in [("pyxelate_shared", shared), ("pyxelate_independent", independent)]:
                    # Reuse the fitted palette/model without fitting it to each new image.
                    transformer = copy.copy(model)
                    transformer.width, transformer.height = w, h
                    start = time.monotonic()
                    outputs[label] = Image.fromarray(transformer.transform(a))
                    timings.append({"stage": f"{name} {bound} {colors} {label}", "seconds": time.monotonic() - start})
                for method, image in outputs.items():
                    p = ROOT / f"processed/{bound}/{colors}/{method}/{name}.png"
                    p.parent.mkdir(parents=True, exist_ok=True)
                    image.save(p)
                    records.append(record(p, name, method, bound, colors))
            print("Processed", name, colors, flush=True)
    save_json(ROOT / "metadata/processed-manifest.json", records)
    save_json(ROOT / "metadata/processing-timings.json", timings)
    save_json(ROOT / "metadata/processing-warnings.json", captured)
    save_json(ROOT / "metadata/processing-environment.json", {
        "packages": {p: importlib.metadata.version(p) for p in ["pyxelate", "numpy", "pillow", "scikit-learn", "scikit-image", "scipy", "numba", "llvmlite"]},
        "parameters": json.loads((ROOT / "config.json").read_text())["pyxelate"],
        "BGM_RANDOM_STATE": 1234567, "SVD_RANDOM_STATE": 1234,
        "shared_fit": "2x2 unmodified 1024px sprite collage; BGM_RESIZE=512 => 256px samples per sprite; excludes environment",
        "independent_fit": "BGM_RESIZE=256, unmodified original; one palette per image reused at both target sizes",
        "nearest_palette_mapper": "nearest CIELAB Euclidean (Delta E 76), exported shared uint8 RGB colors; no dither",
        "contrast_note": "Pyxelate uses its BGM classifier and contrast preprocessing; common colors do not isolate resampling alone.",
        "background_removal": False, "threadpool_limit": 4,
    })


def font(size):
    return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)


def checker(size):
    y, x = np.indices((size[1], size[0]))
    a = np.where(((x // 16 + y // 16) % 2)[..., None], 195, 230).astype(np.uint8)
    return Image.fromarray(np.repeat(a, 3, axis=2))


def image_panel(sheet, im, xy, max_size=256, original=False):
    if original:
        im = im.resize(fit_size(im.size, max_size), Image.Resampling.NEAREST)
    else:
        factor = max(1, max_size // max(im.size))
        im = im.resize((im.width * factor, im.height * factor), Image.Resampling.NEAREST)
    panel = checker((max_size, max_size))
    panel.paste(im, ((max_size - im.width) // 2, (max_size - im.height) // 2), im if im.mode == "RGBA" else None)
    sheet.paste(panel, xy)


def sheets():
    for bound in [64, 128]:
        for colors in [16, 32]:
            width, height = 1568, 1744
            sheet = Image.new("RGB", (width, height), "#171d2a")
            draw = ImageDraw.Draw(sheet)
            draw.text((24, 16), f"SDXL + Pixel Art XL  |  {bound} x {bound}  |  {colors} colors", font=font(30), fill="white")
            draw.text((24, 60), f"First seed per subject. No background removal. Dither: none. Outputs enlarged {256 // bound}x with nearest neighbor.", font=font(19), fill="#c6cfdd")
            for col, label in enumerate(LABELS):
                draw.text((24 + col * 308, 106), label, font=font(18), fill="#90c6ff")
            for row, name in enumerate(NAMES):
                y = 150 + row * 310
                for col, method in enumerate(METHODS):
                    x = 24 + col * 308
                    if method == "original":
                        p = ROOT / f"originals/{name}.png"
                    elif method == "nearest":
                        p = ROOT / f"processed/{bound}/nearest/{name}.png"
                    else:
                        p = ROOT / f"processed/{bound}/{colors}/{method}/{name}.png"
                    im = Image.open(p)
                    draw.text((x, y - 23), name.upper(), font=font(16), fill="white")
                    image_panel(sheet, im, (x, y), original=method == "original")
                    note = "1024px source / 256px preview" if method == "original" else f"{im.width} x {im.height} / {256 // bound}x display"
                    draw.text((x, y + 263), note, font=font(14), fill="#c6cfdd")
            draw.text((24, 1706), "Shared palette: four sprites only. Scene transfer is a stress test. Equal palettes do not imply consistent character design.", font=font(17), fill="#e7bd7e")
            sheet.save(ROOT / f"sheets/comparison-{bound}-{colors}.png")


def alpha_probe():
    """Synthetic diagnostic, not background removal or an additional generated asset."""
    dest = ROOT / "alpha-probe"
    dest.mkdir(exist_ok=True)
    report = []
    panels = []
    for hidden, rgb in [("magenta", (255, 0, 255)), ("cyan", (0, 255, 255))]:
        im = Image.new("RGBA", (256, 256), (*rgb, 0))
        d = ImageDraw.Draw(im)
        d.ellipse((56, 48, 200, 192), fill=(32, 40, 64, 255))
        d.ellipse((68, 60, 188, 180), fill=(200, 48, 56, 255))
        d.rectangle((16, 218, 72, 238), fill=(224, 176, 64, 100))
        d.rectangle((100, 218, 156, 238), fill=(224, 176, 64, 153))
        d.rectangle((184, 218, 240, 238), fill=(224, 176, 64, 210))
        im.save(dest / f"input-{hidden}.png")
        for bound in [64, 128]:
            model = pyx_instance(bound, 16, im.size)
            out = model.fit_transform(np.asarray(im))
            Image.fromarray(out).save(dest / f"pyxelate-{hidden}-{bound}.png")
            report.append({"hidden_rgb": hidden, "bound": bound, "input_alpha": [0, 100, 153, 210, 255],
                           "output_alpha": np.unique(out[:, :, 3]).tolist(), "colors": model.colors.reshape(-1, 3).tolist(),
                           "transparent_pixels": int((out[:, :, 3] == 0).sum())})
            if bound == 64:
                panels.extend([(f"{hidden}: input RGBA", im), (f"{hidden}: Pyxelate 64 / 4x", Image.fromarray(out))])
    sheet = Image.new("RGB", (1168, 356), "#171d2a")
    d = ImageDraw.Draw(sheet)
    d.text((16, 12), "Synthetic alpha probe: identical visible RGB, different hidden RGB. No asset background removal.", font=font(19), fill="white")
    for i, (label, im) in enumerate(panels):
        d.text((16 + i * 288, 54), label, font=font(16), fill="#90c6ff")
        image_panel(sheet, im, (16 + i * 288, 82))
    sheet.save(ROOT / "sheets/alpha-probe.png")
    save_json(ROOT / "metadata/alpha-probe.json", report)


def validate():
    records = json.loads((ROOT / "metadata/processed-manifest.json").read_text())
    assert len(records) == 70, len(records)
    for rec in records:
        im = Image.open(ROOT / rec["path"])
        original = Image.open(ROOT / f"originals/{rec['asset']}.png")
        assert im.size == fit_size(original.size, rec["bound"])
        if rec["palette_limit"]:
            assert rec["actual_rgb_colors"] <= rec["palette_limit"]
        if rec["method"] in ["nearest_shared", "pyxelate_shared"]:
            palette = json.loads((ROOT / f"metadata/palette-shared-{rec['palette_limit']}.json").read_text())
            actual = set(map(tuple, np.asarray(im).reshape(-1, 3)))
            assert actual <= set(map(tuple, palette)), rec["path"]
    assert fit_size((1024, 768), 64) == (64, 48)
    assert fit_size((512, 1024), 128) == (64, 128)
    result = {"passed": True, "checked_pngs": len(records), "checks": ["matching aspect-preserving dimensions", "palette color limits", "exact shared palette membership", "non-square sizing fixtures"],
              "note": "These are artifact integrity checks, not perceptual quality scores."}
    save_json(ROOT / "metadata/validation.json", result)
    print(result)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("step", choices=["all", "process", "sheets", "alpha", "validate"], default="all", nargs="?")
    args = parser.parse_args()
    with threadpool_limits(limits=4):
        if args.step in ["all", "process"]:
            process()
        if args.step in ["all", "sheets"]:
            sheets()
        if args.step in ["all", "alpha"]:
            alpha_probe()
        if args.step in ["all", "validate"]:
            validate()
