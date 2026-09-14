# Enemy roster adapter

For the currently selected built-in imagegen enemy sheets, use the shared
[authored-sheet workflow](../sprite-pipeline/AUTHORED_SHEETS.md):
`uv run enemy-sprites import-sheets --recipe PATH --out DIRECTORY`.
Wetlands and Hollow Delve use data recipes for the same extractor and atlas importer.
The commands below describe the alternative local SDXL/Wan route and its older trials.

Enemy generation is now a layer above the reusable
[local sprite pipeline](../sprite-pipeline/README.md). `batch.py` resolves the
current canonical content catalog with `scripts/content.py`, maps each enemy's
`visual_description`, `visual.idle`, and `visual.attack` into art inputs, and
uses the same reference generation, animation, masking, Pyxelate, atlas export,
and review implementation as players and other sprite assets.

The renderer lives in `../sprite-pipeline/`; `references.py` and `animations.py`
are compatibility imports. New runs use generic `assets` / `asset_id` metadata;
saved schema-1 enemy runs continue to work from their original configuration.
Enemy statistics and biome scenery do not control the images. The source
catalog definitions are preserved in provenance. When there is no shared art
table, the adapter uses weathered dark fantasy and left-facing side-scroller
defaults. It does not restore or invent removed content.

Run from the repository root with the installed local environment:

```bash
uv run enemy-sprites plan --roster content/biomes/wetlands/ENEMIES.toml --run image-generation/enemy-sprites/runs/NEW_RUN --captions image-generation/enemy-sprites/wetlands.captions.json --motions image-generation/enemy-sprites/wetlands.motions.json --actions idle attack walk death --reference-lora 0.7 --seed 92004 --reference-guides image-generation/enemy-sprites/recipes/wetlands/guides.json --size 64 --frame-step 2
uv run enemy-sprites all --run image-generation/enemy-sprites/runs/NEW_RUN --mask-check-every 22
```

Use `--enemy ID` (alias of `--asset`) to select subjects, `--actions idle attack`
to select states, or `--all-enemies` to explicitly select the current catalog.
`--facing right` overrides facing. Optional `--captions PATH` reads short
reference captions keyed by enemy ID, checked against SHA256 of the canonical
visual description.

`--motions PATH` adds generation-only motion directions for states absent from
curated content. The JSON is keyed by enemy ID; each entry contains
`source_sha256` (SHA256 of the exact canonical `visual_description`) and an
`animations` table whose actions each have `description` and boolean `loop`.
Existing canonical actions cannot be replaced. Stale hashes, unknown enemies,
and explicitly requested actions missing from any selected enemy fail before
inference. The run snapshots the supplement alongside the canonical definitions.
The Wetlands supplement supplies anatomy-specific `walk` and `death` directions;
it does not change game content.

Idle and walk loop. Walk is an in-place gait, with game movement supplied by the
engine. Attack and death are one-shot actions; death holds its collapsed final
pose. Death is rejected if marked as looping. These are model instructions and
playback metadata, not guarantees that a generated clip obeys them. The review
page respects loop flags; GIF/APNG previews repeat for inspection. See the shared pipeline documentation for stages, static
exports, named actions, local img2img guides, frame skipping and limitations.

A saved run can be re-exported without the original roster or new inference:

```bash
uv run enemy-sprites export --run image-generation/enemy-sprites/runs/ashen-foundries-v2 --size 128 --frame-step 4
```

Alternate exports preserve the original settings and output. The previous
[Foundries experiment](runs/ashen-foundries-v2/README.md),
[results](runs/ashen-foundries-v2/RESULTS.md), and generated candidates remain
historical artifacts; that roster is no longer part of the curated content
catalog. Its original recipe cannot be replanned from the current catalog, but
its saved config, original images, selected references and animation data remain
usable. Existing completed inference contracts are unchanged by the refactor.

Validation uses synthetic catalog fixtures independent of curated game data:

```bash
uv run sprite-python -m unittest discover -s image-generation/enemy-sprites -p 'test_*.py' -v
```

The [Wetlands four-action recipe](recipes/wetlands/README.md) preserves the selected shape guides and exact commands for the 20-animation experiment.

Latest selected Wetlands candidates: [viewer](runs/wetlands-selected/review.html), [results](runs/wetlands-selected/RESULTS.md), [PNG bundle](runs/wetlands-selected/sprites.zip). All five enemies have idle, attack, walk and death; see the report for motion failures and the improved Hulk attack selection.
