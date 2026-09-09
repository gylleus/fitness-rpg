# Local pixel-animation 14B experiment

This experiment compares the freely downloadable **styly-agents pixel animation
adapter** with its Wan 2.2 I2V A14B base, then tests first/last-frame conditioning.
Everything stays local. It reuses the previous experiment's Python runtime,
pinned ComfyUI, BiRefNet, SAM2, Pyxelate and source cutouts.

Start with [measured results and recommendations](RESULTS.md) and the
[offline comparison player](outputs/review.html).

## Reproduce

From this repository directory:

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/setup_models.py --connections 64
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/setup_models.py --verify-only
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/prepare_inputs.py
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/run.py knight-control
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/analyze.py knight-control
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/run.py knight-pixel
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/analyze.py knight-pixel
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/run.py knight-pixel-loop
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/analyze.py knight-pixel-loop
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/validate.py knight-pixel-loop
```

`config.json` also defines wraith and lantern jobs. A completed high or low expert
stage is reused only after its saved output hashes match. Different settings
require a new job name. Defaults use localhost port 8190 and refuse an occupied
port. The owned server stops after each expert, including on failure.

The dependency lock and runtime are in
[`../sprite-animation/requirements.lock.txt`](../sprite-animation/requirements.lock.txt).
If missing, restore that runtime using its documented setup first. Each run also
records the actual Python/package versions, code hashes, settings, prompts,
reference hash, exact API graphs and per-stage resource measurements.

```bash
cd image-generation/pixel-animation-14b
../sprite-animation/.venv/bin/python -m unittest -v test_experiment.py
```

## Models and memory

For a dedicated sheet at a chosen output resolution, reuse a completed clip:

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/export_sheet.py --job knight-pixel --size 64 --columns 8 --margin 0.08
```

This creates `outputs/knight-pixel-64-sheet/`: 44 transparent 64×64 frames per
method, an 8-column 512×384 atlas (four unused cells), exact-duration previews,
comparison PNG, metadata and a ZIP. Both nearest and conservative Pyxelate use
ENDESGA 32 and one fixed, tighter crop across the whole clip. This changes the
output resolution; the original Wan generation remains 512px. Change `--size`
for another resolution. The 64px outputs were checked for palette membership,
binary alpha, unclipped silhouettes, atlas tiles, frame hashes and timing.

To hold fewer poses for a stepped animation, set `--frame-step`. Generation and
background removal do not need to run again:

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/export_sheet.py --job knight-pixel --size 64 --frame-step 2
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/export_sheet.py --job knight-pixel --size 64 --frame-step 4
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/compare_cadence.py
```

For this 16fps source, step 2 produces 22 frames at 8fps and step 4 produces 11
frames at 4fps. Both retain the 2.75-second cycle: skipped time becomes a longer
hold on the preceding pose. A stride that does not divide the source count keeps
the final partial hold rather than losing that time. `spritesheet.json` records
original source-frame indices and durations. Only retained frames need pixel
conversion, while crop/pivot calculation still uses the entire sequence.

Open [the synchronized cadence comparison](outputs/knight-pixel-64-cadence/review.html)
or download [all three cadences](outputs/knight-pixel-64-cadence/cadence-comparison.zip).
The viewer supports Pyxelate/nearest, scrubbing, and a separate playback-speed
control. Changing speed shortens/lengthens the cycle; frame skipping alone changes
the number of held poses. Start with 8fps for a moderate effect; 4fps is coarser.

`models.lock.json` pins revisions, exact URLs, bytes and SHA256 for both FP8-scaled
14B experts, the sprite adapter, paired Comfy-Org LightX2V v1 acceleration adapters,
and Wan 2.1 VAE. New downloads total **33,751,025,422 bytes**. The already installed
scaled-FP8 UMT5 encoder is reused. The parent model manifest records its hash.
At the start, RTX 3090 had about 23 GiB free VRAM; disk had 38.8 GiB free. System
RAM is 32 GiB, so high and low experts execute in **separate processes** with a
lossless `.latent` handoff. The low expert adds no new noise. This avoids keeping
both experts and their patches resident in system RAM at once.

ComfyUI stays pinned to `d5c1954d5cd4a789bbf84d2b75a955a5a3f93de8` (v0.3.50).
No custom nodes or unrelated server processes are used.

## Controls and interpretation

- `knight-control` and `knight-pixel` differ only in pixel-adapter strength, 0 vs 1.
- `knight-pixel-loop` adds the same reference as the ending-frame condition.
- All use native 128px ENDESGA references enlarged 4× without interpolation,
  512×512 generation, 45 frames, 16fps playback, DDIM/simple, shift 5, four steps
  split 2+2 and CFG 1. At CFG 1, the recorded negative prompt has no guidance effect.
- These settings are derived from the published adapter workflow. They replace
  its ambiguous acceleration filenames with a pinned public pair, use scaled-FP8
  base weights for memory, and use native Wan conditioning instead of PainterI2V's
  motion amplification. This is an adapter evaluation, not a byte-for-byte replay
  of the author's demo. Optional end conditioning is experimental on this I2V model.
- The previous 5B pilot remains a historical comparison. It used different
  reference preparation, steps, frame count and model, so it is not an isolated
  measurement of parameter count or adapter quality.

Output masking is automatic BiRefNet + SAM2. Every frame keeps the same 512px
camera canvas. Exports include nearest + ENDESGA and conservative Pyxelate at
64/128px with no dithering and binary alpha. Fine glow/transparency can be lost.

The entire requested cycle is exported, omitting the final boundary frame.
There is no best-interval search, ping-pong or crossfade. Full-rate 44-frame atlases
and APNG previews play at the generated 16fps. Compact twelve-frame atlases are
also provided, but play at only about 4.4fps over the same 2.75 seconds. The offline
player defaults to full rate. Loop measurements operate on the actual
last displayed → first displayed transition at native resolution; they do not
score an unused endpoint. A low seam score can still mean a static animation.
**No metric or file-validity check automatically approves artistic quality.**

The three controlled runs can also be generated, exported and validated with:

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/batch.py
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/batch.py wraith-pixel lantern-pixel
```

`validate.py` checks saved PNG dimensions, ENDESGA membership, binary alpha, atlas
tiles and source indices, reference hashes and APNG duration. These are technical
checks only. Review `outputs/review.html`, the labeled comparison sheet (including
raw generation before masking/palette mapping), and actual wrap strips to judge art.
`visual-review.json` contains separate visual observations; these do not come
from an automatic numerical gate. Rebuild just the review sheets/player with:

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/analyze.py
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/previews.py
image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/package_results.py
```

The package contains raw/processed PNGs, atlases, previews, code and provenance.
It excludes model weights and runtimes; reproduction still uses the shared
runtime in this repository. `outputs/package.json` records the ZIP checksum.
GIF previews use cumulative centisecond rounding to preserve cycle duration;
their per-frame timing is approximate. PNG/APNG and atlas metadata are authoritative.

## Sources

- [Pixel animation adapter and downloadable weights](https://huggingface.co/styly-agents/Wan2-2-pixel-animate)
- [Author's clarification of acceleration adapters](https://huggingface.co/styly-agents/Wan2-2-pixel-animate/discussions/1)
- [Comfy-Org Wan 2.2 repack](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged)
- [Official native Wan 2.2 workflow documentation](https://docs.comfy.org/tutorials/video/wan/wan2_2)

Saved upstream model cards and the original author's workflow are in `metadata/`.
The model cards identify Apache 2.0 terms; existing tool sources retain their
upstream licenses in the parent experiment. This project does not redistribute
the sprite adapter's training dataset.

An isolated official Xet downloader is available when the legacy range transport
is slow. It does not change inference dependencies:

```bash
uv venv --python image-generation/sprite-animation/.venv/bin/python image-generation/pixel-animation-14b/.download-venv
uv pip install --python image-generation/pixel-animation-14b/.download-venv/bin/python -r image-generation/pixel-animation-14b/download-requirements.lock.txt
image-generation/pixel-animation-14b/.download-venv/bin/python image-generation/pixel-animation-14b/download_xet.py
```

Use one transport per file. The Xet path verifies the same SHA256 manifest and
moves verified files into `models/`. It uses a task-local download cache and disables
the optional chunk cache to limit disk use.
