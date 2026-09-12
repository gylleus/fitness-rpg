"""Portable pixel references: import, prepare, publish, and review without Wan.

A raw PNG is already pixel art: never segment or recolor it during preparation.
A published reference also carries the exact 512px animation conditioning image.
"""
from __future__ import annotations

import html
import json
import math
import os
from pathlib import Path
import shutil

from sprites import ROOT, entries, load, save_json, sha256, subject


def inspect_png(path, background=False):
    from PIL import Image
    with Image.open(path) as image:
        if image.format != "PNG":
            raise ValueError("A pixel reference must be a PNG")
        rgba = image.convert("RGBA")
    if not background and max(rgba.size) > 512:
        raise ValueError("Pixel sprite references must be at most 512px per side; resize your design explicitly")
    if rgba.getchannel("A").getextrema()[1] < 128:
        raise ValueError("Pixel reference has no visible foreground")
    if background and rgba.getchannel("A").getextrema() != (255, 255):
        raise ValueError("Static background references must be fully opaque")
    return rgba


def plan_inputs(args, planned, facing):
    """Validate first, return a copy list; the planner snapshots only after comparing configs."""
    single = getattr(args, "reference", None)
    mapping = getattr(args, "reference_inputs", None)
    if single and mapping:
        raise ValueError("Use --reference or --reference-inputs, not both")
    if single and len(planned) != 1:
        raise ValueError("--reference requires one selected asset; use --asset ID or --reference-inputs")
    inputs = {subject(planned[0])["id"]: str(single.resolve())} if single else {}
    if mapping:
        inputs = json.loads(mapping.read_text())
        if not isinstance(inputs, dict) or any(not isinstance(p, str) for p in inputs.values()):
            raise ValueError("Reference inputs must map asset IDs to paths")
    if set(inputs) - {subject(e)["id"] for e in planned}:
        raise ValueError("Reference input IDs must belong to the selected assets")
    copies = []
    for entry in planned:
        asset = subject(entry)
        key = asset["id"]
        if key not in inputs:
            continue
        if entry.get("reference_guide") or getattr(args, "guide_image", None):
            raise ValueError("A finished pixel reference cannot also use an img2img guide")
        source = ((mapping.resolve().parent if mapping else Path.cwd()) / inputs[key]).resolve()
        background = asset.get("kind") == "background"
        spec = {"origin": str(source), "source_sha256": sha256(source)}
        if source.suffix.lower() == ".json":
            record = json.loads(source.read_text())
            if record.get("schema_version") != 1 or record.get("type") != "pixel-reference":
                raise ValueError("Expected a published pixel-reference.json or an authored PNG")
            if (record.get("kind") == "background") != background:
                raise ValueError("Cannot mix a background reference with an isolated sprite")
            if not background:
                pivot = record.get("pivot")
                if (not isinstance(pivot, list) or len(pivot) != 2 or
                        any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in pivot) or
                        record.get("anchor") not in ("ground", "floating")):
                    raise ValueError("Pixel reference requires a normalized pivot and ground/floating anchor")
                if record.get("facing", facing) != facing:
                    raise ValueError(f"Pixel reference faces {record['facing']}; set --facing to match the selected design")
            spec.update(format="bundle", metadata=record)
            # Rename files in the snapshot; original paths remain in metadata only.
            for field in ("image",) if background else ("image", "conditioning", "cutout"):
                item = record[field]
                path = (source.parent / item["path"]).resolve()
                if sha256(path) != item["sha256"]:
                    raise ValueError(f"Pixel reference hash mismatch: {path}")
                image = inspect_png(path, background)
                if field != "image" and image.size != (512, 512):
                    raise ValueError("Sprite conditioning and cutout must be 512x512")
                spec[field] = {"path": f"inputs/{key}/{field}.png", "sha256": item["sha256"]}
                copies.append((path, spec[field]["path"], item["sha256"]))
        else:
            inspect_png(source, background)
            spec.update(format="png", image={"path": f"inputs/{key}/image.png", "sha256": spec["source_sha256"]})
            copies.append((source, spec["image"]["path"], spec["source_sha256"]))
        entry["reference_input"] = spec
    return copies


def snapshot_inputs(run, copies):
    for source, relative, expected in copies:
        target = run / relative
        if sha256(source) != expected:
            raise ValueError("Pixel reference changed while planning")
        if target.exists():
            if sha256(target) != expected:
                raise ValueError("Saved pixel reference differs; choose a new run")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)


def verify_input(run, entry):
    spec = entry["reference_input"]
    for field in ("image", "conditioning", "cutout"):
        if field in spec and sha256(run / spec[field]["path"]) != spec[field]["sha256"]:
            raise ValueError("Saved pixel reference hash mismatch")


def verify_prepared(out):
    record = json.loads((out / "source.json").read_text())
    for name, expected in record.get("prepared_sha256", {}).items():
        if sha256(out / name) != expected:
            raise ValueError(f"Prepared pixel reference hash mismatch: {out / name}")
    return record


def prepare_input(run, entry):
    """Keep supplied pixels intact; only integer-enlarge/pad the conditioning copy."""
    from PIL import Image
    from sprite_references import reference_anchor
    verify_input(run, entry)
    asset, spec = subject(entry), entry["reference_input"]
    out = run / "references" / asset["id"]
    source = run / spec["image"]["path"]
    if (out / "source.json").exists():
        record = verify_prepared(out)
        if record.get("reference_input") != spec:
            raise ValueError("Prepared input differs; choose a new run")
        publish(run, entry)
        return
    native = inspect_png(source, asset.get("kind") == "background")
    out.mkdir(parents=True, exist_ok=True)
    # Preserve the input file bytes, including palette/metadata, in the portable artifact.
    shutil.copyfile(source, out / "pixel-reference.png")
    native.save(out / "source-cutout.png")
    record = {"original": os.path.relpath(source, ROOT.parent), "original_sha256": sha256(source),
              "mask_method": "provided-pixel-alpha", "reference_input": spec,
              "native_size": list(native.size), "height_scale": asset["visual"]["height_scale"],
              "note": "Authored reference pixels preserved; final animation exports still use ENDESGA32."}
    if asset.get("kind") == "background":
        native.save(out / "reference.png")
    elif spec["format"] == "bundle":
        shutil.copyfile(run / spec["conditioning"]["path"], out / "reference.png")
        shutil.copyfile(run / spec["cutout"]["path"], out / "reference-cutout.png")
        record.update({k: spec["metadata"][k] for k in ("pivot", "anchor")})
    else:
        scale = max(1, min(384 // native.width, 384 // native.height))
        enlarged = native.resize((native.width * scale, native.height * scale), Image.Resampling.NEAREST)
        offset = [(512-enlarged.width)//2, (512-enlarged.height)//2]
        cutout = Image.new("RGBA", (512, 512))
        cutout.paste(enlarged, tuple(offset))
        cutout.save(out / "reference-cutout.png")
        background = Image.new("RGBA", cutout.size, "#8b9bb4")
        background.alpha_composite(cutout)
        background.convert("RGB").save(out / "reference.png")
        anchor = reference_anchor(native, asset["visual"])
        record.update(anchor, pivot=[(anchor["pivot"][i]*native.size[i]*scale+offset[i])/512 for i in (0,1)],
                      integer_scale=scale, offset=offset)
        if any(not 0 <= v <= 1 for v in record["pivot"]):
            raise ValueError("Pixel reference needs more canvas space for its floating ground pivot; supply a smaller design")
    record["reference_sha256"] = sha256(out / "reference.png")
    record["prepared_sha256"] = {p.name: sha256(p) for p in out.glob("*.png")}
    save_json(out / "source.json", record)
    publish(run, entry)


def publish(run, entry):
    """A stable, movable boundary between reference design and motion generation."""
    asset = subject(entry)
    out = run / "references" / asset["id"]
    source = verify_prepared(out)
    native = out / "pixel-reference.png"
    if not native.exists():
        shutil.copyfile(out / "native-128.png", native)
    record = {"schema_version": 1, "type": "pixel-reference", "asset_id": asset["id"],
              "kind": asset.get("kind", "enemy"), "name": asset["name"],
              "facing": None if asset.get("kind") == "background" else load(run)["facing"],
              "image": {"path": native.name, "sha256": sha256(native)},
              "source": source, "art_status": "Candidate; publishing is not art approval"}
    if asset.get("kind") != "background":
        record.update({k: source[k] for k in ("pivot", "anchor")})
        for field, name in (("conditioning", "reference.png"), ("cutout", "reference-cutout.png")):
            record[field] = {"path": name, "sha256": sha256(out / name)}
    target = out / "pixel-reference.json"
    if target.exists() and json.loads(target.read_text()) != record:
        raise ValueError("Published pixel reference changed; choose a new run for design edits")
    save_json(target, record)


def review(run):
    from PIL import Image
    cards = []
    records = []
    for entry in entries(load(run)):
        asset = subject(entry)
        folder = run / "references" / asset["id"]
        path = folder / "pixel-reference.json"
        if not path.exists():
            continue
        record = json.loads(path.read_text())
        image = folder / record["image"]["path"]
        with Image.open(image) as im:
            width, height = im.size
        scale = max(1, min(4, 512 // max(width, height)))
        base = "references/" + asset["id"] + "/"
        cards.append(f'<article><h2>{html.escape(asset["name"])}</h2>'
                     f'<img src="{base}pixel-reference.png" width="{width*scale}" height="{height*scale}" alt="{html.escape(asset["name"], quote=True)}">'
                     f'<p>{width} × {height} pixels · <a href="{base}pixel-reference.png">PNG</a> · '
                     f'<a href="{base}pixel-reference.json">Reusable reference</a></p></article>')
        records.append({"asset_id": asset["id"], "reference": base + "pixel-reference.json", "size": [width, height]})
    (run / "reference-review.html").write_text(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<title>Pixel reference designs</title><style>body{background:#181425;color:#ead4aa;font:16px system-ui;padding:24px}'
        'main{display:flex;gap:24px;flex-wrap:wrap}article{padding:16px;background:#262b44}a{color:#2ce8f5}'
        'img{image-rendering:pixelated;background:repeating-conic-gradient(#3a4466 0 25%,#262b44 0 50%) 0/16px 16px}</style>'
        '<h1>Pixel reference designs</h1><p>Reference stage only. Inspect or edit a PNG, then select it for an animation run.</p>'
        '<main>' + ''.join(cards) + '</main>')
    save_json(run / "reference-index.json", {"references": records})
    print(f"Pixel reference review: {run / 'reference-review.html'}", flush=True)
