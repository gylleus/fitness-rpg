# Hollow Delve layered tunnel v6

This is the first full-resolution interior assembled with the shared pipeline.
The user accepted the enclosed composition and depth, then requested a warmer
brown natural cave with fewer pointed formations; the next revision follows that
direction. Keep these generation sources immutable for provenance and comparison.

`plan.json` records the exact generation prompts used. These predate the final
consolidation of interior style wording into the shared `style.toml`; reprocessing
this saved plan remains reproducible. `sources.json` records the Wetlands texture
reference and the separate alpha-extraction edit prompts. The initial wall and
roof contained painted checkerboards and were rejected; their edited RGBA sources
are the selected inputs. Preparation applies the shared binary alpha contract.

```sh
uv run biome-assets prepare --plan image-generation/scene-samples/hollow-delve-tunnel-v6/plan.json --sources image-generation/scene-samples/hollow-delve-tunnel-v6/sources.json --out image-generation/scene-samples/hollow-delve-tunnel-v6/prepared
uv run biome-assets bundle --manifest image-generation/scene-samples/hollow-delve-tunnel-v6/prepared/manifest.json --mapping image-generation/scene-samples/hollow-delve-tunnel-v6/runtime.json
```

The depth and wall textures retain 1672×941 pixels; the roof retains 2048×768.
The measured roof underside is logical row 143.125 and its lowest edge stays
104 logical units above the walking surface. The offline prepared review provides
a travel slider and layer toggles. The production Skia audit passed 115 renders,
64 exact prop crops and ceiling clearance for 224 player/enemy animation poses.
Portrait and landscape compositions were inspected alongside Wetlands.
