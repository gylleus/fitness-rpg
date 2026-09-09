#!/usr/bin/env python3
"""Reproduce the saved profile-guide crop; does not generate or retouch pixels."""
import hashlib
import io
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
recipe = json.loads((ROOT / "guides/barbarian-profile.json").read_text())
source = REPO / recipe["source"]
with Image.open(source) as image:
    # PNG byte hashes also include generation timing metadata. Compare decoded
    # pixels so an otherwise identical regeneration remains usable as a guide.
    if list(image.size) != recipe["source_size"] or hashlib.sha256(image.convert("RGBA").tobytes()).hexdigest() != recipe["source_rgba_sha256"]:
        raise ValueError("The guide source pixels differ from the saved reference trial")
    guide = ImageOps.pad(image.crop(recipe["crop"]), tuple(recipe["size"]),
                         method=Image.Resampling.NEAREST, color=tuple(recipe["padding_rgb"]))
encoded = io.BytesIO()
guide.save(encoded, format="PNG")
target = ROOT / "guides/barbarian-profile.png"
if target.exists() and target.read_bytes() != encoded.getvalue():
    raise ValueError("Rebuilt guide differs; preserved the existing image for inspection")
target.write_bytes(encoded.getvalue())
print(target)
