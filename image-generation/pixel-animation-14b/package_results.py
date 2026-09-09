#!/usr/bin/env python3
"""Package actual-size assets and provenance, excluding weights and runtimes."""
import json
from pathlib import Path
import sys
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "sprite-animation"))
from PIL import Image
from pixels import comparison
from common import save_json, sha256


def package():
    rows = []
    for name in ("knight-pixel", "wraith-pixel", "lantern-pixel"):
        folder = ROOT / "outputs" / name / "export/nearest-128/full-rate"
        if folder.exists():
            rows.append((f"{name}: nearest + ENDESGA, 128px native, full-rate cycle samples",
                [(f"frame {i}", Image.open(folder / f"frame-{i:03d}.png")) for i in (0, 14, 28, 43)]))
    if rows:
        comparison(rows, ROOT / "outputs/selected.png")
    files = list(ROOT.glob("*.py")) + list(ROOT.glob("*.md")) + list(ROOT.glob("*.json")) + list(ROOT.glob("*.lock.txt"))
    files += list((ROOT / "inputs").glob("*"))
    files += list((ROOT / "metadata").glob("*.json")) + list((ROOT / "metadata").glob("*.md"))
    files += list((ROOT / "outputs").glob("*.html")) + list((ROOT / "outputs").glob("*.png"))
    files += [p for p in (ROOT / "outputs").glob("*.json") if p.name != "package.json"]
    for assessment in (ROOT / "outputs").glob("*/assessment.json"):
        job = assessment.parent
        files += list(job.glob("*.json")) + list(job.glob("*.png"))
        for folder in ("frames", "tracking/cutouts", "export"):
            files += [p for p in (job / folder).rglob("*") if p.is_file()]
        for stage in ("high", "low"):
            files += list((job / stage).glob("*.json")) + list((job / stage).glob("*.log"))
    files = sorted(set(p for p in files if p.is_file()))
    archive = ROOT / "outputs/pixel-animation-assets.zip"
    with ZipFile(archive, "w", ZIP_DEFLATED, compresslevel=6) as z:
        for path in files:
            z.write(path, "pixel-animation-14b/" + str(path.relative_to(ROOT)))
        z.write(ROOT.parent / "sprite-animation/requirements.lock.txt", "pixel-animation-14b/dependencies/sprite-animation-requirements.lock.txt")
    with ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError("Archive CRC validation failed")
    save_json(ROOT / "outputs/package.json", {"archive": archive.name, "bytes": archive.stat().st_size,
        "sha256": sha256(archive), "files": len(files) + 1,
        "note": "Assets, code and provenance. Model weights and Python/Comfy runtime are reused from the repository and are not included."})
    print(archive)


if __name__ == "__main__":
    package()
