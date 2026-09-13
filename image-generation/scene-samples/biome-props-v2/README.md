# Grounded biome prop libraries

Built-in imagegen produced four transparent sheets, each containing 16 distinct
props. All 64 selected props are bundled into playable Wetlands and Hollow Delve
scenes. Each biome folder retains both original sheets, exact `.prompt.txt`
files, `sources.json` with prompts and hashes, a reviewed extraction `recipe.json`,
`audit.json` with size measurements, and a `contact-review.png` contact sheet.
Canonical descriptions and height scales live in each biome's `SCENERY.toml`.

Final game assets:

- [Hollow Delve props.png](../../../assets/biomes/hollow_delve/props.png) and adjacent `props.json`.
- [Wetlands props.png](../../../assets/biomes/wetlands/props.png) and adjacent `props.json`.
- Exact prompts: [Hollow Delve sources](hollow_delve/sources.json), [Wetlands sources](wetlands/sources.json).

## Rebuild and validate

```sh
uv run sprite-python scripts/bundle_scenery.py --biome hollow_delve
uv run sprite-python scripts/bundle_scenery.py --biome wetlands
uv run sprite-python -m unittest discover -s scripts -p test_scenery_atlas.py
uv run content
npm run test:scenery
```

The builder verifies source hashes and canonical ground anchors. Reviewed source
rectangles account for objects crossing nominal grid lines. Alpha is thresholded
at 128, tiny detached specks are removed, and empty margins are cropped before
and after nearest reduction to a maximum edge of 240 pixels. No shape is stretched.
The bottom visible row supplies the support anchor; hidden RGB is zeroed.
Significant separate parts remain intact.

Height-sorted shelves use transparent gutters and the actual required atlas
height. Hollow Delve is 2048×882 (2,517,117 PNG bytes; 7,225,344 decoded RGBA bytes).
Wetlands is 2048×866 (2,236,057 PNG bytes; 7,094,272 decoded RGBA bytes).
Packing gives one prop texture decode per biome and avoids per-prop image files.
The combined PNG is slightly larger than separate trimmed PNGs; savings come
from trimming and reduced texture overhead, not guaranteed PNG compression.

The scene audit verifies all 64 Skia-decoded rectangles against prepared RGBA
hashes, checks top/bottom visible rows and matching anchors, and renders 40
scene/repetition samples. Unit tests exercise padding and detached specks,
hidden RGB, downsampling, gutters, culling and stable placement.

## Adding props

Add a canonical ground-anchored entry in `SCENERY.toml`, generate another sheet
with explicit separated cells, and record its original PNG, exact prompt and
SHA256 in the recipe. Assign every cell its canonical ID and review extraction
regions so no edge cuts through an object. Run the builder, inspect the contact
review and rendered scenes, then run the checks above. Runtime consumes the
manifest automatically; adding props needs no per-image import or placement code.
Waterline assets need a dedicated pool placement policy before runtime inclusion.

## Inventory

Exact names and descriptions are authoritative in
[Hollow Delve SCENERY.toml](../../../content/biomes/hollow_delve/SCENERY.toml) and
[Wetlands SCENERY.toml](../../../content/biomes/wetlands/SCENERY.toml).
These reviews show every generated prop with its base on a green support line:

- [Hollow Delve: 32 props](hollow_delve/contact-review.png)
- [Wetlands: 32 props](wetlands/contact-review.png)
