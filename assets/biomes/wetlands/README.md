# Wetlands expedition scenery

Five bundled textures: the existing sky, distant silhouettes, reed banks and
peat ground from `image-generation/scene-samples/wetlands-v1`, plus one atlas of
32 generated ground props. `sources.json` records paths, hashes and dimensions;
`props.json` records rectangles, measured support anchors, canonical height
scales and exact pixel hashes. Metro bundles the runtime PNGs for offline use.

`src/scenes/WetlandsBackdrop.tsx` loads the images into one viewport-sized Skia
canvas and subscribes to the expedition's existing movement animation. It does
not start another clock. `WetlandsArtwork.tsx` draws sky, distant silhouettes
(0.15 camera speed), reed banks (0.35), props and peat ground. Actors and hit
effects remain above the scenery. Shader sampling is nearest; horizontal mirror
tiling avoids discontinuities at the original images' unmatched edges. The last
soil row extends down to fill the viewport. Prop count depends on viewport width,
not dungeon length, and their world placement remains stable through encounters.

The authored scene is 640×360 with a 64px reference hero and a ground line at
288. `wetlands.ts` scales it with the runtime hero, positions the turf at the
existing character baseline, and compensates for the generated ground's actual
surface (source row 338 of 768; logical row 42.25). The distant layer is raised
32 logical pixels to separate the two generated horizons.
These are explicit v1 art adjustments, not new TOML authoring defaults.

New runs snapshot `biomeId`. Older Wetlands roster snapshots also select this
scene. Pre-snapshot Mossfall runs and other biomes retain their existing scenery.

The new 2048×866 atlas replaces the individual willow and includes trees,
cottages, reeds, tools, peat workings and marsh debris. All 32 cutouts have
trimmed alpha padding and a measured visible base. They share one texture decode
and one Skia Atlas draw, culled to the viewport. A stable expedition seed varies
the arrangement without advancing combat randomness. Each library cycle spans
4608 world units; a normal run shows a subset. Three authored waterline concepts
remain reserved for pool placement. See the
[inventory, exact prompts and rebuild recipes](../../../image-generation/scene-samples/biome-props-v2/README.md).

```sh
uv run sprite-python scripts/bundle_scenery.py --biome wetlands
npm run test:scenery
```

Run `node scripts/check-scene-render.cjs` to render the production drawing nodes
and actual player/enemy sprites through Skia/CanvasKit, check source hashes,
exact prop crops, visible ground contact, coverage and repeat continuity, and save compact, portrait, landscape
and small-phone previews under `/tmp/frpg-scene-render-audit`.

The original backgrounds and ground retain their v1 art; mirrored repetition
can still look symmetric. The prop atlas uses binary alpha and nearest sampling.
