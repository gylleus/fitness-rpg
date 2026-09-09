# Reproduce the experiment

Run from the repository root. All project files, environment, weights and output
stay inside `image-generation/pyxelate-study`. The CUDA environment is pinned for
Linux x86_64 and Python 3.10.12; the recorded machine has an RTX 3090 (24 GiB),
Ryzen 9 5900X and 32 GiB RAM. Initial available disk space was about 23 GiB.

```bash
cd image-generation/pyxelate-study
bash setup.sh
.venv/bin/python generate.py > logs/generation.log 2>&1
.venv/bin/python process.py all > logs/processing.log 2>&1
```

For the already-installed environment and downloaded weights, run `bash run.sh`
from this directory in a terminal with NVIDIA device access. A CPU-only model
loading check is available without generating any images:

```bash
.venv/bin/python generate.py --check-models
```

`setup.sh` downloads the exact wheel/model URLs in the manifests and installs
offline. It verifies wheel SHA-256 values and model hashes if already recorded.
The first experiment downloaded those same URLs using individual `curl -L` calls
because direct package-manager networking was restricted in the agent sandbox.
The failed online install did not supply any dependencies for the final run.

The equivalent install commands after downloads are:

```bash
uv venv .venv --python /usr/bin/python3 --no-cache
uv pip install --python .venv/bin/python --offline --no-cache --link-mode copy \
  --find-links vendor/wheels -r requirements.lock.txt
uv pip install --python .venv/bin/python --offline --no-cache --no-build-isolation \
  --find-links vendor/wheels \
  ./vendor/pyxelate-f4a046b8b148370a20ab7681fce160551e5fc49b
uv pip check --python .venv/bin/python --no-cache
python3 download.py --verify-only
```

For processing only, install `requirements-processing.txt` and the local
Pyxelate source; no CUDA or model weights are needed. Run the same `process.py`
command against the saved originals.

```bash
.venv/bin/python process.py process
.venv/bin/python process.py sheets
.venv/bin/python process.py alpha
.venv/bin/python process.py validate
```

Generation skips existing originals. To repeat generation, copy the experiment
scripts/configuration to a new directory with an empty `originals/` and use the
same weights. Seeds, prompts, inference settings and revisions are in
`config.json`; per-image timing, prompt, seed and SHA-256 are in `originals/*.json`.
The source PNGs also embed prompt/seed/settings metadata. Deterministic PyTorch
algorithms are enabled, but identical seeds are not a promise of bitwise equality
on other hardware or dependency versions. Processing is deterministic with the
pinned libraries and Pyxelate's fixed BGM/SVD seeds.

Full package pins: `requirements.lock.txt`. Exact platform wheel URLs and SHA-256:
`metadata/wheels.json`. Source model revision API responses are saved in
`metadata/*-api.json`; the model file list and hashes are in
`metadata/model-downloads.json` and `metadata/model-checksums.json`.

The original five images are first-seed samples, with no best-of selection,
inpainting, sharpening, background removal or cleanup. Main comparison output
is in `processed/`; all PNGs there are at the stated target dimensions. Sheet
output cells use only integer nearest-neighbor enlargement (64px 4x, 128px 2x).
The original column is clearly labeled as a 1024-to-256px preview; full originals
are separately supplied at 1024px.

Sheet labels use the system DejaVu Sans font at
`/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`; its hash and render settings
are recorded in `metadata/render-environment.json`.

## Conditional follow-up and result archive

After observing the knight failure, run the optional follow-up with:

```bash
uv pip install --python .venv/bin/python --no-cache --require-hashes \
  -r requirements-followup.txt
.venv/bin/python followup.py > logs/followup.log 2>&1
```

The initial install used `uv pip install --python .venv/bin/python --no-cache
pixel-snapper==0.1.0`; the optional lock records that exact platform wheel and
SHA-256. The main lock excludes this follow-up-only dependency. Final installed
versions are in `metadata/installed-versions.json`.

The auto grid is 128x129. Follow-up uses nearest-neighbor aspect-preserving
containment to 127x128, pads one column to 128x128, then enlarges exactly 8x for
the downstream Pyxelate input. All six panels reuse the original knight's
independent 32-color palette and BGM. Pixel Snapper uses 256 intermediate colors
and auto grid detection. No dithering or background removal is added. Full
settings and hashes are in `metadata/grid-followup.json`.

To recreate the portable archive after all steps and report edits:

```bash
.venv/bin/python package_results.py
```

The archive includes sources, metadata, prompts, PNGs and Pyxelate's pinned
source archive; it excludes model weights, wheel cache and the Python virtual
environment. `metadata/result-checksums.json` covers all included result files.

## Editable fixed-palette follow-up

For the editable fixed-palette follow-up, change the `colors` list in
`fantasy-palette.json` (currently the user-selected
[ENDESGA 32](https://lospec.com/palette-list/endesga-32)), then run:

```bash
.venv/bin/python fixed_palette.py > logs/fixed-palette.log 2>&1
.venv/bin/python package_results.py
```

This uses only the existing CPU processing dependencies. The script compares
nearest-palette reduction, stock Pyxelate SVD on/off, and a clearly labeled
custom wrapper that reuses Pyxelate's median/Sobel resizing but disables its
automatic color enhancement and replaces BGM assignments with nearest CIELAB.
The wrapper calls private methods from the pinned Pyxelate version; it is not
unmodified Pyxelate. All outputs must pass exact hex-palette membership and
128x128 dimension checks. The original main experiment remains unchanged.

## Sources

- [SDXL base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0), OpenRAIL++ weights.
- [Pixel Art XL](https://huggingface.co/nerijs/pixel-art-xl), CreativeML OpenRAIL-M weights; author suggests nearest-neighbor reduction and a fixed VAE.
- [FP16 VAE fix](https://huggingface.co/madebyollin/sdxl-vae-fp16-fix).
- [Diffusers 0.32.2 SDXL documentation](https://huggingface.co/docs/diffusers/v0.32.2/en/using-diffusers/sdxl).
- [Pyxelate source at the tested commit](https://github.com/sedthh/pyxelate/tree/f4a046b8b148370a20ab7681fce160551e5fc49b), MIT; code and license retained under `vendor/`.
- [Sprite Fusion Pixel Snapper](https://github.com/Hugo-Dz/spritefusion-pixel-snapper) and [tested Python binding](https://github.com/NoRaincheck/pixel-snapper), MIT; version and wheel hash recorded separately.

SDXL is an open-weight model under a use-restricted license. Pyxelate is
open-source under MIT. This experiment uses neither a hosted image-generation
API nor OpenAI image generation.
