# Biome asset workflow

Start here for new biome art. Canonical `BIOME.toml`, `SCENERY.toml` and
`ENEMIES.toml` supply subjects and gameplay-independent art targets.
[style.toml](style.toml) supplies one shared visual hierarchy. Optional
[variant recipes](recipes/hollow_delve.toml) describe different panels of a
canonical background without copying generation code.

```sh
uv run biome-assets plan --biome wetlands --kind background --out /tmp/wetlands-plan.json
uv run biome-assets plan --biome hollow_delve --kind background --out /tmp/delve-plan.json
uv run biome-assets plan --biome wetlands --kind prop --asset wetlands_leaning_willow --out /tmp/willow-plan.json
uv run biome-assets plan --biome hollow_delve --kind enemy --out /tmp/delve-enemy-plan.json
```

Omit `--kind` to inventory all assets. The choices are `background`, `ground`,
`prop`, and `enemy`. Plans contain exact prompts, canonical definitions, source
hashes, the style profile, logical dimensions and alpha/export contracts.
Planning uses the lightweight root Python environment and runs no models.
Changed inputs require a new plan path; unchanged plans reproduce exactly.

## Prompt guidance

Use the saved `prompt` verbatim with the generation backend. Record any changed
prompt in a new plan before generating. Both biomes share these priorities:

| Asset | Detail and composition | Delivery |
| --- | --- | --- |
| Background | Low local contrast, broad value masses, sparse material marks. Quiet space behind the whole route, including logical rows 160–288. Distant structures lose detail. | Shared 640×360 canvas; opaque sky/cave panel or genuine alpha for separate layers. |
| Ground | Continuous, readable walking lip; sparse texture. Respect the common edge profile. | Authored canvas and surface row; transparent above the silhouette, opaque below. |
| Prop | Clear silhouette and a few material cues; stronger contrast than distant scenery. | Complete isolated cutout, padding, reviewed support anchor. |
| Enemy | Strongest silhouette clarity, stable anatomy, equipment and scale. | Reference first, then separated authored poses, shared crop/pivot, 128px ENDESGA32 export. |

Describe limestone, reeds or timber through large shapes and a few marks. Avoid
requests for intricate mineral ribs, pitting, dense grain, tiny highlights,
cracks everywhere or full-resolution texture preservation. A muted palette alone
does not control visual noise. Keep a cave dark but legible; avoid turning the
backdrop into uniformly black space. Review all panels at gameplay size with the
actual player and enemy silhouettes, including travel and crossfades.

Use image references with explicit roles: the approved player for sprite style,
the approved enemy for identity and motion, or a selected scene for background
style. Do not transfer a reference's unrelated anatomy or objects. Record the
reference image paths and hashes with each source. The built-in imagegen backend
does not expose reproducible seeds or model revisions; do not invent them.

For enemy plans, `prompt` generates the design reference and `sheet_prompt`
specifies six columns by four rows: idle, walk, attack, death. Canonical idle and
attack descriptions are retained. Walk/death phase guidance is shared; review
anatomy-specific movements before running the sheet generation. Existing Wetlands
eight-pose sheets remain supported by their extraction recipes.

## Prepare supplied static images

Generate the selected plan's images using the built-in imagegen tool, or another
explicitly chosen backend. Keep originals unchanged beside a source manifest:

```json
{
  "schema_version": 1,
  "plan_sha256": "SHA256_OF_PLAN_FILE",
  "assets": {
    "hollow_delve_landscape": {
      "image": "originals/landscape.png",
      "sha256": "SHA256_OF_SOURCE_PNG",
      "prompt_sha256": "COPY_FROM_PLAN_ASSET",
      "backend": "built-in imagegen",
      "references": []
    }
  }
}
```

Source and optional reference paths resolve relative to this manifest. A reference
entry has `image` and `sha256`. Cover exactly the assets selected in the plan;
make a smaller plan for a partial generation. Original tool output paths may be
recorded as extra provenance, but the actual source files must be in the project.

```sh
uv run biome-assets prepare --plan PATH/plan.json --sources PATH/sources.json --out PATH/prepared
```

This verifies all hashes, prompt identity, aspect ratio and alpha before writing.
It exports the logical canvas with nearest sampling, original colors, binary alpha
and zero hidden RGB. It does not paint detail away or certify artistic quality.
Opaque RGB cannot masquerade as a transparent cutout. Large aspect mismatches
fail instead of stretching or cropping the composition. Outputs include a manifest
and an offline review page. Changed inputs require a new output directory.

Logical scenery dimensions are shared across biomes; sprite palette mapping and
scene source colors serve different roles. Higher source resolution is preserved
for provenance, not automatically shipped as a more detailed runtime texture.

To use the local SDXL route for **opaque backgrounds**, translate the same prompts:

```sh
uv run biome-assets definition --plan /tmp/delve-plan.json --out /tmp/delve-definition.toml
uv run sprites all --definition /tmp/delve-definition.toml --run image-generation/sprite-pipeline/runs/delve-NEW
```

The existing local pipeline records its model/device/settings and exports its
ENDESGA32 variants. Transparent layers require supplied alpha art; the opaque
SDXL background adapter cannot generate separate transparent layers. Choose the
backend explicitly and review palette changes instead of silently mixing outputs.

## Import sprites and select runtime scenery

Authored enemy sources use the shared [sheet importer](../sprite-pipeline/AUTHORED_SHEETS.md):

```sh
uv run enemy-sprites import-sheets --recipe PATH/sheet-recipe.json --out PATH/imported
uv run sprites bundle
```

Select imported manifests in `image-generation/game-sprites.json` before bundling.
Ground contacts, airborne lift, timing, color keys and grids belong in recipes,
never biome-specific Python branches. The local SDXL/Wan path remains available
through the same enemy adapter and runtime bundler.

For prepared scenery, explicitly map asset IDs to runtime slots, for example
`{"hollow_delve_landscape": "landscape"}`. Then:

```sh
uv run biome-assets bundle --manifest PATH/prepared/manifest.json --mapping PATH/runtime.json
uv run biome-assets bundle-props --biome wetlands
npm run test:scenery
npm run test:sprites
```

`bundle` validates selected originals and exports and updates only the named slots
and their provenance. `bundle-props` delegates to the existing shared atlas packer;
use `--recipe-dir PATH` for a new reviewed prop-sheet recipe. It verifies authored
regions and ground anchors. Individual generated props can be supplied as 1×1 sheets
in that recipe. Waterline props require separate placement and are rejected by the
grounded atlas packer. Seam prompts are targets: inspect repeated art and measure
the actual visible ground surface before runtime integration.

```sh
uv run sprite-python -m unittest discover -s image-generation/biome-assets -p 'test_*.py'
uv run sprite-python -m unittest discover -s image-generation/sprite-pipeline -p 'test_*.py'
```

See [the pipeline audit](RESEARCH.md) for the causes of the previous divergence.
