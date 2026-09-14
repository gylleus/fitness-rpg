"""Plan biome art from canonical content; prepare and bundle reviewed static sources."""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import sys

if sys.version_info < (3, 11):
    import tomli as tomllib
else:
    import tomllib

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def safe_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", value):
        raise ValueError(f"Invalid asset/biome ID: {value}")
    return value


def make_plan(biome_id, kind="all", selected=None, content_root=None, style_path=None, recipe_path=None):
    safe_id(biome_id)
    content_root = Path(content_root or ROOT / "content")
    folder = content_root / "biomes" / biome_id
    paths = {name: folder / f"{name}.toml" for name in ("BIOME", "SCENERY", "ENEMIES")}
    documents = {name: tomllib.loads(path.read_text()) for name, path in paths.items()}
    biome = documents["BIOME"]
    if biome["id"] != biome_id or any(doc["biome_id"] != biome_id for name, doc in documents.items() if name != "BIOME"):
        raise ValueError("Content biome IDs disagree")
    style_path = Path(style_path or HERE / "style.toml")
    style = tomllib.loads(style_path.read_text())
    scene = biome["generation"]["scene"]
    candidate_recipe = Path(recipe_path or HERE / "recipes" / f"{biome_id}.toml")
    recipe_data = tomllib.loads(candidate_recipe.read_text()) if candidate_recipe.exists() else {}
    interior_plan = None
    if recipe_data.get("interior_theme"):
        if recipe_data["schema_version"] != 2 or recipe_data["biome_id"] != biome_id:
            raise ValueError("Interior recipe does not match biome/schema")
        from interiors import make_interior_plan
        interior_plan = make_interior_plan(recipe_data["interior_theme"], biome_id,
                                          candidate_recipe.parent / recipe_data["interior_recipe"], style_path)
        if kind == "background":
            if selected and set(selected) != {a["id"] for a in interior_plan["assets"]}:
                raise ValueError("Plan the complete interior layer set; all layers share one scene contract")
            interior_plan["source_sha256"] = {str(path.relative_to(content_root)): sha(path) for path in paths.values()}
            return interior_plan
    palette = ", ".join(f"{p['name']} {p['color']}" for p in biome["visual"]["palette"])
    entries = []
    for source in biome["background_layers"]:
        entries.append({**deepcopy(source), "kind": "background", "canvas": scene["canvas"],
                        "transparent": source["generation"]["transparent"]})
    default_recipe = HERE / "recipes" / f"{biome_id}.toml"
    recipe_path = Path(recipe_path) if recipe_path else default_recipe if default_recipe.exists() else None
    if recipe_path and not interior_plan:
        recipe = tomllib.loads(recipe_path.read_text())
        if recipe["schema_version"] != 1 or recipe["biome_id"] != biome_id:
            raise ValueError("Variant recipe does not match biome/schema")
        backgrounds = {entry["id"]: entry for entry in entries}
        variants = []
        replaced = set()
        for variant in recipe["variants"]:
            source_id = variant["source_id"]
            base = backgrounds[source_id]
            variants.append({**deepcopy(base), "id": variant["id"], "name": variant["name"],
                             "visual_description": variant["subject"], "source_id": source_id})
            replaced.add(source_id)
        entries = [entry for entry in entries if entry["id"] not in replaced] + variants
    for source in biome["ground_sections"]:
        entries.append({**deepcopy(source), "kind": "ground", "canvas": biome["generation"]["ground"]["canvas"], "transparent": True})
    for source in documents["SCENERY"]["scenery"]:
        entries.append({**deepcopy(source), "kind": "prop", "canvas": source["generation"]["canvas"], "transparent": True})
    for source in documents["ENEMIES"]["enemies"]:
        entries.append({**deepcopy(source), "kind": "enemy", "canvas": [128, 128], "transparent": True})
    ids = [safe_id(entry["id"]) for entry in entries]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate asset IDs")
    if selected and set(selected) - set(ids):
        raise ValueError(f"Unknown assets: {sorted(set(selected) - set(ids))}")
    assets = []
    for entry in entries:
        if kind != "all" and entry["kind"] != kind or selected and entry["id"] not in selected:
            continue
        role, canvas = entry["kind"], entry["canvas"]
        lines = ["Use case: stylized-concept", f"Asset type: {role} for a side-scrolling combat game",
                 f"Primary request: {entry['name']}", f"Subject: {entry['visual_description'].strip()}",
                 f"Style/medium: {style['style']} {style[role]}",
                 "Composition/framing: orthographic side view, parallel to the screen.",
                 f"Lighting/mood: {biome['visual']['lighting']}", f"Color palette: {palette}"]
        constraints = [f"Designed for {canvas[0]} by {canvas[1]} logical pixels; judge detail at this size."]
        if role == "background":
            lines.append(f"Scene/backdrop: {entry['generation']['composition']}")
            constraints += [f"Keep rows {scene['ground_y'] - 2 * scene['reference_height']} through {scene['ground_y']} quiet across the full width for moving combatants.",
                            "Generate a full source texture at least 1536 pixels wide at the specified aspect ratio; logical dimensions define layout, not output resolution.",
                            "Rear atmosphere only. Foreground props and the playable floor are separate assets. No characters, enemies or freestanding objects.",
                            "Use controlled material texture and grouped shading. Preserve fine pixel edges without dense high-contrast highlights behind actors."]
        elif role == "ground":
            ground = biome["generation"]["ground"]
            lines.append(f"Composition: {entry['generation']['composition']} {ground['edge_description']}")
            constraints.append(f"Walking contact at logical row {ground['surface_y']}; common {ground['edge_margin']}-column edge margins.")
        elif role == "prop":
            lines.append(f"Composition: {entry['generation']['composition']}")
            constraints.append(f"Anchor: {entry['generation']['anchor']}. Leave transparent padding on all sides; no surrounding landscape or detached cast shadow.")
        else:
            constraints += ["One complete left-facing character in a neutral ready pose; all limbs and equipment inside the canvas.",
                            "Use the approved player reference only for pixel style and lighting; retain this enemy's anatomy and identity."]
        constraints.append("Genuine transparent alpha outside the subject; no colored matte or painted transparency pattern." if entry["transparent"] else "Opaque edge-to-edge image; no transparency or border.")
        if entry.get("generation", {}).get("repeat_x"):
            constraints.append("Compatible horizontal edges and level transitions; seamlessness must be reviewed after export.")
        lines.append("Constraints: " + " ".join(constraints))
        lines.append("Avoid: " + ", ".join(dict.fromkeys(style["avoid"] + scene.get("avoid", []))))
        prompt = "\n".join(lines)
        record = {"id": entry["id"], "name": entry["name"], "kind": role, "canvas": canvas,
                  "transparent": entry["transparent"], "prompt": prompt, "prompt_sha256": digest(prompt),
                  "source_definition": entry, "export": {"sampling": "nearest", "alpha": "binary" if entry["transparent"] else "opaque", "colors": "source",
                  "resolution": "source" if role == "background" else "logical", **({"min_width": 1536} if role == "background" else {})}}
        if role == "enemy":
            record["sheet_prompt"] = "\n".join([
                "Use case: stylized-concept", "Asset type: authored enemy animation sheet",
                f"Subject: {entry['visual_description'].strip()}",
                f"Style/medium: {style['style']} {style['enemy']}",
                "Input images: use this enemy's approved reference as the identity and style reference.",
                "Composition: six columns and four rows, exactly 24 separated complete poses. Consistent cell size, body scale, left-facing profile and ground baseline. Transparent background. No labels or grid lines.",
                f"Row 1 idle: six subtle planted poses returning to the start. {entry['visual']['idle']}",
                f"Row 2 walk: {style['walk']}",
                f"Row 3 attack: ready, windup, anticipation, strike, follow-through, recovered ready pose. {entry['visual']['attack']}",
                f"Row 4 death: {style['death']}",
                "Constraints: no camera movement, rescaling, additional weapons, extra limbs or invented attacks; separate every pose including extended weapons. Review anatomy, strike/recovery and resting death contact before extraction."])
        assets.append(record)
    if not assets:
        raise ValueError("No assets match the selection")
    result = {"schema_version": 1, "biome_id": biome_id, "style": style,
              "source_sha256": {str(path.relative_to(content_root)): sha(path) for path in paths.values()},
              "style_sha256": sha(style_path), "scene": scene, "assets": assets}
    if recipe_path:
        result["variant_recipe"] = {"text": recipe_path.read_text(), "sha256": sha(recipe_path)}
    if interior_plan and kind == "all" and not selected:
        result["assets"] = interior_plan["assets"] + [a for a in assets if a["kind"] != "background"]
        result["interior"] = interior_plan["interior"]
        result["interior_recipe"] = interior_plan["recipe"]
    return result


def prepare(plan_path, sources_path, out):
    from PIL import Image
    import numpy as np

    plan_path, sources_path, out = Path(plan_path).resolve(), Path(sources_path).resolve(), Path(out).resolve()
    plan, sources = json.loads(plan_path.read_text()), json.loads(sources_path.read_text())
    if plan["schema_version"] != 1 or sources["schema_version"] != 1 or sources["plan_sha256"] != sha(plan_path):
        raise ValueError("Source manifest does not match the saved plan")
    expected = {entry["id"] for entry in plan["assets"]}
    if set(sources["assets"]) != expected:
        raise ValueError("Sources must cover exactly the selected planned assets")
    fingerprint = {"plan_sha256": sha(plan_path), "sources_sha256": sha(sources_path)}
    if (out / "manifest.json").exists():
        old = json.loads((out / "manifest.json").read_text())
        if old["inputs"] != fingerprint:
            raise ValueError("Prepared inputs changed; choose a new output directory")
    prepared = []
    for asset in plan["assets"]:
        safe_id(asset["id"])
        if asset["kind"] == "enemy":
            raise ValueError("Enemy sheets use sprites import-sheets with reviewed extraction recipes")
        spec = sources["assets"][asset["id"]]
        source = (sources_path.parent / spec["image"]).resolve()
        if sha(source) != spec["sha256"] or spec["prompt_sha256"] != digest(asset["prompt"]) or not spec["backend"]:
            raise ValueError(f"Source or prompt checksum changed: {asset['id']}")
        for reference in spec.get("references", []):
            if sha(sources_path.parent / reference["image"]) != reference["sha256"]:
                raise ValueError("Reference image checksum changed")
        if "reference" in asset:
            reference = asset["reference"]
            if sha(ROOT / reference["image"]) != reference["sha256"] or not any(
                (sources_path.parent / r["image"]).resolve() == (ROOT / reference["image"]).resolve()
                and r["sha256"] == reference["sha256"] for r in spec.get("references", [])
            ):
                raise ValueError("Source provenance must include the planned edit reference")
        image = Image.open(source).convert("RGBA")
        width, height = asset["canvas"]
        if abs(image.width / image.height / (width / height) - 1) > .01:
            raise ValueError(f"Source aspect ratio differs from planned canvas: {asset['id']}")
        low, high = image.getchannel("A").getextrema()
        if asset["transparent"] and (low == 255 or high == 0):
            raise ValueError(f"Expected a nonempty transparent cutout: {asset['id']}")
        if not asset["transparent"] and low != 255:
            raise ValueError(f"Expected opaque background: {asset['id']}")
        resolution = asset["export"].get("resolution", "logical")
        if resolution not in ("source", "logical"):
            raise ValueError("Export resolution must be source or logical")
        if resolution == "source" and image.width < asset["export"].get("min_width", 1):
            raise ValueError(f"Source texture is below the required resolution: {asset['id']}")
        pixels = np.array(image if resolution == "source" else image.resize((width, height), Image.Resampling.NEAREST))
        pixels[..., 3] = (pixels[..., 3] > 128).astype(np.uint8) * 255
        pixels[pixels[..., 3] == 0] = 0
        if not pixels[..., 3].any():
            raise ValueError(f"Asset disappears at logical resolution: {asset['id']}")
        prepared.append((asset, spec, source, Image.fromarray(pixels)))
    ground_metadata = {}
    for asset, _, _, image in prepared:
        if asset["kind"] == "ground":
            # Measure after export, before any output is written.
            alpha = np.array(image.getchannel("A"))
            if not alpha.any(axis=0).all():
                raise ValueError("Ground must provide a surface across its complete width")
            rows = (alpha > 0).argmax(axis=0)
            ground_metadata[asset["id"]] = {"canvas": asset["canvas"],
                "surface_y": float(np.median(rows)) * asset["canvas"][1] / image.height}
    interior = None
    if "interior" in plan:
        from interiors import prepared_scene
        interior = prepared_scene(plan, {asset["id"]: image for asset, _, _, image in prepared})
    out.mkdir(parents=True, exist_ok=True)
    manifest = {"schema_version": 1, "biome_id": plan["biome_id"], "inputs": fingerprint, "assets": {}}
    for asset, spec, source, image in prepared:
        image_path = out / f"{asset['id']}.png"
        image.save(image_path, optimize=True)
        manifest["assets"][asset["id"]] = {"image": image_path.name, "sha256": sha(image_path),
            "size": list(image.size), "source": os.path.relpath(source, out), "source_sha256": spec["sha256"],
            "backend": spec["backend"], "prompt_sha256": spec["prompt_sha256"], "export": asset["export"],
            **ground_metadata.get(asset["id"], {})}
    if interior:
        manifest["interior"] = interior
    save(out / "manifest.json", manifest)
    cards = "\n".join(f'<figure><img width="{asset["canvas"][0]}" src="{html.escape(asset["id"])}.png"><figcaption>{html.escape(asset["id"])} — texture {manifest["assets"][asset["id"]]["size"]}, logical canvas {asset["canvas"]}</figcaption></figure>' for asset in plan["assets"])
    preview = ""
    if interior:
        from interiors import review_html
        preview = review_html(manifest)
    (out / "review.html").write_text('<!doctype html><meta charset="utf-8"><title>Biome asset review</title><style>body{background:#20272d;color:#ddd;font:16px sans-serif}img,canvas{image-rendering:pixelated;max-width:100%;background:#343b42}figure{margin:24px 0}label{margin-right:16px}</style><h1>Review at logical size</h1><p>Inspect quiet combat space, alpha, contact and repeat seams in the game composition before bundling.</p>' + preview + cards)
    return manifest


def bundle(manifest_path, mapping_path, out=None):
    manifest_path, mapping_path = Path(manifest_path).resolve(), Path(mapping_path).resolve()
    manifest, mapping = json.loads(manifest_path.read_text()), json.loads(mapping_path.read_text())
    biome = safe_id(manifest["biome_id"])
    out = Path(out or ROOT / "assets" / "biomes" / biome).resolve()
    if not mapping or len(set(mapping.values())) != len(mapping):
        raise ValueError("Runtime mapping needs unique destination slots")
    selected = []
    for key, slot in mapping.items():
        safe_id(slot)
        spec = manifest["assets"][key]
        image = manifest_path.parent / spec["image"]
        source = (manifest_path.parent / spec["source"]).resolve()
        if sha(image) != spec["sha256"] or sha(source) != spec["source_sha256"]:
            raise ValueError(f"Prepared image or original source changed: {key}")
        source_relative = str(source.relative_to(ROOT))
        selected.append((key, slot, spec, image, source_relative))
    interior = deepcopy(manifest.get("interior"))
    if interior:
        from interiors import validate_scene
        validate_scene(interior)
        for layer in interior["layers"]:
            if layer["asset_id"] not in mapping:
                raise ValueError("Interior bundle must include every scene layer")
            layer["image"] = mapping[layer["asset_id"]]
    runtime = json.loads((out / "sources.json").read_text()) if (out / "sources.json").exists() else {}
    out.mkdir(parents=True, exist_ok=True)
    for key, slot, spec, image, source_relative in selected:
        shutil.copyfile(image, out / f"{slot}.png")
        runtime[slot] = {"id": key, "source": source_relative,
            **{k: spec[k] for k in ("source_sha256", "sha256", "size", "backend", "prompt_sha256", "export", "canvas", "surface_y") if k in spec}}
    save(out / "sources.json", runtime)
    if interior:
        save(out / "interior.json", interior)


def local_definition(plan_path, out):
    """Translate the same reviewed prompts for the existing local SDXL adapter."""
    plan = json.loads(Path(plan_path).read_text())
    if any(asset["kind"] != "background" or asset["transparent"] for asset in plan["assets"]):
        raise ValueError("Local full-scene generation requires a plan of opaque backgrounds only")
    lines = ["schema_version = 1"]
    for asset in plan["assets"]:
        lines.append("\n[[assets]]")
        for key in ("id", "name", "kind", "canvas"):
            lines.append(f"{key} = {json.dumps(asset[key])}")
        lines += [f"visual_description = {json.dumps(asset['source_definition']['visual_description'])}",
                  "[assets.reference]", f"prompt = {json.dumps(asset['prompt'])}",
                  f"negative = {json.dumps(', '.join(plan['style']['avoid']))}"]
    text = "\n".join(lines) + "\n"
    out = Path(out)
    if out.exists() and out.read_text() != text:
        raise ValueError("Definition changed; choose a new output path")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)


def edit_plan(plan, references_path):
    """Attach reviewed input images and exact restyling prompts to any asset plan."""
    references_path = Path(references_path).resolve()
    references = json.loads(references_path.read_text())
    if set(references) != {asset["id"] for asset in plan["assets"]}:
        raise ValueError("Edit references must cover exactly the selected assets")
    for asset in plan["assets"]:
        reference = (references_path.parent / references[asset["id"]]).resolve()
        asset["reference"] = {"image": str(reference.relative_to(ROOT)), "sha256": sha(reference)}
        alpha = "Keep genuine transparent alpha in empty areas, never a painted checkerboard or matte." if asset["transparent"] else "Keep the image completely opaque."
        asset["prompt"] = "\n".join([
            "Use case: style-transfer", "Input image 1 is the edit target.",
            "Restyle the supplied game layer to the materials, palette and formations below. Preserve its canvas aspect ratio, orthographic camera, independent layer role, horizontal continuation and overall occupied/empty layout. Replace conflicting surface details and shapes; this is not merely a color tint.",
            alpha, asset["prompt"]])
        asset["prompt_sha256"] = digest(asset["prompt"])
    return plan


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan", help="Write backend-independent prompts; no generation")
    plan.add_argument("--biome", required=True)
    plan.add_argument("--kind", choices=("all", "background", "ground", "prop", "enemy"), default="all")
    plan.add_argument("--asset", nargs="+")
    plan.add_argument("--recipe", type=Path)
    plan.add_argument("--edit-from", type=Path, help="JSON mapping of every planned asset ID to a reference PNG, relative to the JSON file")
    plan.add_argument("--out", type=Path, required=True)
    interior = commands.add_parser("plan-interior", help="Plan reusable recess, wall and ceiling layers")
    interior.add_argument("--theme", required=True, help="Theme from interiors.toml, or your custom recipe")
    interior.add_argument("--biome", help="Optional runtime biome ID; defaults to the theme name")
    interior.add_argument("--recipe", type=Path)
    interior.add_argument("--edit-from", type=Path, help="JSON mapping of every planned asset ID to a reference PNG, relative to the JSON file")
    interior.add_argument("--with-scenery", action="store_true", help="Include a walking floor and eight authored decorations")
    interior.add_argument("--decorations", type=Path, help="Optional decoration recipes for complete interior sets")
    interior.add_argument("--out", type=Path, required=True)
    prep = commands.add_parser("prepare", help="Validate and export supplied static art at the planned texture resolution")
    prep.add_argument("--plan", type=Path, required=True)
    prep.add_argument("--sources", type=Path, required=True)
    prep.add_argument("--out", type=Path, required=True)
    pack = commands.add_parser("bundle", help="Copy explicitly selected exports into runtime slots")
    pack.add_argument("--manifest", type=Path, required=True)
    pack.add_argument("--mapping", type=Path, required=True)
    pack.add_argument("--out", type=Path)
    local = commands.add_parser("definition", help="Translate opaque background prompts into a local SDXL definition")
    local.add_argument("--plan", type=Path, required=True)
    local.add_argument("--out", type=Path, required=True)
    props = commands.add_parser("bundle-props", help="Use the shared scenery atlas packer")
    props.add_argument("--biome", required=True)
    props.add_argument("--recipe-dir", type=Path)
    props.add_argument("--out", type=Path)
    assemble = commands.add_parser("assemble-interior", help="Bundle a complete interior set and build a standalone HTML review")
    assemble.add_argument("--plan", type=Path, required=True)
    assemble.add_argument("--manifest", type=Path, required=True)
    assemble.add_argument("--out", type=Path, required=True)
    assemble.add_argument("--regions", type=Path, help="Optional reviewed decoration crop rectangles keyed by prop ID")
    args = parser.parse_args(argv)
    if args.command in ("plan", "plan-interior"):
        if args.command == "plan-interior":
            if args.with_scenery:
                from interior_sets import make_set_plan
                data = make_set_plan(args.theme, args.biome, args.recipe, args.decorations)
            else:
                from interiors import make_interior_plan
                data = make_interior_plan(args.theme, args.biome, args.recipe)
        else:
            data = make_plan(args.biome, args.kind, args.asset, recipe_path=args.recipe)
        if args.edit_from:
            data = edit_plan(data, args.edit_from)
        if args.out.exists() and json.loads(args.out.read_text()) != data:
            parser.error("Plan inputs changed; choose a new output path")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        save(args.out, data)
        print(f"Planned {len(data['assets'])} assets: {args.out}")
    elif args.command == "prepare":
        manifest = prepare(args.plan, args.sources, args.out)
        print(f"Prepared {len(manifest['assets'])} assets: {args.out}")
    elif args.command == "definition":
        local_definition(args.plan, args.out)
        print(f"Wrote local definition: {args.out}")
    elif args.command == "bundle-props":
        sys.path.insert(0, str(ROOT / "scripts"))
        from bundle_scenery import bundle as bundle_props
        bundle_props(safe_id(args.biome), args.recipe_dir, args.out)
    elif args.command == "assemble-interior":
        from interior_sets import assemble_set
        assemble_set(args.plan, args.manifest, args.out, args.regions)
    else:
        bundle(args.manifest, args.mapping, args.out)
        print("Bundled selected biome assets")


if __name__ == "__main__":
    main()
