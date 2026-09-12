#!/usr/bin/env python3
"""Export a compact, validated runtime enemy lookup; encounter order stays in the game."""
import argparse
import json
from pathlib import Path
from content import CONTENT_ROOT, load_content, resolved_export

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--biome", required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
biome = resolved_export(load_content(CONTENT_ROOT), args.biome)["biomes"][0]
enemies = {}
for encounter in biome["encounters"]:
    enemy = encounter["enemy"]
    enemies[enemy["id"]] = {"id": enemy["id"], "name": enemy["name"],
        **enemy["stats"], "sprite": enemy["fallback_sprite"]}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps({"biome_id": biome["id"], "name": biome["name"], "enemies": enemies}, indent=2)+"\n")
print(f"Exported {len(enemies)} enemies → {args.output}")
