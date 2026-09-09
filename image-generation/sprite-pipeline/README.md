# Reusable local sprite pipeline

`sprites.py` is the shared renderer. `enemy_adapter.py` resolves canonical game
enemy rosters into art inputs; an art-only TOML definition supplies players,
other characters, isolated props, or effects without biome or combat fields.
The original `enemy-sprites/batch.py` is now a compatibility entry point to the
same implementation. Saved schema-1 enemy runs remain readable and resumable.
New plans use schema 2 with `assets` and `asset_id`.

The core stages are local SDXL + Pixel Art XL reference generation, BiRefNet
background removal, optional Wan2.2 animation, SAM2 tracking, then shared framing,
ENDESGA32 conversion and PNG/atlas export. The nearest baseline and conservative
Pyxelate version share masks, palette and crop. Pyxelate uses its geometry
reducer with SVD and dithering disabled, Sobel 3 and depth 1, followed by CIEDE2000
palette mapping. It is not the stock `Pyx.transform()` operation.

## Definition and commands

Run from the repository root with the installed environment. No new packages,
downloads, hosted inference or credentials are needed for these commands.

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/sprite-pipeline/sprites.py plan --definition image-generation/player-sprites/barbarian.toml --run image-generation/player-sprites/runs/NEW_RUN --seed 91004 --size 64 --frame-step 2
image-generation/sprite-animation/.venv/bin/python image-generation/sprite-pipeline/sprites.py all --run image-generation/player-sprites/runs/NEW_RUN --mask-check-every 22
```

Choose a new run directory for changed descriptions, seeds or generation
settings. `config.json` preserves the original definition text, resolved art
inputs, prompts, model revisions and seeds. Generation outputs record their
hashes, dependency versions and settings. Completed stages are verified and
reused on resume.

Minimal static prop definition:

```toml
schema_version = 1

[[assets]]
id = "wooden_chest"
name = "Wooden chest"
kind = "prop"
visual_description = "A squat wooden chest has a curved lid and two rusty iron bands."
```

Each `[[assets]]` entry requires a stable snake_case `id`, `name`, and
`visual_description`. `kind` is a descriptive tag (`character`, `player`, `enemy`,
`prop`, `effect`), not a model selector. Optional `reference_caption` is a compact
reference prompt condensation stored beside the full prose. Optional `visual`
fields are `silhouette`, `equipment`, `palette`, `height_scale`, `anchor`
(`ground` or `floating`), and `avoid`. Source palette swatches are guidance;
the current pixel backend uses the saved ENDESGA32 palette in
`sprite-animation/palette.json`.

Named animations are optional and have explicit loop intent:

```toml
[assets.animations.open]
description = "The chest lid lifts on its hinges and stays open."
loop = false
```

The name is unrestricted except for safe snake_case and reserved `reference`.
Names such as `walk`, `hurt`, `cast`, or `burn` require no renderer changes.
Each asset may define different actions. Omit `--actions` to use all defined
actions; use `--actions idle attack` to select names, or an empty `--actions`
argument to generate only stills. These are prompt-driven motions, not pretrained
action guarantees. Write locomotion descriptions explicitly as moving in place.
The one-shot timing prompt defers to the recovery or final pose described by the
action, so a chest can remain open while a sword attack returns to guard.

`[art]` optionally overrides `style`, `lighting`, `facing`, and `avoid`.
`--facing right` overrides the definition. The current framing is an isolated
subject with generous clearance for equipment and motion.

For enemies, use the current curated catalog:

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py plan --roster content/biomes/wetlands/ENEMIES.toml --run image-generation/enemy-sprites/runs/NEW_RUN
```

No discarded roster is restored. `--all-enemies` explicitly selects the current
catalog. The adapter reads `visual_description`, `visual.idle`, and
`visual.attack`, preserves the complete source definitions in provenance, and
supplies art defaults when the catalog has no shared art table.

## Review and export

Individual commands are `references`, `prepare`, `animate`, `export`, `review`,
and `package`; each takes `--run`. `animate --asset ID --action NAME` can resume
one planned animation. `selection.json` may select a different source, crop, or
horizontal mirror; that decision and the actual selected image provenance are
saved. Review orientation and equipment before the expensive animation stage.
`plan --guide-image PATH --guide-strength 0.6` uses a local image as an SDXL
img2img guide instead of generating the reference from noise. Its hash and
strength are saved. Lower strength preserves more of its structure; this is not
a pose-skeleton constraint or a guarantee of correct anatomy. The selected
source can also be an existing transparent PNG, skipping background inference.

All new runs export a static `reference` in addition to their requested motions.
Static-only assets skip animation model execution. One square union crop and
ground pivot cover the reference and every frame of every planned motion for
each asset. This keeps size and origin stable across animation states and
preserves aspect ratios. Export requires all planned masks for that asset;
`--action` selection applies to animation generation, not partial reframing.

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/sprite-pipeline/sprites.py export --run image-generation/player-sprites/runs/NEW_RUN --size 128 --frame-step 4
```

Resolution (16–256 square pixels) and frame stride (1–16) can be changed without
inference. Alternate settings produce separate `exports-SIZE-step-STRIDE/` and
review pages, preserving the original export. The current source recipe is 45
frames at 512×512 and 16 fps, with 4 Wan steps split across its high/low experts.
Stride 2 retains 22 loop poses over 2.75 seconds, or 23 one-shot poses over
2.812 seconds. Skipping frames preserves elapsed time; speed is a separate
runtime/preview choice. Looping clips use experimental same-first/last-image
conditioning and omit the final generated boundary frame. One-shot clips keep
the complete duration. Loop flags do not certify seamless motion.

`review.html` is an offline player with sharp integer-scaled previews and method
comparisons. Each `exports/ID/ACTION/nearest|pyxelate/` contains actual-size PNG
frames, an eight-column `spritesheet.png`, frame/timing/pivot JSON, and previews.
PNG alpha is authoritative; visible colors are ENDESGA32, alpha is binary, and
hidden RGB is zero. `comparison.png` uses integer nearest-neighbor enlargement.
`sprites.zip` bundles review assets, selected originals, reference cutouts,
scripts, settings and locks. Raw generated frames and expert logs stay in the
run. The ZIP is a delivery bundle; rerunning requires this repository layout,
the existing model weights and environment, not just the extracted ZIP.

## Scope and limitations

Characters and opaque isolated props fit this workflow. Effects can be described
and animated, but single-object tracking and binary alpha are poor matches for
detached sparks, translucent smoke, or soft glow. Full environments, seamless
tiles, autotiles, UI layout and multi-layer parallax need separate composition
and export adapters; they are not handled by the current subject/cutout pipeline.

The pipeline automates rendering and packaging, not art approval. The model can
ignore facing, alter weapons or anatomy, drift in shading, and miss recovery or
loop continuity. Background removal can retain attached cast shadows or lose
thin details. A shared palette does not establish consistent character design.
Fix the reference before generating more motions when its silhouette or equipment
is wrong. Runtime integration, hitboxes, equipment swapping and animation state
transitions remain game-side work.

## Validation

```bash
image-generation/sprite-animation/.venv/bin/python -m unittest discover -s image-generation/sprite-pipeline -p 'test_*.py' -v
image-generation/sprite-animation/.venv/bin/python -m unittest discover -s image-generation/enemy-sprites -p 'test_*.py' -v
```

These test art-only definitions, named loop/one-shot actions, static prop export,
canonical enemy resolution without shared art, rejected inputs, legacy-run
exports, timing, fixed crop/pivot, palette, alpha and alternate export preservation.
They use synthetic fixtures rather than depending on retired game content.
