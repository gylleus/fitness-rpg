"""Canonical game enemies → art-only inputs to the shared sprite pipeline."""
from copy import deepcopy
import hashlib
import json
import sprites
from content import load_content, read_toml


def plan(args):
    root = args.content_dir.resolve()
    content = load_content(root)
    biome_id = None
    if args.all_enemies:
        keys = list(content["enemies"])
    else:
        if not args.roster:
            raise ValueError("Select a current --roster PATH or --all-enemies; no discarded roster is loaded by default")
        roster = read_toml(root, str(args.roster.resolve().relative_to(root)))
        biome_id = roster["biome_id"]
        if biome_id not in content["biomes"] or content["biomes"][biome_id]["encounters"] != roster["encounters"]:
            raise ValueError("Roster must match the catalog's registered biome roster")
        keys = [e["enemy_id"] for e in roster["encounters"]]
    # An encounter may occur repeatedly; render its canonical asset only once.
    keys = list(dict.fromkeys(keys))
    supplements = json.loads(args.motions.read_text()) if getattr(args, "motions", None) else {}
    if not isinstance(supplements, dict) or set(supplements) - set(keys):
        raise ValueError("Supplemental motion IDs must belong to the selected roster")
    assets = []
    requested_assets = getattr(args, "asset", None) or getattr(args, "enemy", None)
    for key in keys:
        enemy = content["enemies"][key]
        animations = {action: {"description": enemy["visual"][action], "loop": action == "idle"}
                      for action in ("idle", "attack")}
        if key in supplements:
            extra = supplements[key]
            if not isinstance(extra, dict) or set(extra) != {"source_sha256", "animations"}:
                raise ValueError("Supplemental motions require source_sha256 and animations")
            if extra["source_sha256"] != hashlib.sha256(enemy["visual_description"].encode()).hexdigest():
                raise ValueError(f"Supplemental motions are stale for {key}")
            sprites.validate_animations(extra["animations"])
            if set(extra["animations"]) & set(animations):
                raise ValueError("Supplemental motions cannot replace canonical idle or attack")
            animations.update(deepcopy(extra["animations"]))
        if (not requested_assets or key in requested_assets) and args.actions is not None and set(args.actions) - set(animations):
            raise ValueError(f"{key} lacks requested animations: {sorted(set(args.actions)-set(animations))}")
        assets.append({"id": key, "name": enemy["name"], "kind": "enemy",
            "visual_description": enemy["visual_description"], "visual": deepcopy(enemy["visual"]),
            "animations": animations})
    sprites.make_plan(args, assets, {**sprites.DEFAULT_ART, **content["art"]},
        {"adapter": "enemy-roster", "biome_id": biome_id, "supplemental_motions": supplements,
         "content_sha256": {str(p.relative_to(root)): sprites.sha256(p) for p in sorted(root.rglob("*.toml"))},
         "canonical_enemies": {key: content["enemies"][key] for key in keys}})
