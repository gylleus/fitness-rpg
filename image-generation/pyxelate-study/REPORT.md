# Local diffusion + Pyxelate: results

Later follow-up: [choose an explicit palette and reduce artifacts](FIXED_PALETTE.md),
with an [ENDESGA 32 comparison](sheets/fixed-palette-svd.png) and an optional conservative
wrapper. The original five-image matrix and conclusions below are retained.

**Useful fantasy-game prototypes: yes. A sufficient unattended pipeline for finished assets: no.** In this five-image test, SDXL + Pixel Art XL already produced reasonably aligned source pixels. **128x128 nearest-neighbor reduction was the cleanest starting point.** If a common color table is required, nearest neighbor mapped to the shared **32-color** sprite palette retained details with fewer artifacts than default Pyxelate. Background removal and art-direction cleanup remain separate work.

Start with the [128px / 32-color comparison](sheets/comparison-128-32.png). Also inspect [64px / 16 colors](sheets/comparison-64-16.png), [64px / 32 colors](sheets/comparison-64-32.png), and [128px / 16 colors](sheets/comparison-128-16.png). Each includes all five subjects and requested controls. Output cells are enlarged exactly 4x or 2x with nearest neighbor; originals are labeled 1024-to-256 previews. Unmodified [originals](originals/) and all [70 processed PNGs](processed/) are supplied at their actual dimensions.

## What was run

Hardware: RTX 3090 (24 GiB), Ryzen 9 5900X, 32 GiB RAM. No suitable installed diffusion model was found, so the requested fallback was downloaded: SDXL base 1.0 + `nerijs/pixel-art-xl`, with `madebyollin/sdxl-vae-fp16-fix`. Generation ran locally after GPU access was enabled. Five first-seed images were retained without selection, rerolling, cropping, inpainting or cleanup.

Sources are 1024x1024 RGB. Seeds: 41001 knight, 41002 slime, 41003 chest, 41004 potion, 41005 environment. Settings: 30 steps, DPM++ 2M / Karras sigmas, CFG 7, LoRA weight 1, FP16, no refiner. Five inference calls took **61.3 seconds total**, with **9.14 GiB peak PyTorch-allocated memory**, excluding loading/downloads. Prompts, negative prompts, exact revisions, settings and hashes are in [config.json](config.json), `originals/*.json` and `metadata/`.

Main matrix: Pyxelate 2.1.1 at `f4a046b8b148370a20ab7681fce160551e5fc49b`; `dither="none"`, `svd=True`, `sobel=3`, `depth=1`, `alpha=0.6`; 64x64 and 128x128; 16 and 32 colors. Palette learning/transforms took about 255 seconds, excluding sheets and alpha probe. Independent palettes train on each original. Shared palettes train on an equal-area four-sprite collage, with 256x256 training samples per sprite. The environment is excluded; its shared-palette results are a transfer stress test. Fitted palettes are reused across sizes. No original is stretched or cropped.

Controls: plain nearest neighbor, and nearest neighbor mapped without dithering to the **exact exported shared color table**, using nearest CIELAB distance. This exposes color-table limitations separately from much of the processing effect. It does not isolate resizing perfectly: Pyxelate also alters contrast/saturation and uses a learned BGM color classifier.

## Visual findings

| Asset | Observations |
|---|---|
| Knight | Recognizable at both sizes. At 64px the thin sword, helmet slit and shield emblem lose detail; Pyxelate sometimes joins a broken diagonal but softens adjacent detail. At 128px nearest neighbor preserves sword, cross and armor plates better. Default Pyxelate adds pale specks outside the sword and broadens highlights. The unwanted gray frame is already in the source. |
| Slime | Readable green monster, but the source has limbs and a grimacing face instead of a simple jelly body. Facial/body texture merges at 64px. Pyxelate intensifies lime highlights and changes mouth shading. At 128px nearest neighbor retains texture better. Color reduction cannot fix the source design. |
| Chest | Recognizable, but occupies little of its canvas: roughly 18 pixels wide at 64px. Lock and band details merge there. At 128px nearest neighbor retains lid slats and lock; Pyxelate brightens gold and mottles some bands. Tighter source framing would use the pixel budget better. |
| Potion | Silhouette survives, but label/glass highlights collapse at 64px. Pyxelate changes shading and creates detached peach patches beside the bottle in shared-palette 128px results. Beige background becomes peach or white depending on settings; that is recoloring, not transparency. |
| Environment | Arch, path and trees remain readable at 64px; 128px retains more masonry/foliage. Independent palettes retain earthy color relationships best among Pyxelate variants, although contrast/texture change. The sprite palette badly shifts grass, stone and path colors; Pyxelate makes these especially bright. |

The sprites share fantasy subject matter and dark outlines, but scale, detail density, framing, shadows and requested perspective are not standardized. **Matching palettes do not establish consistent character design.** The slime's design error is the clearest example.

Among the main Pyxelate settings, **128px / 32 colors / independent palette / no dithering** is the best general detail/color compromise. Sixteen colors can serve simple icons but flattens materials/highlights. More colors do not recover details lost at 64px or remove stray pixels. Some independent 32-color fits emitted non-convergence or redundant-color warnings; results and warnings were retained. Palette size is a maximum, and some outputs use fewer colors.

## One failing example: grid recovery and SVD

The knight was selected after observing sword-adjacent specks and altered details. See the [follow-up and enlarged sword crops](sheets/knight-followup.png). Sprite Fusion Pixel Snapper via the pinned `pixel-snapper==0.1.0` Python binding inferred a **128x129** grid, with automatic detection and 256 intermediate colors. The native PNG is retained; matching-size comparisons contain it with preserved aspect ratio and one padding column at 128x128.

Grid recovery modestly regularizes sword steps and some clusters; its advantage over the already-good 8x nearest-neighbor reduction is small. **Default Pyxelate after grid recovery reintroduces pale specks and strong highlights.** It did not rescue the default pipeline. The tool also quantizes, so this is not a pure geometry-only intervention.

On this knight, **SVD off** removes the obvious detached specks and is more useful than the added grid step. Pyxelate still changes shading, outline weight and the frame. All six follow-up outputs use the same original-trained independent 32-color palette and BGM; the reproduced default matches the main matrix pixel-for-pixel. SVD-off was tested on this one example only: promising, not a demonstrated fix for the set. No dithering variants were added.

## Transparency and cleanup

All five originals and all 70 main outputs are **opaque RGB**. Separate cutout/mask work is needed, including decisions about cast shadows, removal of the knight's frame, and edge cleanup before transparent export. No background removal is presented as part of the Pyxelate result.

The [synthetic alpha probe](sheets/alpha-probe.png) produces only 0/255 alpha at threshold 0.6. Inputs with identical visible content but different RGB behind transparent pixels produce purple versus cyan edge fringes. Their output masks match, but visible RGB differs at 536/1,116 pixels at 64px and 2,262/4,581 at 128px. Gold test rectangles become red. These are fixture observations, not general failure rates. Check hidden RGB and edge colors when processing extracted RGBA sprites.

Use 128px nearest-neighbor versions as starting assets; use shared 32-color mapping where its shifts are acceptable. Clean masks, isolated pixels, outline runs and tiny symbols. Normalize framing/pivots and redesign the slime before treating these as a coherent set. The scene is a static illustration: tileability and animation consistency were not tested. One seed per subject supports this focused comparison, not a broad model benchmark.

## Reproduction and verification

[COMMANDS.md](COMMANDS.md) gives exact setup/run/follow-up commands and source links. Pins are in `requirements.lock.txt` and optional `requirements-followup.txt`; scripts are `generate.py`, `process.py`, and `followup.py`. Weights and environment remain in this directory; the portable result archive excludes their multi-GB contents.

All 70 main PNGs passed target-dimension, color-count and exact shared-palette checks. Follow-up checks verify six 128x128 PNGs, common palette and agreement with the main default. Original/model/dependency hashes and installed versions are recorded. Integrity checks supplement visual inspection; they are not perceptual scores. No application code was changed.
