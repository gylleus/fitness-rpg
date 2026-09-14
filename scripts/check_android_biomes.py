"""Verify that runtime biome art and chapter routing actually ship in an APK.

uv run sprite-python scripts/check_android_biomes.py --aapt2 /PATH/TO/aapt2
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile

from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def check(apk, aapt2):
    resources = subprocess.run([str(aapt2), "dump", "resources", str(apk)],
                               check=True, capture_output=True, text=True).stdout
    textures = []
    with zipfile.ZipFile(apk) as archive:
        for manifest in sorted((ROOT / "assets/biomes").glob("*/sources.json")):
            for slot, spec in json.loads(manifest.read_text()).items():
                file = manifest.parent / f"{slot}.png"
                source = Image.open(file).convert("RGBA")
                if hashlib.sha256(file.read_bytes()).hexdigest() != spec["sha256"]:
                    raise ValueError(f"Runtime texture differs from manifest: {file}")
                name = f"assets_biomes_{manifest.parent.name}_{slot}"
                # AAPT2 shortens APK filenames. Resolve the actual resource table
                # instead of assuming that source filenames survive packaging.
                match = re.search(r"drawable/" + re.escape(name) + r"\n\s+\(mdpi\) \(file\) (\S+) type=PNG", resources)
                if not match:
                    raise ValueError(f"Biome texture is missing from the APK: {name}")
                packed = Image.open(io.BytesIO(archive.read(match[1]))).convert("RGBA")
                original, installed = np.asarray(source), np.asarray(packed)
                # Android may discard RGB hidden under zero alpha. Those bytes
                # never draw; alpha and every visible color must still match.
                if source.size != packed.size or not np.array_equal(original[..., 3], installed[..., 3]) or not np.array_equal(
                    original[original[..., 3] != 0], installed[original[..., 3] != 0]
                ):
                    raise ValueError(f"APK texture pixels differ from runtime art: {name}")
                textures.append(name)
        compiled = ROOT / "android/app/build/generated/assets/react/release/index.android.bundle"
        if archive.read("assets/index.android.bundle") != compiled.read_bytes():
            raise ValueError("APK does not contain this build's compiled JavaScript bundle")
    source_map = json.loads((ROOT / "android/app/build/intermediates/sourcemaps/react/release/index.android.bundle.packager.map").read_text())
    modules = ["src/ui/DungeonJourney.tsx", "src/scenes/interiorRoutes.ts",
               "src/scenes/interiorLocations.ts", "src/scenes/InteriorLocationBackdrop.tsx",
               "src/scenes/wetlands.ts"]
    for file in modules:
        matches = [i for i, name in enumerate(source_map["sources"]) if name.endswith(file)]
        if len(matches) != 1 or source_map["sourcesContent"][matches[0]] != (ROOT / file).read_text():
            raise ValueError(f"The packaged chapter routing differs from the worktree: {file}")
    return {"apk": str(apk), "apk_sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
            "runtime_textures": len(textures), "routing_modules": modules,
            "checks": ["all runtime biome textures packaged", "manifest hashes, alpha and exact visible pixels",
                       "APK contains current compiled bundle", "chapter routing sources match worktree"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, default=ROOT / "android/app/build/outputs/apk/release/app-release.apk")
    parser.add_argument("--aapt2", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = json.dumps(check(args.apk.resolve(), args.aapt2), indent=2) + "\n"
    if args.out:
        args.out.write_text(report)
    print(report, end="")
