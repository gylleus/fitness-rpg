"""Static full-scene adapter: rectangular, opaque, no segmentation or ground pivot."""
import json
import os

from sprites import ROOT, save_json, sha256, subject
from asset_palette import load_palette, palette_contract


def validate(asset):
    if asset["kind"] != "background":
        if "canvas" in asset:
            raise ValueError("canvas is only supported for static backgrounds")
        return
    canvas = asset.setdefault("canvas", [320, 180])
    if not isinstance(canvas, list) or len(canvas) != 2 or any(type(n) is not int or not 16 <= n <= 1024 for n in canvas):
        raise ValueError("Background canvas requires [width, height], each 16..1024")
    if max(canvas) / min(canvas) > 4:
        raise ValueError("Background aspect ratio must be at most 4:1")
    if asset["animations"]:
        raise ValueError("Backgrounds are static; animations require an isolated asset")


def prompts(asset, art, caption=None):
    description = caption["caption"] if caption else " ".join(asset["visual_description"].split())
    prompt = (f"Pixel art background for a 2D side-scroller. {description} "
              f"{art['style']} {art['lighting']} Full scene fills the entire canvas edge to edge. "
              "Layered environmental composition, readable terrain, crisp pixel clusters, flat colors.")
    negative = ", ".join(["text", "watermark", "frame border", "sprite sheet", "isolated object",
                          "plain studio background", *art["avoid"], *asset["visual"]["avoid"],
                          *(caption.get("avoid", []) if caption else [])])
    return {"reference": prompt, "full_reference_context": asset["visual_description"],
            "caption_source": "curated condensation" if caption else "full visual_description",
            "negative": negative, "motions": {}}


def generation_size(asset):
    width, height = asset["canvas"]
    scale = 1024 / max(width, height)
    return {"width": max(256, round(width * scale / 64) * 64),
            "height": max(256, round(height * scale / 64) * 64)}


def fit_scene(image, canvas):
    from PIL import Image, ImageOps
    # Preserve every part of the scene and its aspect ratio. Slight model-size
    # rounding may require matte padding; never stretch or crop the landscape.
    return ImageOps.pad(image.convert("RGB"), tuple(canvas), method=Image.Resampling.NEAREST,
                        color="#8b9bb4").convert("RGBA")


def prepare(run, entry, selection):
    from PIL import Image, ImageOps
    from pixels import convert
    from reference_assets import publish, verify_prepared
    asset = subject(entry)
    source = (run / selection.get("source", f"originals/{asset['id']}.png")).resolve()
    out = run / "references" / asset["id"]
    if (out / "source.json").exists():
        record = verify_prepared(out)
        if record["original_sha256"] != sha256(source) or record.get("selection", {}) != selection:
            raise ValueError("Prepared background differs; choose a new run")
    else:
        image = Image.open(source).convert("RGB")
        if selection.get("crop"):
            image = image.crop(selection["crop"])
        if selection.get("flip_horizontal"):
            image = ImageOps.mirror(image)
        native = convert(fit_scene(image, asset["canvas"]), asset["canvas"], "nearest", color_metric="ciede2000")
        out.mkdir(parents=True, exist_ok=True)
        image.save(out / "source-cutout.png")
        native.save(out / "pixel-reference.png")
        native.save(out / "reference.png")
        save_json(out / "source.json", {"original": os.path.relpath(source, ROOT.parent),
            "original_sha256": sha256(source), "selection": selection, "mask_method": "none-full-scene",
            "native_size": asset["canvas"], "reference_sha256": sha256(out / "reference.png"),
            "prepared_sha256": {p.name: sha256(p) for p in out.glob("*.png")}})
    publish(run, entry)


def export(run, entry, options, suffix):
    from PIL import Image
    from pixels import convert
    from reference_assets import verify_prepared
    asset = subject(entry)
    refs = run / "references" / asset["id"]
    verify_prepared(refs)
    image = Image.open(refs / "pixel-reference.png").convert("RGBA")
    width, height = asset["canvas"]
    folder = run / ("exports" + suffix) / asset["id"]
    timing = {"indices": [0], "durations_ms": [1000], "repeat": False, "action": "reference"}
    variants = {}
    for label, method in (("nearest", "nearest"), ("pyxelate", "conservative")):
        dest = folder / "reference" / label
        dest.mkdir(parents=True, exist_ok=True)
        frame = convert(fit_scene(image, asset["canvas"]), asset["canvas"], method, color_metric="ciede2000")
        frame.save(dest / "frame-000.png")
        frame.save(dest / "spritesheet.png")
        atlas = {"frames": [{"filename": "frame-000.png", "frame": {"x": 0, "y": 0, "w": width, "h": height},
                              "duration": 1000, "source_frame": 0, "sha256": sha256(dest / "frame-000.png")}],
                 "meta": {"image": "spritesheet.png", "asset_id": asset["id"], "kind": "background",
                          "size": {"w": width, "h": height}, "repeat": False, "pivot": None,
                          "grid": {"columns": 1, "rows": 1, "order": "row-major"}, "palette": load_palette()["name"], "palette_contract": palette_contract()}}
        save_json(dest / "spritesheet.json", atlas)
        variants[label] = {"frame_sha256": sha256(dest / "frame-000.png"), "opaque": frame.getchannel("A").getextrema() == (255,255)}
    save_json(folder / "manifest.json", {"asset_id": asset["id"], "name": asset["name"], "kind": "background",
        "frame_size": [width, height], "pivot": None, "height_scale": None, "palette": options["palette"],
        "framing": "Full opaque scene, aspect-preserving fit; no foreground crop or ground anchor",
        "source_reference_sha256": sha256(refs / "pixel-reference.png"),
        "actions": {"reference": {"timing": timing, "variants": variants}}, "art_status": "Candidate"})
    print(f"Exported background {asset['id']}: {width}x{height}", flush=True)
