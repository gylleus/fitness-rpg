# Wetlands expedition scenery

Five unchanged PNGs selected from `image-generation/scene-samples/wetlands-v1`.
`sources.json` records their original content IDs, paths, hashes and dimensions.
The rejected ground edits are excluded. Metro bundles these assets for offline use.

`src/scenes/WetlandsBackdrop.tsx` loads the images into one viewport-sized Skia
canvas and subscribes to the expedition's existing movement animation. It does
not start another clock. `WetlandsArtwork.tsx` draws sky, distant silhouettes
(0.15 camera speed), reed banks (0.35), willows and peat ground. Actors and hit
effects remain above the scenery. Shader sampling is nearest; horizontal mirror
tiling avoids discontinuities at the original images' unmatched edges. The last
soil row extends down to fill the viewport. Prop count depends on viewport width,
not dungeon length, and their world placement remains stable through encounters.

The authored scene is 640×360 with a 64px reference hero and a ground line at
288. `wetlands.ts` scales it with the runtime hero, positions the turf at the
existing character baseline, and compensates for the generated ground's actual
surface (source row 338 of 768; logical row 42.25). The distant layer is raised
32 logical pixels to separate the two generated horizons. The willow's visible
height is 1368 source pixels, scaled to 3.4 heroes; its trunk base is (432, 1410).
These are explicit v1 art adjustments, not new TOML authoring defaults.

New runs snapshot `biomeId`. Older Wetlands roster snapshots also select this
scene. Pre-snapshot Mossfall runs and other biomes retain their existing scenery.

Run `node scripts/check-scene-render.cjs` to render the production drawing nodes
and actual player/enemy sprites through Skia/CanvasKit, check source hashes,
viewport coverage and repeat continuity, and save compact, portrait, landscape
and small-phone previews under `/tmp/frpg-scene-render-audit`.

This is the first generated art pass: source images still contain soft alpha
edges and more detail than the authored pixel scale; mirrored repetition can
look symmetric. Palette cleanup, native-size exports and the other authored
ground sections/props remain part of the broader scene pipeline work.
