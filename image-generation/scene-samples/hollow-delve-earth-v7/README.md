# Hollow Delve earthy cave v7

The reviewed tunnel layout is restyled with brown limestone, umber shadows,
rounded rock shelves and much sparser pointed formations. The walking floor
shares the warm palette. This revision uses the common `--edit-from` planner,
preparer and runtime bundler; there is no biome-specific processing script.

`plan.json` and `ground-plan.json` hold the exact imagegen edit prompts and
immutable reference hashes. `sources.json` and `ground-sources.json` retain
original tool images, selected alpha extractions and their exact prompts.
Opaque checkerboard attempts were rejected. Selected cutouts have genuine alpha;
the shared exporter applies binary alpha and clears hidden RGB. The roof's first
fully opaque cross-section supplies its solid upper cap in the renderer.

```sh
uv run biome-assets prepare --plan image-generation/scene-samples/hollow-delve-earth-v7/plan.json --sources image-generation/scene-samples/hollow-delve-earth-v7/sources.json --out image-generation/scene-samples/hollow-delve-earth-v7/prepared
uv run biome-assets prepare --plan image-generation/scene-samples/hollow-delve-earth-v7/ground-plan.json --sources image-generation/scene-samples/hollow-delve-earth-v7/ground-sources.json --out image-generation/scene-samples/hollow-delve-earth-v7/ground-prepared
uv run biome-assets bundle --manifest image-generation/scene-samples/hollow-delve-earth-v7/prepared/manifest.json --mapping image-generation/scene-samples/hollow-delve-earth-v7/runtime.json
uv run biome-assets bundle --manifest image-generation/scene-samples/hollow-delve-earth-v7/ground-prepared/manifest.json --mapping image-generation/scene-samples/hollow-delve-earth-v7/ground-runtime.json
```

The floor edit was planned with a 36/96 target contact row; preparation records
the actual exported contact. Future canonical ground plans retain the standard
24/96 target so they cover the full logical area below the scene baseline.

Validation: 17 Python pipeline tests, TypeScript, 13 focused logic tests, two
native UI tests, and 115 production Skia renders. All 224 player/enemy poses
clear the lowest ceiling edge. Brown portrait/landscape scenes were inspected
beside Wetlands; the unchanged props and characters still use the same baseline.
