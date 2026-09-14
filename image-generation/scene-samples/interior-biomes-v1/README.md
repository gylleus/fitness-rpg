# Interior biome scenery, version 1

Open [the review index](index.html), or an individual portable HTML:

| Set | Shared theme | Review |
| --- | --- | --- |
| Lava caves | `volcano_tunnel` | [Lava caves](lava_caves/review/review.html) |
| Frost caves | `frost_cave` | [Frost caves](frost_caves/review/review.html) |
| Crypts | `crypt` | [Crypts](crypts/review/review.html) |
| Fortress | `castle` | [Fortress](fortress/review/review.html) |

Generated on 2026-09-14 using the built-in imagegen tool and the exact prompts
saved in each `plan.json`. These are new scenery sources, with no image inputs;
no seed or model revision was exposed. Each set includes an opaque depth layer,
transparent middle wall, transparent ceiling, walking floor and eight-prop sheet.
All 20 original outputs are retained under their set's `sources/` directory.

The source manifests record image hashes, prompt hashes, backend and original
tool output paths. `prepared/` contains shared exports and their manifests.
`review/` contains assembled textures, the runtime interior geometry, a grounded
prop atlas and a portable HTML file with all images and scripts embedded.
The existing knight is included only as a scale reference. The four sets now
also supply runtime scenery: Embercrypt travels from lava caves into crypts,
and Frostbound Keep travels from frost caves into the fortress. Their existing
enemy rosters and chapter progression are preserved. The standalone HTMLs and
assembled review textures now match the installed runtime's actor pixel profile.
The original high-resolution sources and saved generation plans are unchanged.

The shared actor pixel profile exports depth and wall at 960×540 pixels on
640×360 logical canvases, and ceilings at 960×360 on a 640×240 canvas. Floors
export to 384×144 on a 256×96 canvas with measured contact. Each decoration
exports at approximately 96 × height_scale visible pixels tall. This gives every
scenery category 1.5 pixels per game unit. Layer palettes use at most 48 colors;
floors and individual props use 32, without dithering.
Ceiling undersides are measured from alpha and stay at 104 logical units above
the floor for a 64-unit reference actor. Layer speeds are 0.10, 0.32 and 0.68.

All sets use the same planner, exporter, atlas packer and HTML builder. The
crypt sheet placed two objects beyond the nominal grid boundaries, so
`crypts/regions.json` records eight inspected extraction rectangles. The shared
packer still checks crop bounds, transparent padding and ground contacts; there
is no per-biome extraction code.

To plan a fresh version, choose the theme and ID from the table:

```sh
uv run biome-assets plan-interior --theme frost_cave --biome frost_caves --with-scenery --out NEW/plan.json
```

Generate its five saved prompts and record sources before preparing it. Replay
an existing set from the repository root with the saved plan and originals:

```sh
uv run biome-assets prepare --plan image-generation/scene-samples/interior-biomes-v1/frost_caves/plan.json --sources image-generation/scene-samples/interior-biomes-v1/frost_caves/sources.json --out image-generation/scene-samples/interior-biomes-v1/frost_caves/prepared
uv run biome-assets assemble-interior --plan image-generation/scene-samples/interior-biomes-v1/frost_caves/plan.json --manifest image-generation/scene-samples/interior-biomes-v1/frost_caves/prepared/manifest.json --out image-generation/scene-samples/interior-biomes-v1/frost_caves/review
```

Substitute the other IDs as needed. For crypts, also pass
`--regions image-generation/scene-samples/interior-biomes-v1/crypts/regions.json`
to the assembly command. Saved source preparation and packing are deterministic;
rebuilding HTML embeds the current repository's player sprite and layout code.
Saved v1 plans retain their original background export policy. After replaying
them, apply the current profile with `uv run biome-assets reexport --biome ID`,
then use `--out image-generation/scene-samples/interior-biomes-v1/ID/review` to
refresh the assembled review textures as well. Build a review directly from the
installed art with:

```sh
node scripts/build-interior-review.cjs assets/biomes/frost_caves image-generation/scene-samples/interior-biomes-v1/frost_caves/review/review.html
```

The index thumbnails are actual Canvas2D scene captures from browser validation.
The [six-biome pixel scale comparison](pixel-scale-comparison.html) embeds before
and after captures from the production Skia renderer.

Validation: 24 biome pipeline tests, six prop packer tests, source/export hash and
alpha checks for all four assemblies, and browser checks for four offline HTMLs.
The browser audit exercises 12 viewport combinations, all 20 scenery toggles,
travel scrubbing/playback, 32 decoration cards, mobile overflow and zero external
network requests or browser exceptions. Results are in [browser-audit.json](browser-audit.json).
The landscape and portrait scenes were also visually inspected. Native checks
passed 223 production Skia renders, 96 exact prop crops with density and palette
budgets, and 224 actor poses below the roofs. Scene logic and UI checks passed.

To repeat browser checks, start a local Chrome with remote debugging enabled
(for example, `--headless --remote-debugging-port=9223` and a separate
`--user-data-dir=/tmp/interior-review-browser`), then run:

```sh
node scripts/check-interior-reviews.cjs --port 9223 --out /tmp/interior-review-audit image-generation/scene-samples/interior-biomes-v1/{lava_caves,frost_caves,crypts,fortress}/review
```

The audit needs Node with global `fetch` and `WebSocket` (validated on Node 25)
and emits scene PNGs and a result JSON. Native Skia checks belong to subsequent
game integration; these HTMLs use Canvas2D with production layout calculations.
