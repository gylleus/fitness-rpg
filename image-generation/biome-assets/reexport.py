"""Recompile installed scenery from its recorded masters with a new pixel profile."""
from copy import deepcopy
import json
from pathlib import Path
import sys

from biome_assets import ROOT, safe_id, save, sha, tomllib
from pixel_style import compile_texture, export_contract, load_profile


def reexport_biome(biome, out=None, style_path=None):
    import numpy as np
    from PIL import Image
    from interiors import prepared_scene

    safe_id(biome)
    folder = ROOT / "assets/biomes" / biome
    destination = Path(out or folder).resolve()
    sources = json.loads((folder / "sources.json").read_text())
    profile = load_profile(style_path)
    scene_path = folder / "interior.json"
    scene = json.loads(scene_path.read_text()) if scene_path.exists() else None
    if scene:
        canvases = {layer["image"]: layer["canvas"] for layer in scene["layers"]}
        ground_ids = {s["id"] for s in sources.values() if "surface_y" in s}
    else:
        definition = tomllib.loads((ROOT / f"content/biomes/{biome}/BIOME.toml").read_text())
        canvases = {key: definition["generation"]["scene"]["canvas"] for key in sources}
        ground_ids = {s["id"] for s in definition["ground_sections"]}
        for key, spec in sources.items():
            if spec["id"] in ground_ids:
                canvases[key] = definition["generation"]["ground"]["canvas"]
    if scene and scene["reference_height"] != profile["reference_height"]:
        raise ValueError("Scene and pixel profile must use the same reference actor height")
    prepared = {}
    runtime = deepcopy(sources)
    for key, spec in sources.items():
        source = ROOT / spec["source"]
        if sha(source) != spec.get("source_sha256", spec["sha256"]):
            raise ValueError(f"Recorded source changed: {source}")
        if key == "props":
            continue
        kind = "ground" if spec["id"] in ground_ids else "background"
        canvas = spec.get("canvas", canvases.get(key))
        if canvas is None:
            raise ValueError(f"Missing logical canvas: {key}")
        image = compile_texture(Image.open(source), canvas, profile, kind)
        record = runtime[key]
        record.update(source_sha256=sha(source), canvas=canvas, size=list(image.size),
                      export={**export_contract(profile, kind), "alpha": "opaque" if image.getchannel("A").getextrema()[0] == 255 else "binary"})
        if kind == "ground":
            alpha = np.array(image.getchannel("A")) > 0
            if not alpha.any(axis=0).all():
                raise ValueError("Ground must provide contact across its complete width")
            record["surface_y"] = float(np.median(alpha.argmax(axis=0))) * canvas[1] / image.height
        prepared[key] = image
    if scene:
        for layer in scene["layers"]:
            if layer["role"] == "ceiling":
                layer["origin_y"] = "alpha_bottom"
        scene = prepared_scene({"interior": scene}, {
            layer["asset_id"]: prepared[layer["image"]] for layer in scene["layers"]})
    destination.mkdir(parents=True, exist_ok=True)
    for key, image in prepared.items():
        path = destination / f"{key}.png"
        image.save(path, optimize=True)
        runtime[key]["sha256"] = sha(path)
    save(destination / "sources.json", runtime)
    if scene:
        save(destination / "interior.json", scene)
    if "props" in sources:
        sys.path.insert(0, str(ROOT / "scripts"))
        from bundle_scenery import bundle
        bundle(biome, (ROOT / sources["props"]["source"]).parent, destination, profile)
    return destination
