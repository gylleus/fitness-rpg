#!/usr/bin/env python3
"""Package generated props and the authored cave backgrounds for the game.

uv run sprite-python image-generation/scene-samples/hollow-delve-props-v1/prepare.py
"""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tomllib

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "image-generation/sprite-animation"))
from pixels import convert


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    out = ROOT / "assets/biomes/hollow_delve"
    out.mkdir(parents=True, exist_ok=True)
    sources = json.loads((HERE / "sources.json").read_text())
    content = tomllib.loads((ROOT / "content/biomes/hollow_delve/SCENERY.toml").read_text())
    specs = [(s["id"], s["generation"]["canvas"], s["generation"]["height_scale"]) for s in content["scenery"]]
    specs.append(("hollow_delve_slate_path", [256, 96], None))
    manifest = {}
    for asset_id, size, height_scale in specs:
        source = HERE / f"{asset_id}.png"
        if sha(source) != sources[asset_id]["sha256"]:
            raise ValueError(f"Source changed: {source}")
        result = convert(Image.open(source), size, "nearest")
        key = asset_id.removeprefix("hollow_delve_")
        dest = out / f"{key}.png"
        result.save(dest)
        manifest[key] = {"id": asset_id, "source": str(source.relative_to(ROOT)),
                         "source_sha256": sha(source), "sha256": sha(dest), "size": size,
                         "bounds": list(result.getbbox()), "height_scale": height_scale,
                         "backend": "built-in imagegen; ENDESGA32 nearest CPU export"}
        if key == "slate_path":
            # Source top edge is at y=380, with the first complete opaque row
            # at y=382. The exported walkable surface is row 36, not row 24.
            manifest[key]["surface_y"] = 36
    for key in ("landscape", "timber_gallery", "sunken_cavern"):
        source = HERE.parent / "hollow-delve-v1/backgrounds" / f"hollow_delve_{key}.png"
        dest = out / f"{key}.png"
        shutil.copyfile(source, dest)
        manifest[key] = {"id": f"hollow_delve_{key}", "source": str(source.relative_to(ROOT)),
                         "source_sha256": sha(source), "sha256": sha(dest),
                         "size": list(Image.open(source).size),
                         "backend": "local SDXL; see hollow-delve-v1/provenance"}
    (out / "sources.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Packaged {len(manifest)} Hollow Delve scenery images → {out}")


if __name__ == "__main__":
    main()
