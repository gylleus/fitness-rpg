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
The existing knight is included only as a scale reference. These four scenery
sets have not been registered as playable chapters or given new enemy rosters.

Background texture pixels are independent of world scale: depth and wall retain
1672×941 source images on 640×360 logical canvases; ceilings retain 2048×768 pixels
on a 640×240 logical canvas. Source floors are 2048×768 (lava: 2046×768) and use
the common 256×96 ground export with measured contact. Each 1774×887 decoration
sheet becomes an atlas of eight trimmed cutouts with a maximum edge of 240px.
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
The index thumbnails are actual Canvas2D scene captures from browser validation.

Validation: 18 biome pipeline tests, six prop packer tests, source/export hash and
alpha checks for all four assemblies, and browser checks for four offline HTMLs.
The browser audit exercises 12 viewport combinations, all 20 scenery toggles,
travel scrubbing/playback, 32 decoration cards, mobile overflow and zero external
network requests or browser exceptions. Results are in [browser-audit.json](browser-audit.json).
The landscape and portrait scenes were also visually inspected.

To repeat browser checks, start a local Chrome with remote debugging enabled
(for example, `--headless --remote-debugging-port=9223` and a separate
`--user-data-dir=/tmp/interior-review-browser`), then run:

```sh
node scripts/check-interior-reviews.cjs --port 9223 --out /tmp/interior-review-audit image-generation/scene-samples/interior-biomes-v1/{lava_caves,frost_caves,crypts,fortress}/review
```

The audit needs Node with global `fetch` and `WebSocket` (validated on Node 25)
and emits scene PNGs and a result JSON. Native Skia checks belong to subsequent
game integration; these HTMLs use Canvas2D with production layout calculations.
