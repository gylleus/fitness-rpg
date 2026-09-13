# Structured game content

The authored environments and enemies are being rebuilt through user-led curation.
[catalog.toml](catalog.toml) registers [Wetlands](biomes/wetlands/BIOME.toml)
and [Hollow Delve](biomes/hollow_delve/BIOME.toml). Wetlands has five marsh
enemies. Hollow Delve has a Troglodyte, Giant Cave Spider, Bone Slime, Delve
Dwarf and Delve Gnoll, with eight isolated cave props and decorations in
[SCENERY.toml](biomes/hollow_delve/SCENERY.toml). Combat values remain provisional.
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
change runtime dungeons or enemies. The first runtime expedition now uses a
compact Wetlands roster snapshot, refreshed explicitly with
`uv run python scripts/runtime_roster.py --biome wetlands --output src/game/rosters/wetlands.json`.
See [runtime sprites](../assets/sprites/README.md) for the corresponding animation package.

## Validate and export

[scripts/content.py](../scripts/content.py) uses only the standard library.
The root uv project selects Python 3.12.9. From the repository root:

```sh
uv run content
uv run content --export-json /tmp/game-content.json
uv run python -m unittest discover -s scripts -p 'test_content.py'
```

The underlying script supports Python 3.11+. The tool accepts an empty
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
scenery_file = "biomes/wetlands/SCENERY.toml"
```

Each `[[biomes]]` entry has an `id`, `biome_file`, and `enemies_file`, with
paths relative to the manifest. An optional `scenery_file` registers the biome's
isolated prop library; an explicitly registered missing file is an error.
Biome data belongs in `biomes/<biome_id>/BIOME.toml`,
`biomes/<biome_id>/ENEMIES.toml`, and `biomes/<biome_id>/SCENERY.toml`. The optional
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
| `sites` | table array | Location concepts with a globally unique `id`, `name`, and `description`. May be empty. |
| `background_layers`, `ground_sections` | table array, optional | Scene asset definitions; see below. |
| `props`, `decorations` | table array, optional | Legacy inline libraries with `id`, `name`, and `description`. New isolated props belong in `SCENERY.toml`. |

Display descriptions and generation instructions have distinct fields. Wetlands'
existing isolated props and decorations moved to `SCENERY.toml` with their IDs
and prose preserved. The plank walkway moved to `ground_sections`. Sites remain
setting descriptions; representative cottages, walls and peat stacks are scenery
cutouts, not required stops on a route.

## Background and ground art

[Wetlands BIOME.toml](biomes/wetlands/BIOME.toml) defines three background layers
and three interchangeable ground sections. Each asset has `id`, `name`,
`visual_description` (appearance prose), and a `generation` table (production
instructions). Site, legacy prop/decoration, background, ground and scenery IDs
share one global namespace. Enemy IDs retain their separate namespace.

`generation.scene` establishes the shared art target:

| Field | Meaning |
| --- | --- |
| `canvas` | `[width, height]` logical pixels for every background layer, currently `[640, 360]`. |
| `ground_y` | Walking baseline measured down from the top of the scene, currently `288`. |
| `reference_height` | Adventurer silhouette height in the reference composition, currently `64` pixels. |
| `view` | `orthographic_side`; the route travels horizontally across the image. |
| `style`, `avoid` | Shared style text and exclusions. Lighting and palette guidance come from `visual`. |

`background_layers` are ordered far to near. Each layer's `generation` requires
`parallax` (0–1, nondecreasing), `repeat_x` (boolean), `transparent` (boolean), and
`composition` (text). The first layer is opaque; later layers have transparent
space around their painted silhouettes. A parallax factor of 0 is stationary;
1 moves with the ground. Wetlands uses overcast sky, distant tree/roof silhouettes,
and middle-distance pools and reed banks. Nearby trees and cottages are separate
props. No layer contains characters or enemies.

`generation.ground` supplies the common `canvas`, `surface_y`, `edge_margin`,
`repeat_x`, and `edge_description` for all ground sections. Wetlands uses a
256×96 canvas with a surface at row 24: place the strip at scene row 264 to align
its surface with the walking baseline and cover the bottom of the scene.
The first and last 16 columns return to the same level peat profile; distinctive
boards or roots occupy the middle. Each section's `generation.composition`
describes its variation within that contract. The ground has transparent space
above its silhouette and opaque soil below it. Sections describe visual terrain,
not collision shapes, jumps, or mandatory obstacles.

Canvas dimensions are integers from 16–1024 per side, with aspect ratio at most
4:1. These are initial art targets, not device sizes or inference settings.
`repeat_x` and the edge description request matching seams; actual pixel seams
and mixed-section joins still require visual review after generation.

## Scenery library

[Wetlands SCENERY.toml](biomes/wetlands/SCENERY.toml) contains `schema_version`,
`biome_id`, and a `scenery` table array. An empty array is allowed. Each entry has
`id`, `name`, `visual_description`, and the following `generation` fields:

| Field | Meaning |
| --- | --- |
| `canvas` | Target transparent cutout dimensions; rectangular props are allowed. |
| `height_scale` | Positive visible silhouette height relative to the adventurer. Transparent padding is excluded. |
| `layers` | Eligible placements: `behind_path`, `foreground`, or both. |
| `anchor` | `ground` for a supported base or `waterline` for the depicted contact with water. |
| `composition` | Isolation, attachment, silhouette and framing instructions. |

All scenery entries are static transparent cutouts and inherit the biome's view,
style, lighting, exclusions and palette guidance. The reference-height target
sets their relative size in a composed scene; canvas dimensions include padding
and do not themselves define world scale. The contact anchor is identified during
cutout preparation; these definitions do not claim a measured pixel pivot yet.
Reeds, roots and debris can occupy the low foreground. Tall trees and buildings
stay behind the walking path. Attached details include their support: fungi on a
short stump, or an unlit lantern on a broken post. Waterline assets omit painted
water so they can be placed over a pool.

This is a library of eligible props, not a placement sequence. Runtime placement
chooses suitable bank/water positions and keeps the walking silhouettes readable.
List order does not set frequency, and entries do not imply interactivity or
enemy spawn conditions. Enemy eligibility remains entirely in `ENEMIES.toml`.

`load_content()` and resolved JSON expose the library as each biome's `scenery`
array (empty when no file is registered), alongside background and ground data.
The content validator checks the files and their composition contracts. The
sprite CLI does not yet consume these scene definitions: its existing background
adapter exports opaque static scenes, and its prop adapter exports square sprites.
Transparent scene layers, rectangular scenery, seamless joins, asset bundling and
runtime placement still need the corresponding pipeline/runtime adapters. Model
settings, seeds, generated output paths and measured pivots belong in asset runs.

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
