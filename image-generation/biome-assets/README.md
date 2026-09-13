# Biome asset workflow

Start here for new biome art. Canonical `BIOME.toml`, `SCENERY.toml` and
`ENEMIES.toml` supply subjects and gameplay-independent art targets.
[style.toml](style.toml) supplies one shared visual hierarchy. Optional
[biome recipes](recipes/hollow_delve.toml) select a shared interior theme or
describe variants without copying generation code.

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
| Background | Low local contrast, grouped values, readable medium material texture comparable to Wetlands. Quiet space behind the whole route. Distant structures lose contrast. | Logical canvas usually 640×360; full source texture at least 1536px wide; opaque depth or genuine alpha for separate layers. |
| Ground | Continuous, readable walking lip; sparse texture. Respect the common edge profile. | Authored canvas and surface row; transparent above the silhouette, opaque below. |
| Prop | Clear silhouette and a few material cues; stronger contrast than distant scenery. | Complete isolated cutout, padding, reviewed support anchor. |
| Enemy | Strongest silhouette clarity, stable anatomy, equipment and scale. | Reference first, then separated authored poses, shared crop/pivot, 128px ENDESGA32 export. |

Describe limestone, reeds or timber through readable forms and controlled texture.
Preserve fine pixel edges and source resolution; reducing a texture to its logical
canvas makes it coarser than Wetlands. Control distraction through lighting and
local contrast instead. Avoid dense bright cracks, uniformly intricate surfaces,
chunky simulated pixel grids and featureless polygons. Keep a cave dark but
legible. Review all layers together at gameplay size with actual player and enemy
silhouettes, including long travel and portrait/landscape changes.

## Enclosed locations

[interiors.toml](interiors.toml) defines a shared layer contract and five material
presets: `limestone_tunnel`, `frost_cave`, `volcano_tunnel`, `crypt`, and `castle`.
Hollow Delve's canonical background command selects `limestone_tunnel` automatically.
Plan another location without creating content or a new Python script:

```sh
uv run biome-assets plan-interior --theme frost_cave --biome frozen_passage --out PATH/plan.json
```

Generate each planned layer, then use the same `prepare` and `bundle` commands
below. The defaults are an opaque recess at 0.10 travel speed, a transparent wall
at 0.32, and a transparent overhead roof at 0.68. The floor and prop atlas retain
their shared placement. Roofs attach to the top edge and leave real transparent
air below; a painted checkerboard is a failed generation. If extraction needs a
separate imagegen edit, keep both images and record that exact edit prompt and
input hash in source provenance, alongside the original generation prompt.

Texture pixels and world coordinates are separate. A 2048×768 roof occupies a
640×240 logical rectangle. Preparation measures its lowest opaque pixel and writes
`origin_y`, so runtime anchors the actual underside a configured distance above
the ground. The default clearance is 104 units for a 64-unit actor. It stays
relative to actors when the viewport changes; tall screens fill upward with the
roof's opaque upper edge. Grounded props remain beneath the roof drawing layer.

For a different architecture, copy the shared TOML, add a material theme and pass
`--recipe PATH`. Optional `[themes.NAME.scene]` overrides allow a higher vaulted
crypt or lower ice passage. Layers, logical sizes, speed and anchors are recipe
data; names are not hardcoded in the renderer. Use `role = "rear"` or `"ceiling"`,
with `origin_y = "alpha_bottom"` on a ceiling. Keep clearance at least 1.4 times
the reference height, and visually check the actual roster and attacks. Mirrored
horizontal repetition needs an in-context seam review.

`prepare` includes an offline travel slider and layer toggles in `review.html`.
`bundle` writes `interior.json` with runtime image slots. Register those statically
required PNGs, a ground canvas/surface anchor and a prop atlas with the shared
`InteriorBackdrop`. Hollow Delve is the example adapter; no new layout or animation
implementation is needed for another indoor biome. Adding playable content and
registering a biome in the game remain separate steps.

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
    "frozen_passage_depth": {
      "image": "sources/depth.png",
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
make a smaller plan for a partial generation. Interior plans and bundles must
include their complete layer set. Original tool output paths may be
recorded as extra provenance, but the actual source files must be in the project.

```sh
uv run biome-assets prepare --plan PATH/plan.json --sources PATH/sources.json --out PATH/prepared
```

This verifies all hashes, prompt identity, aspect ratio and alpha before writing.
It exports the plan's `resolution` (`source` for new backgrounds, `logical` for
ground/props), with original colors, binary alpha and zero hidden RGB. Old saved
plans without `resolution` retain logical export for reproducibility. It does not
paint detail away or certify artistic quality.
Opaque RGB cannot masquerade as a transparent cutout. Large aspect mismatches
fail instead of stretching or cropping the composition. Outputs include a manifest
and an offline review page. Changed inputs require a new output directory.

Logical scenery dimensions are shared across biomes; sprite palette mapping and
scene source colors serve different roles. Texture resolution does not change the
character, ground or ceiling scale.

To use the local SDXL route for **opaque backgrounds**, translate the same prompts:

```sh
uv run biome-assets plan --biome wetlands --kind background --asset wetlands_sky --out /tmp/sky-plan.json
uv run biome-assets definition --plan /tmp/sky-plan.json --out /tmp/sky-definition.toml
uv run sprites all --definition /tmp/sky-definition.toml --run image-generation/sprite-pipeline/runs/sky-NEW
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
`{"frozen_passage_depth": "depth", "frozen_passage_wall": "wall", "frozen_passage_roof": "roof"}`. Then:

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
