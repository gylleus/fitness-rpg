"""Complete reviewable scenery sets using shared plans and the existing prop packer."""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys

from biome_assets import HERE, ROOT, bundle, digest, save, sha, tomllib
from interiors import make_interior_plan


def make_set_plan(theme, biome_id=None, recipe_path=None, decorations_path=None):
    plan = make_interior_plan(theme, biome_id, recipe_path)
    decorations_path = Path(decorations_path or HERE / "decorations.toml")
    decor = tomllib.loads(decorations_path.read_text())
    if decor["schema_version"] != 1 or theme not in decor:
        raise ValueError(f"No decoration recipe for interior theme: {theme}")
    selected = decor[theme]
    biome = plan["biome_id"]
    recipe = tomllib.loads(plan["recipe"]["text"])["themes"][theme]
    shared = f"Style: {plan['style']['style']} {plan['style']['background']}\nPalette: {recipe['palette']}\nLighting: {recipe['lighting']}"
    ground_prompt = "\n".join([
        "Use case: stylized-concept", f"Asset type: isolated walking floor strip for {recipe['name']}",
        f"Subject: {selected['ground']}", shared,
        "Strict orthographic side view. Wide 8:3 image, 2048 by 768 pixels, logical canvas 256 by 96. A continuous level walking lip at one quarter of the image height. Opaque earth or masonry fills everything below it through the bottom edge; genuine alpha transparency above. Compatible left and right edges for mirror repetition.",
        "No props, characters, roof, receding perspective, checkerboard, matte, text, floating objects or floor gaps."])
    props = [{**deepcopy(p), "id": f"{biome}_{p['id']}", "generation": {"anchor": "ground", "height_scale": p["height_scale"]}} for p in selected["props"]]
    if len(props) != 8 or len({p["id"] for p in props}) != 8:
        raise ValueError("A scenery sheet requires eight unique authored props")
    prop_prompt = "\n".join([
        "Use case: stylized-concept", f"Asset type: eight separate decoration cutouts for {recipe['name']}",
        shared, f"Prop detail: {plan['style']['prop']}",
        "Exactly FOUR columns by TWO rows, eight equal cells, wide 2:1 canvas 2048 by 1024. Each cell contains exactly one complete isolated prop or the specified small grouped object, centered with at least 40 pixels of clear padding on every side. No grid lines or labels. All props sit on a flat invisible ground line within their own cell, with no cast shadow, ground patch or backdrop. Strict orthographic side view, no strong overhead perspective. Real transparent alpha outside every object, including holes and between cells.",
        "Cell order, left to right then top to bottom:",
        *[f"{i+1}. {p['name']}" for i, p in enumerate(props)],
        "Keep each object entirely within its cell, especially poles and handles. No characters, words, symbols, checkerboard, walls, floors or roof."])
    for key, kind, canvas, prompt in [("ground", "ground", [256, 96], ground_prompt), ("decorations", "prop_sheet", [2048, 1024], prop_prompt)]:
        plan["assets"].append({"id": f"{biome}_{key}", "name": key, "kind": kind, "canvas": canvas,
            "transparent": True, "prompt": prompt, "prompt_sha256": digest(prompt),
            "export": {"resolution": "source" if kind == "prop_sheet" else "logical", "sampling": "nearest", "colors": "source", "alpha": "binary"},
            **({"sheet": {"columns": 4, "rows": 2, "props": props}} if kind == "prop_sheet" else {})})
    plan["decorations_recipe"] = {"text": decorations_path.read_text(), "sha256": sha(decorations_path)}
    return plan


def assemble_set(plan_path, manifest_path, out, regions_path=None):
    plan_path, manifest_path, out = Path(plan_path).resolve(), Path(manifest_path).resolve(), Path(out).resolve()
    plan, manifest = json.loads(plan_path.read_text()), json.loads(manifest_path.read_text())
    if manifest["inputs"]["plan_sha256"] != sha(plan_path):
        raise ValueError("Prepared set does not match the saved plan")
    sheets = [a for a in plan["assets"] if a["kind"] == "prop_sheet"]
    grounds = [a for a in plan["assets"] if a["kind"] == "ground"]
    if len(sheets) != 1 or len(grounds) != 1 or "interior" not in manifest:
        raise ValueError("A complete set needs interior layers, one ground and one decoration sheet")
    sheet = sheets[0]
    regions = json.loads(Path(regions_path).read_text()) if regions_path else {}
    if set(regions) - {p["id"] for p in sheet["sheet"]["props"]}:
        raise ValueError("Extraction regions name unknown decorations")
    prepared = manifest["assets"][sheet["id"]]
    sheet_image = manifest_path.parent / prepared["image"]
    if sha(sheet_image) != prepared["sha256"] or sha(manifest_path.parent / prepared["source"]) != prepared["source_sha256"]:
        raise ValueError("Decoration source or prepared image changed")
    out.mkdir(parents=True, exist_ok=True)
    mapping = {layer["asset_id"]: layer["id"] for layer in manifest["interior"]["layers"]}
    mapping[grounds[0]["id"]] = "ground"
    save(out / "runtime-mapping.json", mapping)
    bundle(manifest_path, out / "runtime-mapping.json", out)
    recipe_dir = out / "prop-recipe"
    recipe_dir.mkdir(exist_ok=True)
    (recipe_dir / "prompt.txt").write_text(sheet["prompt"] + "\n")
    save(recipe_dir / "recipe.json", {"schema_version": 1, "biome_id": plan["biome_id"],
        "alpha_threshold": 128, "max_prop_edge": 240, "atlas_width": 1024, "padding": 2,
        "definitions": sheet["sheet"]["props"], "sheets": [{"image": os.path.relpath(sheet_image, recipe_dir),
            "sha256": prepared["sha256"], "prompt_file": "prompt.txt", "columns": sheet["sheet"]["columns"],
            "rows": sheet["sheet"]["rows"], "regions": regions,
            "props": [p["id"] for p in sheet["sheet"]["props"]]}]})
    sys.path.insert(0, str(ROOT / "scripts"))
    from bundle_scenery import bundle as bundle_props
    bundle_props(plan["biome_id"], recipe_dir, out)
    subprocess.run(["node", str(ROOT / "scripts/build-interior-review.cjs"), str(out)], check=True, cwd=ROOT)
