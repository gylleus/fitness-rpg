# Design references first, animate selected designs later

Run from the repository root using [uv](../PYTHON.md):

```bash
uv sync --locked
```

## Player: iterate on the reference

The existing player definition contains appearance and named animations. This
command plans the recipe, generates a still, prepares the pixel reference, and
stops. It does **not** run Wan, track animation frames, or require completed
animations to show the design.

```bash
uv run sprites reference \
  --definition image-generation/player-sprites/barbarian.toml \
  --run image-generation/sprite-pipeline/runs/player-design-v1 \
  --seed 91004
```

Open `RUN/reference-review.html`. Each `RUN/references/ASSET_ID/` contains:

| File | Purpose |
| --- | --- |
| `pixel-reference.png` | Native pixel design to inspect, copy, or edit. Generated isolated references are 128×128. |
| `pixel-reference.json` | Portable reference metadata with image hashes, facing and pivot. |
| `reference-cutout.png` | Exact 512×512 transparent animation input for isolated sprites. |
| `reference.png` | Exact input composited on the animation model's plain background. |

To try another design, change the definition, caption, seed or img2img guide and
use a new `--run .../player-design-v2` to keep the previous design. To replace it
in place, add `--force` to the same command. For the current club barbarian:

```bash
uv run sprites reference \
  --definition content/players/PLAYER.toml \
  --run image-generation/sprite-pipeline/runs/barbarian-club-v1 \
  --force
```

Without `--force`, unchanged inputs resume completed work; changed inputs are
rejected. `--force` validates the new plan and snapshots supplied pixel inputs,
then replaces **everything inside the selected run**, including animations,
exports and review pages. It works with `plan`, `reference`, and `all`, and
requires an explicit run and definition/roster. `reference --force` still stops
after the reference stage. Unrelated directories and symlinked run directories
are rejected. Keep recipes, reference images and guides outside the run being
replaced; inputs inside it are rejected before cleanup. Existing runs are not
modified if validation or input staging fails.

Force does not randomize the seed. Change `--seed` for a different variation with
the same recipe. `--guide-image PATH --guide-strength 0.6` influences
SDXL generation; it is different from supplying a finished `--reference`.

The reference command retains the definition's action descriptions in the run
plan, but does not generate them. `references` (raw SDXL image) and `prepare`
(pixel reference and review page) remain available as individual stages.

## Animate a selected reference

The club barbarian also has a supplied, right-facing, clean-shaven candidate at
[`player-sprites/references/barbarian-club-profile-v1/`](../player-sprites/references/barbarian-club-profile-v1/).
Its [source image and exact prompt](../player-sprites/guides/barbarian-club-profile-v1.json)
record built-in imagegen provenance. Normal CPU background removal and pixel
preparation produced the bundled transparent reference. This is a candidate,
including provisional clothing, not a change to the approved written design.
To use its pixels without another SDXL redraw:

```bash
uv run sprites reference \
  --definition content/players/PLAYER.toml \
  --reference image-generation/player-sprites/references/barbarian-club-profile-v1/pixel-reference.json \
  --run image-generation/sprite-pipeline/runs/barbarian-selected-v1
```

This copies and verifies the supplied reference and builds a review page. It
does not run SDXL or animate it. Continue with the workflow below when selecting
an animation run. For new local SDXL designs, the player's `[assets.reference]`
table supplies exact short positive/negative prompts; it does not enforce pose.

Start an independent animation run with the same definition and the selected
reference artifact:

```bash
uv run sprites plan \
  --definition image-generation/player-sprites/barbarian.toml \
  --reference image-generation/sprite-pipeline/runs/player-design-v1/references/barbarian_player/pixel-reference.json \
  --run image-generation/sprite-pipeline/runs/player-motion-v1 \
  --actions idle attack

uv run sprites all \
  --run image-generation/sprite-pipeline/runs/player-motion-v1
```

The new plan copies the selected pixels into its own `inputs/` directory.
`all` skips SDXL for supplied references, prepares the saved input, animates,
exports, builds the viewer and packages the run. Moving or deleting the design
run after planning does not change the animation run. A bundled reference keeps
the exact conditioning pixels and ground pivot, avoiding another crop or palette
conversion. Copy the whole asset reference directory when moving an artifact.

You can instead continue directly in the design run with `animate --run RUN`,
then `export`, `review`, and `package`. To change motion descriptions or seeds,
plan a new animation run using the same reference. Use
`animate --run RUN --asset barbarian_player --action attack` to generate one
planned action. Final sprite export waits for all planned actions for that asset
so the crop and pivot can be shared across them.

## Animate a pixel reference you made

Pass your own PNG instead of a reference JSON:

```bash
uv run sprites plan \
  --definition image-generation/player-sprites/barbarian.toml \
  --reference /absolute/path/to/my-player.png \
  --run image-generation/sprite-pipeline/runs/my-player-motion

uv run sprites all \
  --run image-generation/sprite-pipeline/runs/my-player-motion
```

The PNG is treated as finished pixel art: its file bytes are preserved in
`pixel-reference.png`, and preparation does not segment, recolor or redraw it.
Use transparency around an isolated subject; an opaque PNG retains its entire
rectangle. The animation conditioning copy is enlarged by an integer factor
and centered on a 512px canvas, with space for motion where possible. Sprite
inputs may be up to 512px per side; 64px or 128px designs leave useful clearance.
Match the definition's facing (or `--facing`) to the image. Bundled references
reject conflicting facing settings.

Animation frames and final atlas variants still use ENDESGA32. Importing a PNG
does not guarantee the video model will preserve every pixel or follow every
motion instruction. Edit a **copy** of a published PNG and plan a new run from
that PNG; changing files inside a completed run fails provenance checks.

For a batch, `--reference-inputs inputs.json` accepts an ID-to-path mapping:

```json
{
  "barbarian_player": "designs/player/pixel-reference.json",
  "campfire": "drawings/campfire.png"
}
```

Paths are relative to the mapping file. Each ID must belong to the selected
definition/roster. Assets omitted from the mapping use normal reference
generation. `--reference` requires exactly one selected asset; `--asset ID`
selects it from a larger definition. An imported reference cannot also use an
img2img guide for the same asset.

## Campfire and other props

Use [examples/campfire.toml](examples/campfire.toml) with either workflow above.
Its `kind = "prop"` needs no enemy stats or biome. Its `burn` animation loops;
action names are data, so no renderer change is needed to add `extinguish` or
another motion. Omit animations for a static prop.

```bash
uv run sprites reference \
  --definition image-generation/sprite-pipeline/examples/campfire.toml \
  --run image-generation/sprite-pipeline/runs/campfire-design-v1
```

This example uses a flame attached to the logs. Detached sparks, drifting smoke
and translucent glow remain limitations of the single-subject tracker and
binary-alpha exporter. The example is an art recipe, not curated game content.

## Static backgrounds

[examples/background.toml](examples/background.toml) uses `kind = "background"`
and `canvas = [320, 180]`. It has no animations.

```bash
uv run sprites reference \
  --definition image-generation/sprite-pipeline/examples/background.toml \
  --run image-generation/sprite-pipeline/runs/background-design-v1

uv run sprites all \
  --run image-generation/sprite-pipeline/runs/background-design-v1
```

The first command stops at the pixel reference. The second reuses it and exports
the static image, viewer and ZIP; no animation model runs. `all` can also start
from a definition in a new run if you want a single command. A supplied opaque
PNG via `--reference` bypasses SDXL here too.

Background prompts describe a full scene. SDXL uses a matching rectangular
generation canvas. Preparation and export preserve the full scene and aspect
ratio, with matte padding if source/target ratios differ. There is no automatic
foreground extraction, square subject crop or ground pivot. Outputs are opaque
ENDESGA32 PNGs at the definition's `canvas` dimensions (16–1024 per side, up to
4:1 aspect ratio), including a one-frame sheet for tooling compatibility.
`--size` controls isolated sprite exports; background dimensions come from
`canvas`. Change the canvas in a new definition/run to change background size.

This supports static scene images. Seamless tiling, separate parallax layers,
animated backgrounds and runtime integration are separate capabilities.

## Enemies use the same reference boundary

Use the shared CLI with the canonical roster instead of an art definition:

```bash
uv run sprites reference \
  --roster content/biomes/wetlands/ENEMIES.toml --asset bog_toad \
  --run image-generation/sprite-pipeline/runs/toad-design-v1

uv run sprites plan \
  --roster content/biomes/wetlands/ENEMIES.toml --asset bog_toad \
  --reference image-generation/sprite-pipeline/runs/toad-design-v1/references/bog_toad/pixel-reference.json \
  --run image-generation/sprite-pipeline/runs/toad-motion-v1

uv run sprites all \
  --run image-generation/sprite-pipeline/runs/toad-motion-v1
```

`enemy-sprites/batch.py` accepts the same commands and reference options.
Canonical appearance and motion prose remain in the plan's provenance.
