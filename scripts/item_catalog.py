#!/usr/bin/env python3
"""Validate item TOML, export runtime definitions, and prepare individual icon prompts."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import tomllib
from asset_palette import palette_guidance, palette_contract

ROOT = Path(__file__).resolve().parents[1]
WEAPON_TYPES = {'maces': 'mace', 'swords': 'sword', 'axes': 'axe', 'fist_weapons': 'fist'}
KINDS = {**dict.fromkeys(WEAPON_TYPES, 'weapon'), 'body_armor': 'armor',
         'helmets': 'helmet', 'gloves': 'gloves', 'rings': 'ring', 'amulets': 'amulet'}
MODIFIERS = {'health': 500, 'armor': 300, 'damage': 100,
             'pushup_damage_coefficient': .1, 'crit_chance_bps': 10000, 'crit_damage_bps': 30000}


def require(test, message):
    if not test:
        raise ValueError(message)


def shape(value, keys, where):
    require(isinstance(value, dict) and set(value) == set(keys), f'{where}: expected fields {keys}')


def text(value, where):
    require(isinstance(value, str) and bool(value.strip()), f'{where}: expected nonempty text')


def numeric(value, where, minimum=0, maximum=10000, integer=True):
    require(type(value) in ((int,) if integer else (int, float)) and math.isfinite(value)
            and minimum <= value <= maximum, f'{where}: invalid number')


def load_items(root, files):
    require(isinstance(files, list), 'item_files: expected array')
    items, categories, sources = {}, set(), set()
    for filename in files:
        text(filename, 'item file')
        relative = Path(filename)
        path = (root / relative).resolve()
        require(not relative.is_absolute() and path.is_relative_to(root.resolve()), 'item file outside content directory')
        require(path not in sources, f'duplicate item source: {filename}')
        sources.add(path)
        library = tomllib.loads(path.read_text())
        shape(library, ['schema_version', 'category', 'kind', 'generation', 'items'], filename)
        require(type(library['schema_version']) is int and library['schema_version'] == 1, 'unsupported item schema')
        category, kind = library['category'], library['kind']
        require(category in KINDS and KINDS[category] == kind, f'{filename}: incompatible category/kind')
        require(category not in categories, f'duplicate category: {category}')
        categories.add(category)
        generation = library['generation']
        shape(generation, ['canvas', 'transparent', 'style', 'composition'], 'item generation')
        require(generation['canvas'] == [64, 64] and all(type(n) is int for n in generation['canvas']), 'icons must target 64x64')
        require(generation['transparent'] is True, 'item icons must use transparency')
        text(generation['style'], 'icon style')
        text(generation['composition'], 'icon composition')
        require(isinstance(library['items'], list) and library['items'], f'{filename}: no items')
        for item in library['items']:
            shape(item, ['id', 'name', 'tier', 'rarity', 'sell_value', 'description', 'visual_description', 'stats', 'modifiers'], 'item')
            key = item['id']
            text(key, 'item.id')
            require(re.fullmatch(r'[a-z][a-z0-9]*(?:_[a-z0-9]+)*', key), f'invalid item ID: {key}')
            require(key not in items, f'duplicate item ID: {key}')
            for field in ['name', 'description', 'visual_description']:
                text(item[field], f'{key}.{field}')
            numeric(item['tier'], f'{key}.tier', 1, 3)
            numeric(item['sell_value'], f'{key}.sell_value', 0, 100000)
            require(item['rarity'] in ['common', 'uncommon', 'rare'], f'{key}: unknown rarity')
            stats = item['stats']
            shape(stats, ['damage_min', 'damage_max'] if kind == 'weapon' else ['armor'] if kind in ['armor', 'helmet', 'gloves'] else [], f'{key}.stats')
            for field, value in stats.items():
                numeric(value, f'{key}.{field}', 1, 1000)
            if kind == 'weapon':
                require(stats['damage_min'] <= stats['damage_max'], f'{key}: reversed damage range')
            require(isinstance(item['modifiers'], list), f'{key}: modifiers must be an array')
            seen = set()
            for modifier in item['modifiers']:
                shape(modifier, ['stat', 'value'], f'{key}.modifier')
                stat = modifier['stat']
                require(stat in MODIFIERS and stat not in seen, f'{key}: unknown or duplicate modifier')
                seen.add(stat)
                numeric(modifier['value'], f'{key}.{stat}', 0, MODIFIERS[stat], stat != 'pushup_damage_coefficient')
                require(modifier['value'] > 0, f'{key}: modifier must be positive')
            items[key] = {**item, 'category': category, 'kind': kind, 'generation': generation, 'source': filename}
    return items


def runtime_catalog(items):
    definitions = {}
    for key, item in items.items():
        stats = item['stats']
        definitions[key] = {'version': 2, 'definitionId': key, 'name': item['name'], 'kind': item['kind'],
            'category': item['category'], 'rarity': item['rarity'], 'tier': item['tier'],
            'description': item['description'], 'visualDescription': item['visual_description'],
            'sellValue': item['sell_value'], 'modifiers': item['modifiers']}
        if item['kind'] == 'weapon':
            definitions[key]['weaponType'] = WEAPON_TYPES[item['category']]
        for authored, runtime in [('damage_min', 'damageMin'), ('damage_max', 'damageMax'), ('armor', 'armor')]:
            if authored in stats:
                definitions[key][runtime] = stats[authored]
    return {'schemaVersion': 1, 'items': definitions}


def icon_prompts(items):
    return [{'id': key, 'category': item['category'], 'target': [64, 64], 'palette': palette_contract(),
             'definition_sha256': hashlib.sha256(json.dumps(item, sort_keys=True).encode()).hexdigest(),
             'prompt': f"Use case: stylized-concept\nAsset type: 64x64 pixel-art inventory icon for a dark-fantasy game.\n"
             f"Subject: {item['name']}. {item['visual_description']}\n"
             f"Style: {item['generation']['style']}\nComposition: {item['generation']['composition']}\n"
             "Render one icon only, not a sheet. Square canvas, true transparent alpha background. "
             "The object occupies about 80% of the frame. Use chunky pixel clusters at a logical 64x64 scale, "
             "a dark one-pixel silhouette outline, and simple three-tone shading. "
             "No floor, cast shadow, backdrop, lettering, watermark, glow cloud or surrounding border. " + palette_guidance()}
            for key, item in items.items()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export', type=Path)
    parser.add_argument('--prompts', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    manifest = tomllib.loads((ROOT / 'content/catalog.toml').read_text())
    items = load_items(ROOT / 'content', manifest.get('item_files', []))
    for path, content in [(args.export, runtime_catalog(items)), (args.prompts, icon_prompts(items))]:
        if path is None:
            continue
        encoded = json.dumps(content, indent=2, ensure_ascii=False) + '\n'
        if args.check:
            require(path.read_text() == encoded, f'{path}: stale generated output')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(encoded)
    print(f'Valid: {len(items)} items in {len({item["category"] for item in items.values()})} categories.')


if __name__ == '__main__':
    main()
