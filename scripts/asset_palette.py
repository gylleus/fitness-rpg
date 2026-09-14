"""One master palette for every game-art exporter (no image/model dependencies at import).

uv run sprite-python scripts/asset_palette.py map SOURCE.png OUTPUT.png
uv run sprite-python scripts/asset_palette.py check [PNG ...]
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PALETTE = ROOT / "assets/palette.json"


def load_palette():
    palette = json.loads(PALETTE.read_text())
    colors = palette.get("colors", [])
    if not 2 <= len(colors) <= 256 or any(not isinstance(c, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", c) for c in colors):
        raise ValueError("Master palette requires 2..256 #RRGGBB colors")
    if len({c.lower() for c in colors}) != len(colors):
        raise ValueError("Master palette contains duplicate colors")
    return palette


def palette_contract():
    return {"file": "assets/palette.json", "name": load_palette()["name"],
            "sha256": hashlib.sha256(PALETTE.read_bytes()).hexdigest(),
            "metric": "ciede2000", "dither": "none"}


def palette_guidance():
    palette = load_palette()
    return (f"Global game palette: {palette['name']}. Use only these RGB colors: "
            + ", ".join(palette["colors"]) + ". "
            "Choose a small material-appropriate subset; share the actors' shadow and highlight ramps. "
            "Use connected color shapes and three or four stepped shades per material; no dithering, "
            "airbrushed gradients or invented intermediate colors. Local color descriptions are material intent, "
            "not additional palette colors. Final exports enforce this master palette.")


def palette_colors():
    import numpy as np
    return np.array([list(bytes.fromhex(c[1:])) for c in load_palette()["colors"]], dtype=np.uint8)


def map_palette(image, colors=None, metric="ciede2000"):
    """Map exact RGB values without dithering; bounded memory even for large masters.

    RGBA coverage is preserved byte-for-byte. Fully hidden RGB is cleared and
    cannot influence visible colors. Every identical RGB maps identically across
    assets, frames and biomes. Already-correct palette pixels stay exact.
    """
    import numpy as np
    from PIL import Image
    from skimage.color import rgb2lab, deltaE_ciede2000

    allowed = palette_colors()
    if colors is not None and not np.array_equal(colors, allowed):
        raise ValueError("Per-asset palettes are unsupported; edit assets/palette.json")
    if metric not in ("ciede2000", "cie76"):
        raise ValueError(f"Unknown palette metric: {metric}")
    rgba = np.array(image.convert("RGBA"))
    visible = rgba[..., 3] > 0
    unique, inverse = np.unique(rgba[visible, :3], axis=0, return_inverse=True)
    mapped = np.empty_like(unique)
    palette_lab = rgb2lab(allowed[None, :, :] / 255.0)[0]
    for start in range(0, len(unique), 8192):
        batch = unique[start:start + 8192]
        lab = rgb2lab(batch[None, :, :] / 255.0)[0]
        distance = (deltaE_ciede2000(lab[:, None, :], palette_lab[None, :, :]) if metric == "ciede2000"
                    else ((lab[:, None, :] - palette_lab[None, :, :]) ** 2).sum(-1))
        mapped[start:start + len(batch)] = allowed[distance.argmin(-1)]
    rgba[visible, :3] = mapped[inverse]
    rgba[~visible, :3] = 0
    result = Image.fromarray(rgba)
    return result.convert("RGB") if image.mode == "RGB" else result


def validate_image(image, label="image"):
    import numpy as np
    rgba = np.asarray(image.convert("RGBA"))
    actual = set(map(tuple, np.unique(rgba[rgba[..., 3] > 0, :3], axis=0)))
    invalid = actual - set(map(tuple, palette_colors()))
    if invalid:
        examples = ["#" + bytes(c).hex() for c in sorted(invalid)[:5]]
        raise ValueError(f"{label}: {len(invalid)} visible colors outside {load_palette()['name']}: {examples}")
    return len(actual)


def runtime_files():
    return sorted(path for folder in ("sprites", "biomes", "items", "maps")
                  for path in (ROOT / "assets" / folder).rglob("*.png"))


def main():
    from PIL import Image
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    mapper = commands.add_parser("map")
    mapper.add_argument("source", type=Path)
    mapper.add_argument("output", type=Path)
    commands.add_parser("guidance", help="Print the shared prompt clause for any generation backend")
    check = commands.add_parser("check")
    check.add_argument("files", type=Path, nargs="*")
    check.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.command == "guidance":
        print(palette_guidance())
        return
    if args.command == "map":
        if args.source.resolve() == args.output.resolve():
            raise ValueError("Export must not overwrite its source master")
        image = map_palette(Image.open(args.source))
        validate_image(image, args.source)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        image.save(args.output, optimize=True)
    else:
        records = {}
        for path in args.files or runtime_files():
            with Image.open(path) as image:
                records[str(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path)] = {
                    "colors": validate_image(image, path), "size": list(image.size),
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        report = {"palette": palette_contract(), "files": records, "passed": True}
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(f"Verified {len(records)} game textures: every visible RGB belongs to {load_palette()['name']}.")


if __name__ == "__main__":
    main()
