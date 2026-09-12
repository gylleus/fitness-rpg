#!/usr/bin/env python3
"""Local asset definitions → SDXL references → Wan motion → transparent pixel PNGs."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
BASE = ROOT.parent / "sprite-animation"
WAN = ROOT.parent / "pixel-animation-14b"
STUDY = ROOT.parent / "pyxelate-study"
for path in (WAN, BASE, REPO / "scripts"):
    sys.path.insert(0, str(path))
sys.path.insert(0, str(ROOT))
os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")
os.environ.setdefault("HF_HOME", str(STUDY / ".cache/huggingface"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
if sys.version_info < (3, 11):
    import tomli
    sys.modules.setdefault("tomllib", tomli)
import tomllib
from common import save_json, sha256

DEFAULT_ART = {
    "style": "Stylized weathered dark fantasy, exaggerated readable silhouettes, worn practical materials.",
    "lighting": "Restrained upper-left lighting, flat three-tone shading.",
    "facing": "left",
    "view": "three_quarter",
    "avoid": ["photorealism", "cute mascot", "text", "watermark"],
}


def entries(config):
    return config["assets"] if "assets" in config else config["enemies"]


def subject(entry):
    return entry["asset"] if "asset" in entry else entry["enemy"]


def id_field(config):
    return "asset_id" if "assets" in config else "enemy_id"


def actions_for(config, entry):
    asset = subject(entry)
    return [a for a in config["actions"] if "animations" not in asset or a in asset["animations"]]


def motion(asset, action):
    return (asset["animations"][action]["description"] if "animations" in asset else asset["visual"][action])


def looping(asset, action):
    return asset["animations"][action]["loop"] if "animations" in asset else action == "idle"


def validate_animations(animations):
    if not isinstance(animations, dict):
        raise ValueError("animations must be a table")
    for action, spec in animations.items():
        if not re.fullmatch(r"[a-z][a-z0-9_]*", action) or action == "reference":
            raise ValueError(f"Invalid or reserved action ID: {action}")
        if not isinstance(spec, dict) or set(spec) != {"description", "loop"}:
            raise ValueError(f"Animation {action} requires only description and loop")
        if not isinstance(spec["description"], str) or not spec["description"].strip() or type(spec["loop"]) is not bool:
            raise ValueError(f"Invalid animation {action} description or loop flag")
        if action == "death" and spec["loop"]:
            raise ValueError("Death must be a one-shot animation")


def seed_for(asset_id, action, base):
    return int.from_bytes(hashlib.sha256(f"{base}:{asset_id}:{action}".encode()).digest()[:4], "big")


def reference_override(asset, result):
    """Explicit reference prompts bypass all automatic caption/style/view expansion."""
    if "reference" in asset:
        return {**result, "reference": asset["reference"]["prompt"],
                "reference_negative": asset["reference"]["negative"],
                "caption_source": "explicit assets.reference.prompt"}
    return result


def prompts(asset, art, facing, caption=None):
    if asset.get("kind") == "background":
        from backgrounds import prompts as background_prompts
        return reference_override(asset, background_prompts(asset, art, caption))
    visual = asset["visual"]
    character = asset.get("kind", "character") in ("character", "player", "enemy")
    framing = "full body" if character else "entire object"
    invariants = "anatomy, face, equipment, silhouette and colors" if character else "shape, materials, parts, silhouette and colors"
    profile = art.get("view", "three_quarter") == "profile"
    angle = "strict side profile" if profile else "slight three-quarter turn"
    orientation = ""
    if profile:
        orientation = (f"Pixel art {framing} sprite in strict {facing}-facing side profile. "
                       "Orthographic 90-degree side view. "
                       + (f"Head and body point toward the {facing} edge together. " if character else
                          f"The object points toward the {facing} edge. ")
                       + "Only the near side is visible; the far side is occluded. "
                       "Flat lateral silhouette, fixed eye-level side-scroller camera. ")
    camera = ("Locked eye-level side-scroller camera, strict side profile throughout. "
              "No turning toward or away from the camera. " if profile else
              "Locked eye-level side-scroller camera, side-on with a slight three-quarter turn. ")
    view = (f"pixel art, one {asset['name']}, {framing}, facing {facing}, side-on view for a "
            f"2D side-scroller, {angle}, fixed eye-level camera. ")
    identity = " ".join(asset["visual_description"].split())
    equipment = ", ".join(visual["equipment"]) or "none"
    source = ((orientation if profile else view) + visual["silhouette"] + " " + identity +
              f" Visible equipment: {equipment}. " + art["style"] + " " + art["lighting"] +
              " Single isolated subject centered with generous empty padding; plain flat light gray background, "
              "crisp dark outline, chunky pixel clusters, three-tone shading. All equipment fits inside the image.")
    negative = ", ".join(["front view", "back view", "isometric view", "top down", "looking at viewer",
        "multiple views", "sprite sheet", "duplicates", "cropped", "gradient background", "cast shadow",
        "checkerboard", "floor", "blurry", *art["avoid"], *visual.get("avoid", [])])
    if profile:
        # Keep unwanted views in the first CLIP chunk, ahead of long appearance avoids.
        rejected_views = ["frontal view", "facing camera", "three-quarter view", "three-quarter angle",
                          "looking at viewer", "turned toward camera"]
        if character:
            rejected_views += ["frontal face", "chest facing camera", "both shoulders facing viewer"]
        negative = ", ".join(rejected_views) + ", " + negative
    motions = {}
    for action in asset.get("animations", {"idle": {}, "attack": {}}):
        timing = ("One complete motion cycle, then settle back into the exact starting pose. "
                  "Keep the ground contact or hovering center in place." if looping(asset, action) else
                  "One complete action: brief anticipation, decisive movement, follow-through, "
                  "then perform the described recovery or hold the described final pose. Do not repeat the action in this clip.")
        if action == "walk":
            timing = ("One continuous in-place gait cycle, returning to the same gait phase at the loop boundary without a pause. "
                      "Keep the torso centered in the frame while the legs lift, pass and plant naturally. "
                      "No net travel across the image; horizontal movement is supplied by the game. No turning or stopping.")
        elif action == "death":
            timing = ("One single death transition from the reference stance into the described collapsed pose. "
                      "The creature loses its strength and falls, then remains completely motionless through the end. "
                      "No recovery, standing up, revival, repeated fall, disappearing body or fade-out. "
                      "Keep the fallen body and attached limbs visible inside the frame.")
        motions[action] = (
            f"The exact same single {asset['name']} as the reference, facing {facing} throughout. "
            f"{orientation}{motion(asset, action)} {timing} "
            f"Preserve the reference {invariants}. "
            f"{camera}"
            "Keep the entire subject, equipment and effects inside the fixed frame with empty padding. "
            f"Plain uniform gray-blue background. {art['style']} {art['lighting']} Pixel art, crisp pixel clusters. "
            "Subject identity: " + identity)
    automatic_caption = re.split(r"(?<=[.!?])\s+", identity)[0]
    if visual["equipment"]:
        automatic_caption += " Visible equipment: " + equipment + "."
    caption_text = caption["caption"] if caption else automatic_caption
    reference_view = f"strict {facing}-facing side profile" if profile else f"{facing}-facing profile view"
    compact = (f"Pixel art game sprite, chunky pixels, flat colors, dark outline. "
               f"A {reference_view} of {caption_text.rstrip('.')}. "
               f"One isolated {framing} subject on plain gray. {art['style']} {art['lighting']}")
    if profile:
        # This is the actual SDXL prompt; full_reference_context is provenance only.
        compact = (orientation + caption_text.rstrip(".") + ". "
                   f"One isolated {framing} subject on plain gray. Chunky pixels, flat colors, dark outline. "
                   f"{art['style']} {art['lighting']} Pure {facing}-facing side view of the entire subject.")
    return reference_override(asset, {"reference": compact, "full_reference_context": source,
            "caption_source": "curated condensation of visual_description" if caption else "first sentence of visual_description",
            "negative": negative + (", " + ", ".join(caption.get("avoid", [])) if caption else ""), "motions": motions})


def definitions(path):
    """Validate art-only input. No enemy catalog or combat fields required."""
    data = tomllib.loads(path.read_text())
    if data.get("schema_version") != 1 or not isinstance(data.get("assets"), list) or not data["assets"]:
        raise ValueError("Definition requires schema_version = 1 and nonempty [[assets]]")
    if set(data) - {"schema_version", "art", "assets"}:
        raise ValueError("Unknown top-level definition fields")
    art = {**DEFAULT_ART, **data.get("art", {})}
    if set(art) - set(DEFAULT_ART) or art["facing"] not in ("left", "right"):
        raise ValueError("Invalid art fields or facing")
    if art["view"] not in ("profile", "three_quarter"):
        raise ValueError("art.view must be profile or three_quarter")
    for key in ("style", "lighting"):
        if not isinstance(art[key], str) or not art[key].strip():
            raise ValueError(f"art.{key} must be nonempty text")
    if not isinstance(art["avoid"], list) or any(not isinstance(v, str) for v in art["avoid"]):
        raise ValueError("art.avoid must be text array")
    seen = set()
    for asset in data["assets"]:
        if set(asset) - {"id", "name", "kind", "visual_description", "visual", "animations", "reference_caption", "reference", "canvas"}:
            raise ValueError("Unknown asset fields")
        for field in ("id", "name", "visual_description"):
            if not isinstance(asset.get(field), str) or not asset[field].strip():
                raise ValueError(f"Asset requires nonempty {field}")
        key = asset["id"]
        if not re.fullmatch(r"[a-z][a-z0-9_]*", key) or key in seen:
            raise ValueError(f"Invalid or duplicate asset ID: {key}")
        seen.add(key)
        asset.setdefault("kind", "character")
        if asset["kind"] not in ("character", "player", "enemy", "prop", "effect", "background"):
            raise ValueError("Asset kind must be character, player, enemy, prop, effect or background")
        if "reference_caption" in asset and (not isinstance(asset["reference_caption"], str) or not asset["reference_caption"].strip()):
            raise ValueError("reference_caption must be nonempty text")
        if "reference" in asset:
            spec = asset["reference"]
            if (not isinstance(spec, dict) or set(spec) != {"prompt", "negative"}
                    or any(not isinstance(v, str) or not v.strip() for v in spec.values())):
                raise ValueError("reference requires only nonempty prompt and negative text")
        visual = asset.setdefault("visual", {})
        if not isinstance(visual, dict) or set(visual) - {"silhouette", "equipment", "palette", "height_scale", "anchor", "avoid"}:
            raise ValueError("Invalid visual fields")
        for field, default in {"silhouette": "", "equipment": [], "palette": [], "height_scale": 1.0,
                               "anchor": "ground", "avoid": []}.items():
            visual.setdefault(field, default)
        if not isinstance(visual["silhouette"], str):
            raise ValueError("visual.silhouette must be text")
        if type(visual["height_scale"]) not in (int, float) or not 0 < visual["height_scale"] < 100:
            raise ValueError("visual.height_scale must be positive and below 100")
        if visual["anchor"] not in ("ground", "floating"):
            raise ValueError("visual.anchor must be ground or floating")
        for field in ("equipment", "palette", "avoid"):
            if not isinstance(visual[field], list) or any(not isinstance(v, str) for v in visual[field]):
                raise ValueError(f"visual.{field} must be text array")
        if any(not re.fullmatch(r"#[0-9a-fA-F]{6}", c) for c in visual["palette"]):
            raise ValueError("visual.palette must contain #RRGGBB colors")
        validate_animations(asset.setdefault("animations", {}))
        from backgrounds import validate
        validate(asset)
    return data["assets"], art


def make_plan(args, assets, art, source):
    size = 64 if args.size is None else args.size
    step = 2 if args.frame_step is None else args.frame_step
    facing = args.facing or art["facing"]
    requested = getattr(args, "asset", None) or getattr(args, "enemy", None)
    if requested:
        missing = set(requested) - {a["id"] for a in assets}
        if missing:
            raise ValueError(f"Assets are not in selected scope: {sorted(missing)}")
        assets = [a for a in assets if a["id"] in requested]
    if not assets:
        raise ValueError("Selected scope has no assets")
    available = list(dict.fromkeys(action for a in assets for action in a["animations"]))
    actions = args.actions if args.actions is not None else available
    if set(actions) - set(available) or len(set(actions)) != len(actions):
        raise ValueError("Actions must be unique and present in the selected definitions")
    if not 16 <= size <= 256 or not 1 <= step <= 16 or not 0 <= args.reference_lora <= 1.5:
        raise ValueError("Use frame size 16..256, frame step 1..16, LoRA strength 0..1.5")
    study = json.loads((STUDY / "config.json").read_text())
    generation = json.loads((WAN / "config.json").read_text())["generation"]
    captions = json.loads(args.captions.read_text()) if args.captions else {}
    guides_path = getattr(args, "reference_guides", None)
    guides = json.loads(guides_path.read_text()) if guides_path else {}
    if not isinstance(guides, dict) or set(guides) - {a["id"] for a in assets}:
        raise ValueError("Reference guide IDs must belong to the selected assets")
    if guides and getattr(args, "guide_image", None):
        raise ValueError("Use per-asset reference guides or one global guide, not both")
    planned = []
    for asset in assets:
        key = asset["id"]
        caption = captions.get(key)
        if caption and caption["source_sha256"] != hashlib.sha256(asset["visual_description"].encode()).hexdigest():
            raise ValueError(f"Caption is stale for {key}; update it from the changed visual_description")
        if not caption and asset.get("reference_caption"):
            caption = {"caption": asset["reference_caption"]}
        planned.append({"asset": asset, "prompts": prompts(asset, art, facing, caption),
            "seeds": {act: seed_for(key, act, args.seed) for act in ["reference", *actions] if act == "reference" or act in asset["animations"]}})
        if key in guides:
            spec = guides[key]
            if not isinstance(spec, dict) or set(spec) != {"image", "strength"} or type(spec["strength"]) not in (int, float) or not 0 < spec["strength"] <= 1:
                raise ValueError("Each reference guide requires image and strength in (0, 1]")
            path = (guides_path.resolve().parent / spec["image"]).resolve()
            planned[-1]["reference_guide"] = {"image": os.path.relpath(path, args.run),
                "strength": spec["strength"], "sha256": sha256(path)}
    from reference_assets import plan_inputs
    copies = plan_inputs(args, planned, facing)
    config = {"schema_version": 2, "facing": facing, "actions": actions,
        "export": {"size": size, "frame_step": step, "columns": 8, "margin": .08,
                   "palette": json.loads((BASE / "palette.json").read_text())},
        "art": art, "assets": planned, "source": source,
        "reference_generation": {k: study[k] for k in ("base_model", "lora", "vae", "generation")},
        "animation_generation": {**generation, "end_condition": False},
        "model_manifest_sha256": {str(p.relative_to(ROOT.parent)): sha256(p) for p in
            (WAN / "models.lock.json", BASE / "models.lock.json")}}
    config["reference_generation"]["lora"]["weight"] = args.reference_lora
    if getattr(args, "guide_image", None):
        if not 0 < args.guide_strength <= 1:
            raise ValueError("Guide strength must be above 0 and at most 1")
        guide = args.guide_image.resolve()
        config["reference_generation"].update(guide_image=os.path.relpath(guide, args.run),
            guide_strength=args.guide_strength, guide_sha256=sha256(guide))
    from run_state import save_plan
    save_plan(args, config, copies)
    target = args.run / "config.json"
    print(f"Planned {len(planned)} assets / {sum(len(actions_for(config,e)) for e in planned)} animations: {target}", flush=True)


def plan(args):
    if not args.definition:
        raise ValueError("Use --definition PATH to an art-only TOML file")
    assets, art = definitions(args.definition)
    source = {"adapter": "asset-definition", "path": os.path.relpath(args.definition.resolve(), REPO),
              "sha256": sha256(args.definition), "text": args.definition.read_text()}
    make_plan(args, assets, art, source)


def load(run):
    return json.loads((run / "config.json").read_text())


def child(command, run, *extra):
    cmd = [sys.executable, str(ROOT / "sprites.py"), command, "--run", str(run), *extra]
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def main(enemy_adapter=False):
    if not enemy_adapter and sys.argv[1:2] == ["bundle"]:
        from runtime_assets import main as bundle_main
        return bundle_main(sys.argv[2:])
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=["plan", "reference", "references", "prepare", "animate", "export", "review", "package", "all"])
    p.add_argument("--run", type=Path, required=not enemy_adapter)
    p.add_argument("--force", action="store_true",
                   help="Replace the entire run before plan/reference/all; requires an explicit --run and definition/roster")
    p.add_argument("--definition", type=Path)
    p.add_argument("--reference", type=Path, help="Authored pixel PNG or pixel-reference.json for one selected asset; skips SDXL")
    p.add_argument("--reference-inputs", type=Path, help="JSON mapping asset IDs to pixel PNGs or pixel-reference.json files, relative to the mapping")
    p.add_argument("--asset", "--enemy", dest="asset", nargs="+")
    p.add_argument("--content-dir", type=Path, default=REPO / "content")
    p.add_argument("--roster", type=Path)
    p.add_argument("--all-enemies", action="store_true")
    p.add_argument("--actions", nargs="*", help="Selected action names; omit to use all defined actions, pass no values for stills only")
    p.add_argument("--action")
    p.add_argument("--facing", choices=["left", "right"])
    p.add_argument("--size", type=int)
    p.add_argument("--frame-step", type=int)
    p.add_argument("--seed", type=int, default=83000)
    p.add_argument("--captions", type=Path)
    p.add_argument("--motions", type=Path, help="Enemy adapter: supplemental named animations keyed by ID and checked against description hashes")
    p.add_argument("--reference-lora", type=float, default=.65)
    p.add_argument("--guide-image", type=Path, help="Optional local SDXL img2img pose/style guide")
    p.add_argument("--reference-guides", type=Path, help="JSON mapping selected asset IDs to image (relative to JSON) and img2img strength")
    p.add_argument("--guide-strength", type=float, default=.6)
    p.add_argument("--mask-check-every", type=int, default=8)
    a = p.parse_args()
    if a.force:
        if a.command not in ("plan", "reference", "all"):
            p.error("--force replaces a whole run; use it with plan, reference, or all")
        if a.run is None or not (a.definition or a.roster or a.all_enemies):
            p.error("--force requires an explicit --run and --definition, --roster, or --all-enemies")
        if a.run.is_symlink():
            p.error("--force cannot replace a symlinked run directory")
    if a.run is None:
        a.run = ROOT.parent / "enemy-sprites/runs/ashen-foundries-v2"
    if (a.reference or a.reference_inputs) and a.command not in ("plan", "reference", "all"):
        p.error("Select pixel reference inputs when planning a new run (plan, reference, or all)")
    if (a.reference or a.reference_inputs) and (a.run.resolve() / "config.json").exists() and a.command != "plan" and not (a.definition or a.roster or a.all_enemies):
        p.error("To change reference inputs, select a definition/roster and a new run directory")
    a.run = a.run.resolve()
    planner = plan
    if enemy_adapter or a.roster or a.all_enemies:
        from enemy_adapter import plan as planner
    if a.command == "plan":
        planner(a)
    elif a.command == "reference":
        if not (a.run / "config.json").exists() or a.definition or a.roster or a.all_enemies:
            planner(a)
        child("references", a.run)
        child("prepare", a.run)
    elif a.command in ("references", "prepare"):
        import sprite_references
        getattr(sprite_references, "generate" if a.command == "references" else "prepare")(a.run)
    elif a.command in ("animate", "export", "review", "package"):
        import sprite_animations
        kwargs = {"size": a.size, "frame_step": a.frame_step} if a.command in ("export", "review") else {}
        if a.command == "animate":
            kwargs["mask_check_every"] = a.mask_check_every
        getattr(sprite_animations, a.command)(a.run, a.asset, a.action, **kwargs)
    else:
        if not (a.run / "config.json").exists() or a.definition or a.roster or a.all_enemies:
            planner(a)
        child("references", a.run)
        child("prepare", a.run)
        child("animate", a.run, "--mask-check-every", str(a.mask_check_every))
        child("export", a.run)
        child("review", a.run)
        child("package", a.run)


if __name__ == "__main__":
    main()
