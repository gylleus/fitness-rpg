# Hollow Delve actor-reference redraw

The preceding 1.5 px/unit export reached the phone correctly, but retained most
of the source illustration's appearance. Matching texture dimensions and limiting
colors did not by itself establish the same drawn pixel shapes as the actors.

This candidate redraw uses the shared planner's `--style-reference` option.
The original cave layers provide layout and material references; the actual
knight and delve dwarf sprite sheets provide the pixel-art style references.
All three backgrounds were edited with built-in imagegen. Exact generation
prompts, reference hashes and selected outputs are in `plan.json` and
`sources.json`. The wall and roof needed a second background-removal operation
to obtain actual alpha; the rejected opaque outputs and extraction prompts are
retained. The candidate keeps the existing floor and 32 props for comparison.

Open [the standalone candidate review](review/review.html) to inspect the layered
scene beside the real player at gameplay scale. This directory is a review
candidate; it does not replace installed runtime assets by itself.

```sh
uv run biome-assets prepare --plan image-generation/scene-samples/hollow-delve-actor-style-v8/plan.json --sources image-generation/scene-samples/hollow-delve-actor-style-v8/sources.json --out image-generation/scene-samples/hollow-delve-actor-style-v8/prepared
uv run biome-assets reexport --biome hollow_delve --out image-generation/scene-samples/hollow-delve-actor-style-v8/review
uv run biome-assets bundle --manifest image-generation/scene-samples/hollow-delve-actor-style-v8/prepared/manifest.json --mapping image-generation/scene-samples/hollow-delve-actor-style-v8/runtime.json --out image-generation/scene-samples/hollow-delve-actor-style-v8/review
node scripts/build-interior-review.cjs image-generation/scene-samples/hollow-delve-actor-style-v8/review
```

Browser checks cover all 32 decoration cards, three viewports, layer toggles,
travel, mobile overflow and offline loading. The supplied actor sprite files
remain unchanged.
