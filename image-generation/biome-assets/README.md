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
| Background | Connected color clusters and stepped shading matching authored actors. Quiet space behind the whole route; distant structures lose contrast. | 640×360 game units export to 960×540 texture pixels; up to 48 colors per layer. Opaque depth or genuine alpha. |
| Ground | Continuous, readable walking lip; sparse texture. Respect the common edge profile. | 256×96 game units export to 384×144 pixels; 32 colors, measured surface row and binary alpha. |
| Prop | Clean silhouette, restrained dark contour and a few stepped material shades. | Visible height = 64 × height_scale × 1.5 pixels; 32 colors per cutout, reviewed support anchor. |
| Enemy | Strongest silhouette clarity, stable anatomy, equipment and scale. | Reference first, then separated authored poses, shared crop/pivot, 128px ENDESGA32 export. |

The player and authored enemies are the art reference. Their effective density
is roughly 1–1.9 source pixels per game unit. The shared `[pixels]` profile in
[style.toml](style.toml) targets **1.5 pixels per game unit** for every scenery
category: approximately 96 visible pixels for a 64-unit reference actor.
Attach the existing player and authored enemy sheets as style references when
generating new art, preserving the requested scenery subjects and biome colors.
Use `--style-reference assets/sprites/barbarian_player--idle.png
assets/sprites/delve_dwarf--idle.png` with `plan` or `plan-interior`. The planner
records the exact images and hashes, labels them separately from a layout edit
target, and adds a redraw brief. Attach the edit target first (if any), followed
by these actor images, to image generation. Source provenance must include every
planned style reference; preparation rejects missing or changed references.
Judge detail beside `barbarian_player`, `bog_toad` and `delve_dwarf` at gameplay
scale, rather than enlarging each isolated asset to fill a preview card.

Generation masters remain at full resolution. The common texture compiler uses
area reduction to remove fine surface noise, bounded adaptive palettes without
dithering, and hard alpha. Runtime uses nearest sampling. Adaptive palettes retain
the cave's browns, frost blues and volcanic accents without forcing every material
into the actor palette. Larger props receive more texture pixels because they
occupy more world space; an arbitrary maximum source edge no longer sets detail.
Keep distant contrast restrained and review travel, floor contact, roofs and
portrait/landscape layouts with actual actors.

To apply the current profile to installed art without another generation run:

```sh
uv run biome-assets reexport --biome wetlands
uv run biome-assets reexport --biome hollow_delve
uv run biome-assets reexport --biome lava_caves
```

This reads the immutable masters recorded in `assets/biomes/BIOME/sources.json`,
rebuilds layers and props, records the profile and source hashes, and remeasures
ground contact and roof anchors. It never resamples an earlier runtime export.
Use `--style PATH` for another shared profile or `--out PATH` for a candidate
export. The same command supports frost caves, crypts, fortress and future
registered interiors; no biome-specific processing code is needed.

Re-exporting changes the pixel grid and color budget, but preserves the source
illustration's forms and shading. It is not a substitute for a style redraw.
If scenery still looks painterly beside the actors, generate new source artwork
with the actor references, then apply the shared exporter. Review the actual
composite on a phone; texture dimensions alone do not prove a visible style match.

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

To restyle an approved layout, provide `--edit-from references.json` to `plan` or
`plan-interior`. This JSON maps each planned asset ID to its reference PNG path,
relative to the JSON file. Keep reference copies immutable inside the repository.
The planner adds explicit edit instructions and reference hashes; use each saved
prompt with its referenced image. Preparation requires matching reference
provenance. This works for changing an existing palette or applying another
interior theme. Hollow Delve's earth-brown revision demonstrates the workflow.

Texture pixels and world coordinates are separate. A 2048×768 roof master exports
to 960×360 pixels and occupies a 640×240 logical rectangle. Preparation measures
its lowest opaque pixel and writes
`origin_y`, so runtime anchors the actual underside a configured distance above
the ground. The default clearance is 104 units for a 64-unit actor. It stays
relative to actors when the viewport changes; tall screens fill upward with the
roof's opaque upper edge. Grounded props remain beneath the roof drawing layer.
If extraction clears the dark band above the roof, preparation measures its first
fully opaque horizontal cross-section as `cap_y`. The renderer joins that row to
the scene's solid fill above, keeping the ceiling continuous without repainting
the texture. A roof with no opaque cross-section or no empty air beneath fails.

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

## Complete scenery sets and portable reviews

Add `--with-scenery` to plan a floor and eight decorations alongside the three
interior layers. [decorations.toml](decorations.toml) defines materials, subjects
and actor-relative sizes for volcanic tunnels, frost caves, crypts and castles.
Pass `--decorations PATH` to supply another decoration recipe. The same theme key
must exist in both the interior and decoration recipes.

```sh
uv run biome-assets plan-interior --theme volcano_tunnel --biome lava_caves --with-scenery --out PATH/plan.json
# Generate the five saved prompts and record their images in PATH/sources.json.
uv run biome-assets prepare --plan PATH/plan.json --sources PATH/sources.json --out PATH/prepared
uv run biome-assets assemble-interior --plan PATH/plan.json --manifest PATH/prepared/manifest.json --out PATH/review
```

The decoration prompt specifies a four-column, two-row transparent sheet. Its
source resolution survives preparation; the shared prop packer trims each object,
compiles it at its actor-relative pixel height, checks anchors and packs one atlas.
Definitions stay in the saved plan
and generated extraction recipe, so a review needs no placeholder playable
content in `SCENERY.toml`. If an object crosses a cell boundary, inspect the sheet
and pass `assemble-interior --regions PATH/regions.json`: a mapping from prop IDs
to `[left, top, right, bottom]` source-pixel rectangles. The normal bounds, padding
and contact checks still apply. Preserve that correction as data beside the plan.

`PATH/review/review.html` embeds the textures, existing knight sprite and scripts.
It works offline as one file, with travel playback, layer toggles, three viewport
sizes, a decoration gallery and downloadable textures. Its Canvas2D renderer uses
the production interior layout, scenery placement and sprite geometry; native
Skia rendering still needs its own checks when integrating a new playable biome.
Run `node scripts/build-interior-review.cjs PATH/review` to rebuild just the HTML.
Pass a second path to save the HTML elsewhere, including when building directly
from `assets/biomes/LOCATION`. For a before/after review of actual Skia captures,
run `node scripts/build-scene-comparison.cjs BEFORE_AUDIT AFTER_AUDIT OUT.html`.
[review-scenes.json](review-scenes.json) selects the representative scenes.

The [four generated examples](../scene-samples/interior-biomes-v1/index.html)
retain all 20 original images, exact prompts, export manifests and reviewed
extraction regions. Their [generation record](../scene-samples/interior-biomes-v1/README.md)
includes replay and browser-validation commands.

### Publish a reviewed set into the game

The review directory is an art deliverable. Install its textures and prop atlas
into the runtime asset directory before registering it with a playable chapter:

```sh
uv run biome-assets bundle --manifest PATH/prepared/manifest.json --mapping PATH/review/runtime-mapping.json --out assets/biomes/LOCATION
uv run biome-assets bundle-props --biome LOCATION --recipe-dir PATH/review/prop-recipe --out assets/biomes/LOCATION
```

Register the exported geometry in `src/scenes/interiorLocations.ts` and static
PNG imports in `InteriorLocationBackdrop.tsx`; Metro requires those imports to
be statically discoverable. Add chapter sections to `interiorRoutes.ts`.
Each section gives its starting encounter and location ID. Legacy chapter IDs
resolve older snapshots without changing saved enemies, balance or progress.
Explicit biome IDs take precedence, so future content is not repainted by ID.

Embercrypt uses lava caves for its first two encounters and crypts for its last
two. Frostbound Keep similarly moves from frost caves into the fortress. The
same `InteriorBackdrop` draws all sections, including Hollow Delve. A finishing
swing remains in its current room; the next section appears when travel starts.

For a development build on a phone, open
`fitnessrpg://scenery-review?dungeon=1&encounter=0`. The native preview uses the
real chapter routing and `DungeonJourney`, and never starts or advances a saved
run. Its controls inspect both chapter sections; it is disabled in release
builds. Run `npm run test:scenery` for texture/source hashes, actual Skia rendering,
ground contact, roof clearance and independent layer repetition across all sets.

After building a release APK, verify the delivery artifact before installing it:

```sh
uv run sprite-python scripts/check_android_biomes.py --aapt2 "$ANDROID_HOME/build-tools/36.0.0/aapt2"
```

This checks every runtime biome's actual packaged pixels through Android's
resource table, the compiled bundle, and the chapter routing source map. It
catches a review-only export, unregistered textures and a build from the wrong
checkout. Install the verified APK with `adb -s ENDPOINT install -r
android/app/build/outputs/apk/release/app-release.apk` to preserve existing saves.

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
New plans embed `resolution = world` and the complete pixel profile for layers,
ground and individual props. Decoration sheets retain source resolution until
each cutout is packed at its own world height. Binary alpha and zero hidden RGB
are enforced. Old saved plans retain their original source/logical export for
reproducibility; use `reexport` to deliberately apply the current style to their
installed assets. Export checks do not certify artistic quality.
Opaque RGB cannot masquerade as a transparent cutout. Large aspect mismatches
fail instead of stretching or cropping the composition. Outputs include a manifest
and an offline review page. Changed inputs require a new output directory.

Logical scenery dimensions are shared across biomes. Texture resolution does not
change character, ground or ceiling scale.
Ground preparation also measures the exported walking contact row and carries
`surface_y` and logical `canvas` into the runtime source manifest.

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
