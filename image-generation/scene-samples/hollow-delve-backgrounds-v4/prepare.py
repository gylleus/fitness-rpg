"""Preserve the complete detailed background pixels in runtime PNGs."""
from pathlib import Path
import hashlib
import json
import shutil

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
out = ROOT / "assets/biomes/hollow_delve"
runtime = json.loads((out / "sources.json").read_text())
sources = json.loads((HERE / "sources.json").read_text())
for key in ("landscape", "timber_gallery", "sunken_cavern"):
    source = HERE / f"{key}.png"
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != sources[key]["sha256"]:
        raise ValueError(f"Source image changed: {source}")
    image = Image.open(source)
    if image.width < 1500 or image.height < 840:
        raise ValueError("Detailed cave backgrounds must retain full generation resolution")
    shutil.copyfile(source, out / f"{key}.png")
    runtime[key] = {"id": f"hollow_delve_{key}", "source": str(source.relative_to(ROOT)),
        "source_sha256": digest, "sha256": digest, "size": list(image.size),
        "backend": "built-in imagegen; full source resolution and colors preserved"}
(out / "sources.json").write_text(json.dumps(runtime, indent=2) + "\n")
print("Packaged three full-resolution Hollow Delve background panels")
