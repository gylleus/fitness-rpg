#!/usr/bin/env python3
"""Validate authored TOML and export resolved biome data. Requires Python 3.11+."""

import argparse
import json
import math
from pathlib import Path
import re
import sys
import tomllib
from item_catalog import load_items

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


def canvas(value, where):
    require(isinstance(value, list) and len(value) == 2
            and all(type(n) is int and 16 <= n <= 1024 for n in value),
            f"{where}: expected [width, height], each 16–1024")
    require(max(value) <= 4 * min(value), f"{where}: aspect ratio exceeds 4:1")


def number(value, where, minimum=0, maximum=None):
    require(type(value) in (int, float) and math.isfinite(value) and value >= minimum
            and (maximum is None or value <= maximum), f"{where}: invalid number")


def visual_asset(asset, asset_ids, where):
    shape(asset, ("id", "name", "visual_description", "generation"), where)
    identifier(asset["id"], f"{where}.id")
    unique(asset["id"], asset_ids, "visual asset ID")
    for field in ("name", "visual_description"):
        string(asset[field], f"{asset['id']}.{field}")


def validate_environment(biome, asset_ids):
    """Validate art targets and layer/join contracts, without asserting pixel seams."""
    generation = biome["generation"]
    key = biome["id"]
    if "scene" in generation:
        scene = generation["scene"]
        shape(scene, ("canvas", "ground_y", "reference_height", "view", "style", "avoid"), f"{key}.generation.scene")
        canvas(scene["canvas"], f"{key}.scene.canvas")
        require(type(scene["ground_y"]) is int and 0 < scene["ground_y"] < scene["canvas"][1],
                f"{key}.scene.ground_y: expected pixel row inside canvas")
        require(type(scene["reference_height"]) is int and 0 < scene["reference_height"] <= scene["ground_y"],
                f"{key}.scene.reference_height: expected positive pixel height above ground")
        require(scene["view"] == "orthographic_side", f"{key}.scene.view: expected orthographic_side")
        string(scene["style"], f"{key}.scene.style")
        strings(scene["avoid"], f"{key}.scene.avoid", allow_empty=True)
    layers = rows(biome.get("background_layers", []), f"{key}.background_layers")
    require(not layers or "scene" in generation, f"{key}: background layers require generation.scene")
    previous = 0
    for index, layer in enumerate(layers):
        visual_asset(layer, asset_ids, "background layer")
        spec = layer["generation"]
        where = f"{layer['id']}.generation"
        shape(spec, ("parallax", "repeat_x", "transparent", "composition"), where)
        number(spec["parallax"], f"{where}.parallax", maximum=1)
        require(spec["parallax"] >= previous, f"{where}: layers must be ordered far to near")
        previous = spec["parallax"]
        for flag in ("repeat_x", "transparent"):
            require(type(spec[flag]) is bool, f"{where}.{flag}: expected boolean")
        require(spec["transparent"] == (index > 0), f"{where}: base layer must be opaque; later layers transparent")
        string(spec["composition"], f"{where}.composition")
    sections = rows(biome.get("ground_sections", []), f"{key}.ground_sections")
    require(not sections or "ground" in generation, f"{key}: ground sections require generation.ground")
    if "ground" in generation:
        require("scene" in generation, f"{key}: ground requires generation.scene")
        ground = generation["ground"]
        shape(ground, ("canvas", "surface_y", "edge_margin", "repeat_x", "edge_description"), f"{key}.generation.ground")
        canvas(ground["canvas"], f"{key}.ground.canvas")
        require(type(ground["surface_y"]) is int and 0 <= ground["surface_y"] < ground["canvas"][1],
                f"{key}.ground.surface_y: expected pixel row inside canvas")
        require(type(ground["edge_margin"]) is int and 0 < ground["edge_margin"] * 2 < ground["canvas"][0],
                f"{key}.ground.edge_margin: expected positive margin smaller than half the width")
        require(type(ground["repeat_x"]) is bool, f"{key}.ground.repeat_x: expected boolean")
        string(ground["edge_description"], f"{key}.ground.edge_description")
        scene = generation["scene"]
        require(ground["surface_y"] <= scene["ground_y"] and
                ground["canvas"][1] - ground["surface_y"] >= scene["canvas"][1] - scene["ground_y"],
                f"{key}: ground must cover the scene below the walking baseline")
    for section in sections:
        visual_asset(section, asset_ids, "ground section")
        shape(section["generation"], ("composition",), f"{section['id']}.generation")
        string(section["generation"]["composition"], f"{section['id']}.generation.composition")


def validate_scenery(library, biome, asset_ids):
    shape(library, ("schema_version", "biome_id", "scenery"), "scenery library")
    require(library["biome_id"] == biome["id"], f"{biome['id']}: scenery biome ID mismatch")
    entries = rows(library["scenery"], f"{biome['id']}.scenery")
    require(not entries or "scene" in biome["generation"], f"{biome['id']}: scenery requires generation.scene")
    for asset in entries:
        visual_asset(asset, asset_ids, "scenery")
        spec = asset["generation"]
        where = f"{asset['id']}.generation"
        shape(spec, ("canvas", "height_scale", "layers", "anchor", "composition"), where)
        canvas(spec["canvas"], f"{where}.canvas")
        number(spec["height_scale"], f"{where}.height_scale")
        require(spec["height_scale"] > 0, f"{where}.height_scale: expected positive relative height")
        strings(spec["layers"], f"{where}.layers")
        require(set(spec["layers"]) <= {"behind_path", "foreground"}
                and len(set(spec["layers"])) == len(spec["layers"]), f"{where}: invalid or duplicate scenery layers")
        require(spec["anchor"] in ("ground", "waterline"), f"{where}: invalid anchor")
        string(spec["composition"], f"{where}.composition")


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
                  "generation", "sites"), "biome", ("props", "decorations", "background_layers", "ground_sections"))
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
    shape(biome["generation"], ("composition",), f"{key}.generation", ("scene", "ground"))
    string(biome["generation"]["composition"], f"{key}.generation.composition")
    for group in ("sites", "props", "decorations"):
        for item in rows(biome.get(group, []), f"{key}.{group}"):
            shape(item, ("id", "name", "description"), f"{key}.{group}")
            identifier(item["id"], f"{key}.{group}.id")
            unique(item["id"], asset_ids, "site/prop/decoration ID")
            for field in ("name", "description"):
                string(item[field], f"{item['id']}.{field}")
    validate_environment(biome, asset_ids)


def load_content(root=CONTENT_ROOT):
    """Load all definition owners before resolving encounters, regardless of file order."""
    manifest = read_toml(root, "catalog.toml")
    shape(manifest, ("schema_version", "biomes"), "catalog.toml", ("shared_enemies_file", "item_files"))
    items = load_items(root, manifest.get("item_files", []))
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
        shape(entry, ("id", "biome_file", "enemies_file"), "biome manifest entry", ("scenery_file",))
        identifier(entry["id"], "manifest biome ID")
        for field in ("biome_file", "enemies_file", "scenery_file"):
            if field not in entry:
                continue
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
        scenery = []
        if "scenery_file" in entry:
            library = read_toml(root, entry["scenery_file"])
            validate_scenery(library, biome, asset_ids)
            scenery = library["scenery"]
        biomes[biome["id"]] = {**biome, "scenery": scenery, "encounters": roster["encounters"]}
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
            "dungeons": shared["dungeons"], "enemies": enemies, "biomes": biomes, "items": items}


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
            "combat": content["combat"], "biomes": biomes, "items": list(content["items"].values())}


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
        print(f"Valid: {len(content['biomes'])} biomes, {len(content['enemies'])} enemies, {count} encounters, {len(content['items'])} items.",
              file=sys.stderr if args.export_json == "-" else sys.stdout)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Content error: {error}\n")


if __name__ == "__main__":
    main()
