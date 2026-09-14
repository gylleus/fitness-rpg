# Shared game-art palette

[`assets/palette.json`](../assets/palette.json) is the single master palette,
currently **ENDESGA 32**. Edit that file to change the palette for every exporter.
The older `sprite-animation/palette.json` and `dark-fantasy-01/palette.json` paths
and `pyxelate-study/fantasy-palette.json` are compatibility symlinks, not separate copies.

[`scripts/asset_palette.py`](../scripts/asset_palette.py) supplies prompt guidance,
palette metadata/hashes, exact RGB validation and the common CIEDE2000 mapper.
Mapping runs **after** resizing or filtering, without dithering. Every visible
pixel, including partially transparent pixels, must belong to the master palette.
Code-drawn fallback sprites use a lightweight RGB lookup for theme tints; raster
exports use the perceptual mapper. Both return only exact master colors.
Fully transparent RGB is discarded. Alpha coverage and sprite geometry have their
own export rules and are not changed by the color mapper.

| Pipeline | Palette enforcement |
| --- | --- |
| Player, enemy, animated props, authored sheets | Shared `pixels.convert`; runtime atlas bundling also rejects out-of-palette sheets |
| Code-drawn fallback sprites | Native tint selection always returns an exact color from the same JSON master |
| Static sprite backgrounds | Shared `pixels.convert` |
| Biome layers, roofs, floors, standalone props | Shared texture compiler and preparer, including older source/logical-resolution plans |
| Decoration atlases | Shared prop compiler, including the legacy max-edge helper |
| Item icons | `import-item-icon.cjs` calls the shared static exporter; item bundling checks every visible RGB |
| World map and other static PNGs | `export_static_asset.py` |

Generation prompts use the global color guidance. Biome/enemy color descriptions
describe material intent and may select different subsets of the master palette;
they cannot introduce additional export colors. An explicit user-authored reference
prompt remains recorded verbatim. Raw generations, input references, experimental
controls and historical reviews remain source/research artifacts, not runtime
exports. App branding and UI styling are separate from the game-art pipeline.

Use three or four connected shade clusters per material, with consistent shadow
and highlight ramps. Keep the background quieter than the actors through simpler
forms and a narrower value range. A fixed palette guarantees common RGB choices;
it does not automatically fix composition, shading or drawing quality.

```sh
# Print the exact shared prompt guidance for any backend, including map generation.
uv run sprite-python scripts/asset_palette.py guidance

# Static PNG (retains dimensions); --icon uses the shared 64px item geometry.
uv run sprite-python scripts/export_static_asset.py SOURCE.png OUTPUT.png

# Recompile scenery from recorded masters, not previously quantized textures.
uv run biome-assets reexport --biome hollow_delve
uv run sprite-python scripts/export_static_asset.py --reexport-items
uv run sprite-python scripts/export_static_asset.py --reexport-map
node scripts/bundle-item-icons.cjs

# Check every PNG in assets/{sprites,biomes,items,maps}, not just a color count.
npm run test:palette
uv run sprite-python scripts/asset_palette.py check --report /tmp/palette-audit.json
```

The item migration preserves source provenance. Where a local-only generation
master is unavailable, it archives the existing accepted 64px export under
`items/v1/palette-inputs/` and records that limitation. Subsequent reexports reuse
that immutable input instead of repeatedly mapping an already-quantized result.

Palette exports record the master file hash so reviews and packaged assets can
identify the actual palette used. Changing the master requires recompiling the
runtime exports; the complete pixel audit catches stale assets.
