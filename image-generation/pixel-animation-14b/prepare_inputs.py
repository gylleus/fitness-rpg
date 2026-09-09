#!/usr/bin/env python3
"""Prepare exact native-pixel references from the previous automatic cutout pilot."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "sprite-animation"))
from PIL import Image
from pixels import fixed_crop, convert, comparison
from common import save_json, sha256


def prepare():
    config = json.loads((ROOT / "config.json").read_text())
    (ROOT / "inputs").mkdir(exist_ok=True)
    rows, records = [], {}
    for key, preset in config["presets"].items():
        source = (ROOT / preset["source_cutout"]).resolve()
        cut = Image.open(source).convert("RGBA")
        crops, box = fixed_crop([cut], margin=.16)
        native = convert(crops[0], 128, "nearest", color_metric="ciede2000")
        native.save(ROOT / f"inputs/{key}-128.png")
        enlarged = native.resize((512, 512), Image.Resampling.NEAREST)
        background = Image.new("RGBA", enlarged.size, "#8b9bb4")
        background.alpha_composite(enlarged)
        background.convert("RGB").save(ROOT / preset["reference"])
        records[key] = {"source": str(source), "sha256": sha256(source), "crop": box,
            "native_size": 128, "upscale": 4, "background": "#8b9bb4",
            "mask": "Prior automatic BiRefNet cutout, reused without hand edits",
            "reference_sha256": sha256(ROOT / preset["reference"])}
        rows.append((key, [("128px ENDESGA reference", native)]))
    save_json(ROOT / "inputs/provenance.json", records)
    comparison(rows, ROOT / "inputs/references.png")


if __name__ == "__main__":
    prepare()
