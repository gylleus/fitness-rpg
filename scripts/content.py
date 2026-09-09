#!/usr/bin/env python3
"""Validate authored TOML and export resolved biome data. Requires Python 3.11+."""

import argparse
import json
import math
from pathlib import Path
import re
import sys
import tomllib

CONTENT_ROOT = Path(__file__).resolve().parents[1] / "content"
ID = re.compile(r"[a-z][a-z0-9]*(?:_[a-z0-9]+)*\Z")
COLOR = re.compile(r"#[0-9A-Fa-f]{6}\Z")
FAMILIES = ("beast", "ooze", "plant", "undead", "goblin", "dwarf", "human", "spirit", "fiend", "giant", "construct")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def shape(value, required, where, optional=()):
    require(isinstance(value, dict), f"{where}: expected a table")
    missing = set(required) - value.keys()
    unknown = value.keys() - set(required) - set(optional)
    require(not missing, f"{where}: missing fields {sorted(missing)}")
    require(not unknown, f"{where}: unknown fields {sorted(unknown)}")


def string(value, where):
    require(isinstance(value, str) and bool(value.strip()), f"{where}: expected nonempty text")


def strings(value, where, allow_empty=False):
    require(isinstance(value, list), f"{where}: expected an array")
    require(allow_empty or bool(value), f"{where}: empty array")
    for item in value:
        string(item, where)


def rows(value, where):
    require(isinstance(value, list), f"{where}: expected an array of tables")
    for item in value:
        require(isinstance(item, dict), f"{where}: expected a table entry")
    return value


def identifier(value, where):
    string(value, where)
    require(ID.fullmatch(value), f"{where}: invalid snake_case ID {value!r}")


def unique(value, seen, where):
    require(value not in seen, f"{where}: duplicate {value!r}")
    seen.add(value)


def read_toml(root, filename):
    string(filename, "file path")
    relative = Path(filename)
    path = (root / relative).resolve()
    require(not relative.is_absolute() and path.is_relative_to(root.resolve()),
            f"{filename}: expected a path within the content directory")
    with path.open("rb") as stream:
        data = tomllib.load(stream)
    require(type(data.get("schema_version")) is int and data["schema_version"] == 1,
            f"{filename}: unsupported schema_version; expected 1")
    return data


def validate_enemy(enemy, catalog):
    shape(enemy, ("id", "name", "family", "rank", "tier", "balance", "description", "visual_description",
                  "quirk", "stats", "fallback_sprite", "visual"), "enemy", ("biomes",))
    key = enemy["id"]
    identifier(key, "enemy.id")
    for field in ("name", "description", "visual_description", "quirk"):
        string(enemy[field], f"{key}.{field}")
    for field, vocabulary, default in (("family", "families", FAMILIES),
                                       ("rank", "ranks", ("common", "elite", "boss")),
                                       ("balance", "balance_states", ("existing", "draft"))):
        require(enemy[field] in catalog.get(vocabulary, default), f"{key}: invalid {field}")
    require(type(enemy["tier"]) is int and 1 <= enemy["tier"] <= 4, f"{key}: tier must be 1–4")
    require(enemy["fallback_sprite"] in ("slime", "wolf", "knight", "boss"), f"{key}: invalid fallback_sprite")
    if "biomes" in enemy:
        strings(enemy["biomes"], f"{key}.biomes")
        require(set(enemy["biomes"]) <= set(catalog.get("biomes", [])), f"{key}: unknown legacy habitat tag")
    shape(enemy["stats"], ("health", "attack", "gold", "xp"), f"{key}.stats")
    for field, value in enemy["stats"].items():
        minimum = 1 if field in ("health", "attack") else 0
        require(type(value) is int and value >= minimum, f"{key}.stats.{field}: expected integer >= {minimum}")
    visual = enemy["visual"]
    shape(visual, ("height_scale", "silhouette", "appearance", "equipment", "palette", "idle", "attack"),
          f"{key}.visual", ("avoid",))
    scale = visual["height_scale"]
    require(type(scale) in (int, float) and math.isfinite(scale) and scale > 0, f"{key}: invalid height_scale")
    for field in ("silhouette", "appearance", "idle", "attack"):
        string(visual[field], f"{key}.visual.{field}")
    strings(visual["equipment"], f"{key}.visual.equipment", allow_empty=True)
    strings(visual.get("avoid", []), f"{key}.visual.avoid", allow_empty=True)
    strings(visual["palette"], f"{key}.visual.palette")
    require(all(COLOR.fullmatch(c) for c in visual["palette"]), f"{key}: invalid palette color")


def validate_biome(biome, asset_ids):
    shape(biome, ("schema_version", "id", "name", "short_description", "description", "setting", "visual",
                  "generation", "sites", "props", "decorations"), "biome")
    key = biome["id"]
    identifier(key, "biome.id")
    for field in ("name", "short_description", "description"):
        string(biome[field], f"{key}.{field}")
    shape(biome["setting"], ("terrain", "inhabitants", "supernatural", "environmental_pressure_and_humor"), f"{key}.setting")
    for field, value in biome["setting"].items():
        string(value, f"{key}.setting.{field}")
    visual = biome["visual"]
    shape(visual, ("lighting", "materials", "weather", "ambient_sounds", "ambient_motion", "palette"), f"{key}.visual")
    for field in ("lighting", "weather", "ambient_motion"):
        string(visual[field], f"{key}.visual.{field}")
    for field in ("materials", "ambient_sounds"):
        strings(visual[field], f"{key}.visual.{field}")
    require(bool(rows(visual["palette"], f"{key}.visual.palette")), f"{key}: empty palette")
    for swatch in visual["palette"]:
        shape(swatch, ("name", "color"), f"{key}.visual.palette")
        string(swatch["name"], f"{key}.palette.name")
        string(swatch["color"], f"{key}.palette.color")
        require(COLOR.fullmatch(swatch["color"]), f"{key}: invalid palette color")
    shape(biome["generation"], ("composition",), f"{key}.generation")
    string(biome["generation"]["composition"], f"{key}.generation.composition")
    for group in ("sites", "props", "decorations"):
        for item in rows(biome[group], f"{key}.{group}"):
            shape(item, ("id", "name", "description"), f"{key}.{group}")
            identifier(item["id"], f"{key}.{group}.id")
            unique(item["id"], asset_ids, "site/prop/decoration ID")
            for field in ("name", "description"):
                string(item[field], f"{item['id']}.{field}")


def load_content(root=CONTENT_ROOT):
    """Load all definition owners before resolving encounters, regardless of file order."""
    manifest = read_toml(root, "catalog.toml")
    shape(manifest, ("schema_version", "biomes"), "catalog.toml", ("shared_enemies_file",))
    shared = {"catalog": {}, "combat": {}, "art": {}, "dungeons": [], "enemies": []}
    sources = set()
    if "shared_enemies_file" in manifest:
        shared = read_toml(root, manifest["shared_enemies_file"])
        shape(shared, ("schema_version", "catalog", "combat", "art", "dungeons", "enemies"), "shared catalog")
        sources.add(manifest["shared_enemies_file"])
        shape(shared["catalog"], ("description", "families", "ranks", "biomes", "balance_states", "tier_notes", "encounter_notes"), "catalog")
        for field in ("families", "ranks", "biomes", "balance_states", "tier_notes"):
            strings(shared["catalog"][field], f"catalog.{field}")
        for field in ("description", "encounter_notes"):
            string(shared["catalog"][field], f"catalog.{field}")
        for table, arrays in (("combat", ("stat_fields",)), ("art", ("avoid",))):
            required = ("stat_fields", "stat_units", "behavior", "rewards", "balance_notes") if table == "combat" else (
                "style", "tone", "framing", "view", "facing", "background", "lighting", "palette_notes", "scale_notes", "avoid")
            shape(shared[table], required, table)
            for field, value in shared[table].items():
                (strings if field in arrays else string)(value, f"{table}.{field}")
    catalog = shared["catalog"]
    enemies, biomes, asset_ids = {}, {}, set()

    def add_enemies(entries):
        for enemy in rows(entries, "enemies"):
            validate_enemy(enemy, catalog)
            require(enemy["id"] not in enemies, f"duplicate enemy ID: {enemy['id']}")
            enemies[enemy["id"]] = enemy

    add_enemies(shared["enemies"])
    for entry in rows(manifest["biomes"], "catalog.toml.biomes"):
        shape(entry, ("id", "biome_file", "enemies_file"), "biome manifest entry")
        identifier(entry["id"], "manifest biome ID")
        for field in ("biome_file", "enemies_file"):
            string(entry[field], field)
            unique(entry[field], sources, "content source path")
        biome = read_toml(root, entry["biome_file"])
        roster = read_toml(root, entry["enemies_file"])
        validate_biome(biome, asset_ids)
        shape(roster, ("schema_version", "biome_id", "encounters", "enemies"), "enemy roster")
        require(entry["id"] == biome["id"] == roster["biome_id"], f"{entry['id']}: biome ID mismatch")
        require(biome["id"] not in biomes, f"duplicate biome ID: {biome['id']}")
        add_enemies(roster["enemies"])
        seen = set()
        for encounter in rows(roster["encounters"], f"{biome['id']}.encounters"):
            shape(encounter, ("enemy_id",), "encounter", ("context",))
            identifier(encounter["enemy_id"], "encounter.enemy_id")
            unique(encounter["enemy_id"], seen, f"{biome['id']} encounter")
            if "context" in encounter:
                string(encounter["context"], "encounter.context")
        biomes[biome["id"]] = {**biome, "encounters": roster["encounters"]}
    for biome in biomes.values():
        for encounter in biome["encounters"]:
            require(encounter["enemy_id"] in enemies,
                    f"{biome['id']}: unknown enemy ID {encounter['enemy_id']}")
    dungeon_ids, runtime_ids = set(), set()
    for dungeon in rows(shared["dungeons"], "dungeons"):
        shape(dungeon, ("id", "runtime_id", "name", "enemy_ids"), "dungeon")
        identifier(dungeon["id"], "dungeon.id")
        unique(dungeon["id"], dungeon_ids, "dungeon ID")
        require(type(dungeon["runtime_id"]) is int and dungeon["runtime_id"] >= 0, "invalid dungeon runtime_id")
        unique(dungeon["runtime_id"], runtime_ids, "dungeon runtime_id")
        string(dungeon["name"], "dungeon.name")
        strings(dungeon["enemy_ids"], "dungeon.enemy_ids")
        require(all(key in enemies for key in dungeon["enemy_ids"]), f"{dungeon['id']}: unknown enemy ID")
        require(enemies[dungeon["enemy_ids"][-1]]["rank"] == "boss", f"{dungeon['id']}: final enemy must be a boss")
    return {"schema_version": 1, "catalog": catalog, "art": shared["art"], "combat": shared["combat"],
            "dungeons": shared["dungeons"], "enemies": enemies, "biomes": biomes}


def resolved_export(content, biome_id=None):
    selected = content["biomes"]
    if biome_id is not None:
        require(biome_id in selected, f"unknown biome ID: {biome_id}")
        selected = {biome_id: selected[biome_id]}
    biomes = []
    for biome in selected.values():
        encounters = [{**entry, "enemy": content["enemies"][entry["enemy_id"]]} for entry in biome["encounters"]]
        biomes.append({**biome, "encounters": encounters})
    return {"schema_version": 1, "catalog": content["catalog"], "art": content["art"],
            "combat": content["combat"], "biomes": biomes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content-dir", type=Path, default=CONTENT_ROOT)
    parser.add_argument("--biome", help="Limit JSON export to a stable biome ID")
    parser.add_argument("--export-json", metavar="PATH", help="Write resolved JSON; use - for stdout")
    args = parser.parse_args()
    try:
        content = load_content(args.content_dir)
        if args.biome:
            require(args.biome in content["biomes"], f"unknown biome ID: {args.biome}")
        if args.export_json:
            output = json.dumps(resolved_export(content, args.biome), ensure_ascii=False, indent=2) + "\n"
            if args.export_json == "-":
                print(output, end="")
            else:
                Path(args.export_json).write_text(output, encoding="utf-8")
        count = sum(len(biome["encounters"]) for biome in content["biomes"].values())
        print(f"Valid: {len(content['biomes'])} biomes, {len(content['enemies'])} enemies, {count} encounters.",
              file=sys.stderr if args.export_json == "-" else sys.stdout)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Content error: {error}\n")


if __name__ == "__main__":
    main()
