"""Validate real static mask pilot and assemble integer-NN inspection sheets."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

from common import ROOT, save_json, sha256
from pixels import palette_colors, comparison


def main():
    root = ROOT / "outputs/mask-pilot"
    colors = set(map(tuple, palette_colors()))
    records, rows, background_rows = [], [], []
    for name in ("knight-idle", "lantern-flame", "wraith-hover"):
        out = root / name
        for size in (64, 128):
            panels = []
            for method in ("unmasked", "nearest", "conservative"):
                path = out / f"{name}-{method}-{size}.png"
                im = Image.open(path).convert("RGBA")
                a = np.array(im)
                assert im.size == (size, size)
                assert set(np.unique(a[..., 3])) <= {0, 255}
                assert set(map(tuple, a[a[..., 3] > 0, :3])) <= colors
                records.append({"path": str(path.relative_to(root)), "sha256": sha256(path),
                    "visible_colors": len(set(map(tuple, a[a[..., 3] > 0, :3]))),
                    "transparent_pixels": int((a[..., 3] == 0).sum()), "dimensions": list(im.size)})
                panels.append((method, im))
            rows.append((f"{name} / {size}px / static source mask test", panels))
        for method in ("nearest", "conservative"):
            im = Image.open(out / f"{name}-{method}-128.png").convert("RGBA")
            panels = []
            for color in ("#ffffff", "#000000", "#265c42"):
                bg = Image.new("RGBA", im.size, color)
                bg.alpha_composite(im)
                panels.append((color, bg))
            background_rows.append((f"{name} / {method} / 128px on game backgrounds", panels))
    comparison(rows, root / "comparison.png")
    comparison(background_rows, root / "background-check.png")
    save_json(ROOT / "metadata/mask-pilot-validation.json", {"assets": records,
        "checks": "18 actual PNGs; exact dimensions, binary alpha, visible ENDESGA 32 membership",
        "models": "BiRefNet general, CPU ONNX", "motion_generated": False})
    print("18 real mask-pilot PNGs validated; comparison and background-check sheets saved.")


if __name__ == "__main__":
    main()
