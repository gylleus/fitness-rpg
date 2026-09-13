# Hollow Delve scenery

Twelve bundled pixel-art images: three cave backgrounds, a walking surface and
eight isolated decorations. `sources.json` records the source paths, checksums,
export dimensions and measured bounds used by the game.

| Asset | Use |
| --- | --- |
| landscape | Natural limestone chambers at the entrance |
| timber_gallery | Abandoned workings after the first two encounters |
| sunken_cavern | Deep pool chamber near the dwarf and gnoll |
| slate_path | Continuous mirrored slate-and-gravel walking surface |
| mine_support | Buckled timber portal |
| webbed_arch | Broken limestone arch with old silk |
| ore_cart | Derailed rusty cart |
| quartz_cluster | Clouded mineral cluster |
| fungus_stump | Pale shelf fungus on damp pit timber |
| bone_heap | Dry humanoid skull and loose bones |
| stalagmites | Group of three limestone formations |
| tool_cache | Broken crate, pick, rope and unlit lamp |

The backgrounds use detailed 1672×941 built-in imagegen
[panoramas](../../../image-generation/scene-samples/hollow-delve-backgrounds-v4/),
preserving the complete source pixels and colors.
They pan slowly inside their painted bounds and crossfade during travel; they
are not tiled. Props and ground were generated with built-in imagegen and
converted through the existing ENDESGA32 pipeline. Exact prompts and immutable
originals are in
[hollow-delve-props-v1](../../../image-generation/scene-samples/hollow-delve-props-v1/).

The generated ground's measured surface is row 36 in its 256×96 export. Runtime
layout uses this measured row rather than the requested row 24. Prop bounds
align their feet to the same baseline as the combat sprites. All eight props
appear along the route; bounded repetition keeps restored long runs inexpensive.

```bash
uv run sprite-python image-generation/scene-samples/hollow-delve-props-v1/prepare.py
uv run sprite-python image-generation/scene-samples/hollow-delve-backgrounds-v4/prepare.py
npm run test:scenery
```

The scenery audit renders the production Skia artwork with every new enemy at
four viewport sizes, checks source hashes and opaque coverage, and verifies
exact ground/prop repetition. Rendered previews are written to
`/tmp/frpg-scene-render-audit/`.
