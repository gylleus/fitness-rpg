# Hollow Delve scenery

Five bundled textures: three subdued cave backgrounds, a walking surface and
one atlas containing 32 isolated props. `sources.json` records source paths,
checksums and dimensions. `props.json` adds named rectangles, measured support
anchors, canonical height scales and exact cutout pixel hashes.

| Asset | Use |
| --- | --- |
| landscape | Natural limestone chambers at the entrance |
| timber_gallery | Abandoned workings after the first two encounters |
| sunken_cavern | Deep pool chamber near the dwarf and gnoll |
| slate_path | Continuous mirrored slate-and-gravel walking surface |
| props | 32 cave props: supports, arches, carts, crystals, fungi, bones, tools, machinery and ruins |

The backgrounds use low-detail built-in imagegen
[panoramas](../../../image-generation/scene-samples/hollow-delve-backgrounds-v5/),
exported at the shared 640×360 logical canvas with nearest sampling and source
colors. Broad rock masses and quiet shadowed recesses keep combatants readable.
They pan slowly inside their painted bounds and crossfade during travel; they
are not tiled. Props use the new trimmed 2048×882 atlas; the original ground
retains its ENDESGA32 export. Exact prop prompts, source images and recipes are
in [biome-props-v2](../../../image-generation/scene-samples/biome-props-v2/README.md).

The generated ground's measured surface is row 36 in its 256×96 export. Runtime
layout uses this measured row rather than the requested row 24. Trimmed prop
bases align to the same baseline as combat sprites. The renderer decodes one
prop texture and draws only visible rectangles with one Skia Atlas. A stable
expedition seed shuffles the library without advancing combat randomness.
The library repeats every 4608 world units; an ordinary run shows a subset.
Pause, restored checkpoints and resizing preserve the arrangement.

```bash
uv run biome-assets bundle-props --biome hollow_delve
uv run biome-assets bundle --manifest image-generation/scene-samples/hollow-delve-backgrounds-v5/prepared/manifest.json --mapping image-generation/scene-samples/hollow-delve-backgrounds-v5/runtime.json
npm run test:scenery
```

The historical `hollow-delve-props-v1/prepare.py` and
`hollow-delve-backgrounds-v4/prepare.py` reproduce old packages and must not be
used to build current runtime art. Their original sources remain archived.

The scenery audit renders production Skia artwork with every cave enemy at
four viewport sizes, checks source hashes, exact atlas crops, visible support
pixels, opaque coverage and ground repetition. Rendered previews are written to
`/tmp/frpg-scene-render-audit/`.
