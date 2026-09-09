# Local sprite generation

Start with [the shared sprite pipeline](sprite-pipeline/README.md) for art-only
character and prop definitions, or [the enemy adapter](enemy-sprites/README.md)
for a canonical game roster. The [barbarian player example](player-sprites/README.md)
uses the same rendering, masking, palette reduction and atlas export stages.

Source code, dependency/model locks, download manifests, prompts and the small
player pose guide are versioned. Model weights, Python environments, upstream
source installations, generated runs and ZIP delivery bundles remain local.
Links to experiment previews in the individual READMEs point to those local
outputs; they become available after generation. The player example includes
saved recipes that can restore its run configuration in a fresh checkout.

The shared renderer reuses `sprite-animation/` for segmentation and pixel
processing, `pixel-animation-14b/` for Wan inference, and `pyxelate-study/` for
SDXL and the original pinned processing environment. The latter directories
retain their setup commands and experiment documentation. Setup downloads are
separate from generation; model inference runs locally.

The enemy adapter additionally imports `scripts/content.py`. Authored game
content is curated separately and is not needed for art-only player/prop runs.
