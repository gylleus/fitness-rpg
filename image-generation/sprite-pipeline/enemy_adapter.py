"""Canonical game enemies → art-only inputs to the shared sprite pipeline."""
from copy import deepcopy
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
    assets = []
    for key in keys:
        enemy = content["enemies"][key]
        assets.append({"id": key, "name": enemy["name"], "kind": "enemy",
            "visual_description": enemy["visual_description"], "visual": deepcopy(enemy["visual"]),
            "animations": {action: {"description": enemy["visual"][action], "loop": action == "idle"}
                           for action in ("idle", "attack")}})
    sprites.make_plan(args, assets, {**sprites.DEFAULT_ART, **content["art"]},
        {"adapter": "enemy-roster", "biome_id": biome_id,
         "content_sha256": {str(p.relative_to(root)): sprites.sha256(p) for p in sorted(root.rglob("*.toml"))},
         "canonical_enemies": {key: content["enemies"][key] for key in keys}})
