# Structured game content

The authored environments and enemies are being rebuilt through user-led curation.
[catalog.toml](catalog.toml) currently registers [Wetlands](biomes/wetlands/BIOME.toml),
a hostile, abandoned environment with no settled residents. Its
[enemy roster](biomes/wetlands/ENEMIES.toml) begins with the Bog Toad, whose
description is approved and whose combat values remain provisional.
There is no shared roster. New content will be developed within the scope
discussed with the user.

[design_guidelines.toml](design_guidelines.toml) preserves the agreed setting,
tone, visual style, and descriptive writing conventions. Read it before adding
creative content. It is an authoring reference, separate from the content export.

For guided enemy curation, use the repository's
[design-enemy skill](../skills/design-enemy/SKILL.md), for example:
`Use design-enemy for Wetlands`. It proposes concepts, drafts the selected enemy's
appearance and attack, and saves both to TOML after the draft is accepted.

The app still uses `src/game/combat.ts`. Authored content does not automatically
change the existing runtime dungeons or enemies.

## Validate and export

[scripts/content.py](../scripts/content.py) requires Python 3.11+ and uses only
the standard library. From the repository root:

```sh
python3.12 scripts/content.py
python3.12 scripts/content.py --export-json /tmp/game-content.json
python3.12 -m unittest discover -s scripts -p 'test_content.py'
```

Any Python 3.11+ interpreter can replace `python3.12`. The tool accepts an empty
catalog and exports an empty `biomes` array. Shared `catalog`, `art`, and `combat`
metadata are empty objects when no shared catalog is registered.

Use `--biome <biome_id>` (for example, `--biome wetlands`) to limit the export to that region.
An unknown ID is an error. `--export-json -` writes JSON to stdout, with the
validation summary on stderr. `--content-dir` selects another content tree.

Validation checks schema versions, fields, types, unique IDs, classifications,
stat bounds, palettes, file paths, and encounter references. Tests create small
synthetic fixtures in temporary directories; they do not define game content.

## Catalog and future files

The current manifest is:

```toml
schema_version = 1

[[biomes]]
id = "wetlands"
biome_file = "biomes/wetlands/BIOME.toml"
enemies_file = "biomes/wetlands/ENEMIES.toml"
```

Each `[[biomes]]` entry has an `id`, `biome_file`, and `enemies_file`, with
paths relative to the manifest. Biome data belongs in
`biomes/<biome_id>/BIOME.toml` and `biomes/<biome_id>/ENEMIES.toml`. The optional
`shared_enemies_file` field is supported if a shared library is later authored;
omitting it requires no shared file and loads no default enemies or encounters.

All content files use `schema_version = 1`. IDs are stable lowercase snake_case
keys and remain unchanged when display names change. Each enemy has one
definition owner; rosters reference it by ID. All registered definitions are
loaded before encounter references resolve, including references across biomes.

## Biome field contract

| Field | Type | Meaning |
| --- | --- | --- |
| `id`, `name` | string | Stable biome ID and display name. |
| `short_description`, `description` | string | Brief and extended region descriptions. |
| `setting.terrain`, `setting.inhabitants` | string | Geography, travel, settlements, and everyday life. |
| `setting.supernatural` | string | Uncanny details. |
| `setting.environmental_pressure_and_humor` | string | Environmental and tonal context. |
| `visual.lighting`, `visual.weather`, `visual.ambient_motion` | string | Light, conditions, and background movement. |
| `visual.materials`, `visual.ambient_sounds` | string array | Materials and sound cues. |
| `visual.palette` | table array | Each swatch has `name` and `color` (`#RRGGBB`). |
| `generation.composition` | string | Environment composition and asset guidance. |
| `sites`, `props`, `decorations` | table array | Each entry has a globally unique `id`, `name`, and `description`. Empty arrays are allowed. |

Display descriptions and generation instructions have distinct fields. Props and
decorations form an asset library; their presence does not imply interactivity.

## Enemy field contract

A biome roster contains `schema_version`, `biome_id`, `encounters`, and `enemies`.
Both arrays may be empty. `encounters` lists the enemies eligible for random
spawning as the player walks through the side-scrolling biome. Each authored
entry contains only an `enemy_id`. Spawning is independent of scenery: enemies
are not assigned to pools, buildings, props, or other specific locations.
List order does not determine spawn order or probability; spawn rates and
timing belong to runtime gameplay. The loader still accepts optional `context`,
but omit it from authored rosters. A new enemy definition has these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `id`, `name` | string | Stable enemy ID and display name. |
| `family` | string | `beast`, `ooze`, `plant`, `undead`, `goblin`, `dwarf`, `human`, `spirit`, `fiend`, `giant`, or `construct`. |
| `rank` | string | `common`, `elite`, or `boss`. |
| `tier` | integer | Difficulty band 1–4; no automatic stat scaling. |
| `balance` | string | `draft` for provisional stats; `existing` for values copied from runtime. |
| `description` | string | Bestiary context. |
| `visual_description` | string | Rich third-person prose describing the creature itself, without artist instructions. |
| `quirk` | string | Behavioral flavor or understated humor. |
| `stats.health`, `stats.attack` | integer | Positive maximum HP and damage for one retaliation. |
| `stats.gold`, `stats.xp` | integer | Nonnegative reward values. |
| `fallback_sprite` | string | Current placeholder kind: `slime`, `wolf`, `knight`, or `boss`. |
| `visual.height_scale` | number | Positive relative silhouette height, with the adventurer at 1.0. |
| `visual.silhouette`, `visual.appearance` | string | Structured outline and surface details. |
| `visual.equipment` | string array | Visible equipment; empty when none. |
| `visual.palette` | string array | Suggested `#RRGGBB` swatches. |
| `visual.idle`, `visual.attack` | string | Separate animation directions. |
| `visual.avoid` | string array, optional | Creature-specific exclusions. |

The optional legacy enemy `biomes` field requires a shared catalog vocabulary.
New definitions can omit it; encounter references determine biome membership.

Resolved JSON places the complete enemy definition under each encounter's
`enemy`, including `enemy.visual_description`. Python consumers can use
`load_content()` for dictionaries keyed by ID and `resolved_export()` for the
joined data. Neither tool generates missing content or populates empty rosters.

The saved guidelines retain sprite conventions. Generation settings and output
paths belong to generation runs. Descriptive anatomy, armor, magic, and hazards
do not create gameplay mechanics or multiply explicit stats. Runtime integration
and encounter balancing are separate work.
