"""Trim generated prop sheets and pack one grounded texture atlas per biome.

uv run sprite-python scripts/bundle_scenery.py --biome hollow_delve
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import tomllib

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
RECIPES = ROOT / "image-generation/scene-samples/biome-props-v2"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def trim_prop(image, max_edge=256, threshold=128):
    """Discard faint matte and tiny detached specks, then trim visible pixels.

    Significant separate parts are retained. Nothing is painted or stretched;
    aspect ratio is preserved and only a common nearest reduction is applied.
    """
    rgba = np.array(image.convert("RGBA"))
    labels, _ = ndimage.label(rgba[..., 3] >= threshold, np.ones((3, 3)))
    areas = np.bincount(labels.ravel())
    areas[0] = 0
    if not areas.max():
        raise ValueError("Empty prop cell")
    minimum = max(4, int(areas.max() * .002))
    keep = np.flatnonzero(areas >= minimum)
    mask = np.isin(labels, keep)
    removed = int(((rgba[..., 3] >= threshold) & ~mask).sum())
    rgba[..., 3] = mask.astype(np.uint8) * 255
    rgba[~mask] = 0
    clean = Image.fromarray(rgba)
    bounds = clean.getbbox()
    if not bounds:
        raise ValueError("No supported prop pixels")
    clean = clean.crop(bounds)
    ratio = min(1, max_edge / max(clean.size))
    size = tuple(max(1, round(n * ratio)) for n in clean.size)
    clean = clean.resize(size, Image.Resampling.NEAREST)
    # Nearest reduction can lose the last sparse row. Trim once more so the
    # declared support line cannot sit below an empty exported row.
    reduced_bounds = clean.getbbox()
    clean = clean.crop(reduced_bounds)
    return clean, {"source_trim": list(bounds), "reduced_trim": list(reduced_bounds),
                   "removed_detached_pixels": removed, "components": len(keep)}


def pack_rectangles(sizes, width=2048, padding=2):
    """Deterministic height-sorted shelves with transparent gutters."""
    if width <= 0 or padding < 1:
        raise ValueError("Atlas needs a positive width and gutter")
    x = y = padding
    shelf = 0
    packed = {}
    for key, (w, h) in sorted(sizes.items(), key=lambda item: (-item[1][1], item[0])):
        if min(w, h) <= 0 or w + 2 * padding > width:
            raise ValueError(f"Invalid or oversized prop: {key}")
        if x + w + padding > width:
            x = padding
            y += shelf + 2 * padding
            shelf = 0
        packed[key] = {"x": x, "y": y, "width": w, "height": h}
        x += w + 2 * padding
        shelf = max(shelf, h)
    # Skia supports non-power-of-two textures. Rounding a 1030px shelf up to
    # 2048 would nearly double decoded memory with only transparent pixels.
    height = y + shelf + padding
    return packed, (width, height)


def bundle(biome, recipe_dir=None, destination=None):
    folder = recipe_dir or RECIPES / biome
    out = destination or ROOT / "assets/biomes" / biome
    recipe = json.loads((folder / "recipe.json").read_text())
    if recipe["biome_id"] != biome:
        raise ValueError("Recipe/biome mismatch")
    authored_definitions = recipe.get("definitions")
    if authored_definitions is None:
        authored_definitions = tomllib.loads(
            (ROOT / f"content/biomes/{biome}/SCENERY.toml").read_text())["scenery"]
    definitions = {p["id"]: p for p in authored_definitions}
    if len(definitions) != len(authored_definitions):
        raise ValueError("Duplicate decoration definitions")
    source_records = {}
    tiles = {}
    props = {}
    loose_bytes = 0
    source_pixels = 0
    for spec in recipe["sheets"]:
        path = folder / spec["image"]
        source = Image.open(path).convert("RGBA")
        digest = sha(path.read_bytes())
        if spec.get("sha256") != digest:
            raise ValueError(f"Missing or changed source hash: {path}")
        prompt = (folder / spec["prompt_file"]).read_text()
        source_records[spec["image"]] = {"sha256": digest, "generation_prompt": prompt,
                                        "backend": "built-in imagegen"}
        columns, rows = spec["columns"], spec["rows"]
        if len(spec["props"]) != columns * rows:
            raise ValueError("Each authored cell needs exactly one prop ID")
        for index, key in enumerate(spec["props"]):
            if key in props or key not in definitions:
                raise ValueError(f"Duplicate or unknown prop: {key}")
            definition = definitions[key]
            if definition["generation"]["anchor"] != "ground":
                raise ValueError(f"Waterline prop cannot be planted on a path: {key}")
            col, row = index % columns, index // columns
            cell = spec.get("regions", {}).get(key, [round(col * source.width / columns),
                round(row * source.height / rows), round((col + 1) * source.width / columns),
                round((row + 1) * source.height / rows)])
            if len(cell) != 4 or any(type(n) is not int for n in cell) or not (
                0 <= cell[0] < cell[2] <= source.width and 0 <= cell[1] < cell[3] <= source.height
            ):
                raise ValueError(f"Invalid source extraction region: {key}")
            tile, trimming = trim_prop(source.crop(cell), recipe["max_prop_edge"], recipe["alpha_threshold"])
            x0, y0, x1, y1 = trimming["source_trim"]
            if x0 == 0 or y0 == 0 or x1 == cell[2]-cell[0] or y1 == cell[3]-cell[1]:
                raise ValueError(f"Prop touches source cell edge; review extraction region: {key}")
            source_pixels += (cell[2]-cell[0])*(cell[3]-cell[1])
            tiles[key] = tile
            encoded = io.BytesIO()
            tile.save(encoded, format="PNG", optimize=True)
            loose_bytes += len(encoded.getvalue())
            props[key] = {"name": definition["name"], "anchor": [tile.width / 2, tile.height],
                "height_scale": definition["generation"]["height_scale"],
                "pixels_sha256": sha(tile.tobytes()),
                "source": {"image": str(path.relative_to(ROOT)), "sha256": digest,
                    "cell": cell, "alpha_threshold": recipe["alpha_threshold"], **trimming}}
    frames, size = pack_rectangles({key: tile.size for key, tile in tiles.items()}, recipe["atlas_width"], recipe["padding"])
    atlas = Image.new("RGBA", size)
    for key, tile in tiles.items():
        frame = frames[key]
        atlas.paste(tile, (frame["x"], frame["y"]))
        props[key]["frame"] = frame
    out.mkdir(parents=True, exist_ok=True)
    image_path = out / "props.png"
    atlas.save(image_path, optimize=True)
    manifest = {"schema_version": 1, "biome_id": biome, "image": "props.png", "size": list(size),
        "sha256": sha(image_path.read_bytes()), "padding": recipe["padding"], "props": props}
    (out / "props.json").write_text(json.dumps(manifest, indent=2) + "\n")
    runtime = json.loads((out / "sources.json").read_text()) if (out / "sources.json").exists() else {}
    runtime = {key: spec for key, spec in runtime.items() if spec["id"] not in props}
    runtime["props"] = {"id": f"{biome}_prop_atlas", "source": str((folder / "recipe.json").relative_to(ROOT)),
        "source_sha256": sha((folder / "recipe.json").read_bytes()), "sha256": manifest["sha256"],
        "size": list(size), "backend": "built-in imagegen; trimmed nearest cutouts in one atlas"}
    (out / "sources.json").write_text(json.dumps(runtime, indent=2) + "\n")
    (folder / "sources.json").write_text(json.dumps(source_records, indent=2) + "\n")
    report = {"props": len(props), "source_cell_pixels": source_pixels,
        "trimmed_prop_pixels": sum(tile.width * tile.height for tile in tiles.values()),
        "atlas_size": list(size), "decoded_rgba_bytes": size[0]*size[1]*4,
        "individual_png_bytes": loose_bytes, "atlas_png_bytes": image_path.stat().st_size,
        "contact": "Every packed cutout has nonempty bottom pixels at its ground anchor; source padding is removed."}
    (folder / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
    # Review includes a visible support line, using exactly the packed pixels.
    review = Image.new("RGB", (1280, ((len(props)+7)//8)*210), "#222a31")
    draw = ImageDraw.Draw(review)
    for i, (key, tile) in enumerate(tiles.items()):
        x, y = (i % 8)*160, (i//8)*210
        preview = tile.copy()
        preview.thumbnail((150, 175), Image.Resampling.NEAREST)
        review.paste(preview, (x+(160-preview.width)//2, y+180-preview.height), preview)
        draw.line((x, y+180, x+159, y+180), fill="#98b36b")
        draw.text((x+3, y+188), key.removeprefix(biome+"_")[:24], fill="#eeeecc")
    review.save(folder / "contact-review.png")
    print(json.dumps({"biome": biome, **report}))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--biome", choices=("wetlands", "hollow_delve"), required=True)
    args = parser.parse_args()
    bundle(args.biome)
