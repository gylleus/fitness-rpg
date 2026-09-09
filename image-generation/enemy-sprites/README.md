# Enemy roster adapter

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
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py plan --roster content/biomes/wetlands/ENEMIES.toml --run image-generation/enemy-sprites/runs/NEW_RUN --size 64 --frame-step 2
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py all --run image-generation/enemy-sprites/runs/NEW_RUN --mask-check-every 22
```

Use `--enemy ID` (alias of `--asset`) to select subjects, `--actions idle attack`
to select states, or `--all-enemies` to explicitly select the current catalog.
`--facing right` overrides facing. Optional `--captions PATH` reads short
reference captions keyed by enemy ID, checked against SHA256 of the canonical
visual description. See the shared pipeline documentation for stages, static
exports, named actions, local img2img guides, frame skipping and limitations.

A saved run can be re-exported without the original roster or new inference:

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py export --run image-generation/enemy-sprites/runs/ashen-foundries-v2 --size 128 --frame-step 4
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
image-generation/sprite-animation/.venv/bin/python -m unittest discover -s image-generation/enemy-sprites -p 'test_*.py' -v
```
