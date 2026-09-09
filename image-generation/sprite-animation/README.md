# Local sprite animation pipeline

This directory implements an unattended pipeline using the existing dark-fantasy
sources: **BiRefNet cutout → Wan 2.2 image-to-video in ComfyUI → SAM2 temporal masks
→ fixed crop/grid and ENDESGA 32 conversion → loop selection → PNG sheets/JSON**.
It preserves every candidate and records rejection reasons. No hand-drawn frames,
manual mask prompts, paid API, or hosted inference is required.

**Validated end to end on the RTX 3090:** four real Wan clips (164 generated
frames), automatic masks/tracking, both pixel-conversion methods, loop selection,
PNG sheets and JSON/previews. The final bundle contains three selected candidates;
the weak short-knight control remains explicitly rejected. Ten regression tests
pass, and all 96 locked dependency versions match the runtime. Motion quality
remains uneven; this is a working automated pipeline, not a guarantee of finished
game art. See [measured results](VALIDATION.md).

Open the [offline animation player](outputs/delivery/review.html),
[comparison PNG](outputs/delivery/comparison.png), or
[52 MB asset ZIP](outputs/dark-fantasy-animation-pilot.zip).

## Tools and why

| Tool | Responsibility |
|---|---|
| [ComfyUI](https://docs.comfy.org/development/comfyui-server/comms_routes), pinned v0.3.50 | Local queue/API and native Wan model loading/offloading. Starts on loopback, uses no custom nodes, and exits before tracking. No GUI workflow editing needed. |
| [Wan 2.2 TI2V-5B](https://docs.comfy.org/tutorials/video/wan/wan2_2) | Reference-image motion generation for idle, flame and hover presets. This is a feasibility pilot at 512×512, below the model's published 720p target. |
| [rembg 2.0.67 / BiRefNet general](https://github.com/danielgatis/rembg/tree/v2.0.67) | CPU foreground mask for the source and periodic automatic checks on generated frames. Model explicitly selected. |
| [SAM2.1 Hiera tiny](https://github.com/facebookresearch/sam2) | Propagates an automatically initialized foreground mask across generated frames. |
| [Pyxelate](https://github.com/sedthh/pyxelate), pinned study revision | Optional conservative spatial reduction; compared with nearest-neighbor using the same masks and palette. |
| NumPy, SciPy, scikit-image, Pillow | Mask handling, fixed grid, palette mapping, loop scores, exact PNG atlas/timing JSON and previews. |

Aseprite or Pixelorama can inspect the results, but are not dependencies of this
automated pipeline. FFmpeg is unnecessary for the core path: ComfyUI emits
lossless PNG frames, avoiding an intermediate MP4/JPEG quality loss. Blender or
pose/rig tooling would be a separate approach for controlled walks and attacks;
these initial presets do not require a motion-template library.

## Setup and commands

Run from this directory:

```bash
cd /home/karl/repo/apps/fitness-rpg/image-generation/sprite-animation

# Separate supplemental venv; reuses the existing study's torch/CUDA packages.
../pyxelate-study/.venv/bin/python setup.py --environment

# Current segmentation weights are already installed and checksum-verified.
.venv/bin/python setup.py --models segmentation

# Requires sufficient disk space before any large transfer begins.
.venv/bin/python setup.py --models all
.venv/bin/python pipeline.py doctor

# Two bounded attempts per subject, stopping early on a heuristic pass.
.venv/bin/python pipeline.py run --preset all --attempts 2

# Or a single subject. Other names: lantern-flame, wraith-hover.
.venv/bin/python pipeline.py run --preset knight-idle --attempts 2

# Tested stronger knight preset: 65 frames and a longer loop interval.
.venv/bin/python pipeline.py --config presets-longer-knight.json run --preset knight-idle --attempts 1
```

The RTX 3090 has 24 GiB VRAM. The machine has 32 GiB system RAM. Actual generation
took 94–115 seconds for the tested clips; sampled whole-GPU use peaked at
17.5–18.1 GiB. Process RSS reached 24.1 GiB and system swap use grew during model
loading, so RAM pressure matters when other applications are open. Core motion weights total
18,144,966,705 bytes; segmentation adds 1,128,675,382 bytes. Plan roughly 25–30
GiB of free space for setup and candidate outputs. No existing models or user
data are removed. Interrupted downloads retain `.part` files and resume.

For a slow single-stream connection, `setup.py --models all --fast` uses the
official `hf-transfer==0.1.9` parallel-range downloader (16 ranges, one model at
a time). It verifies the same model checksums. Its separate `.fast.part` transfer
restarts after interruption; ordinary `.part` resume data is retained until a
verified complete model replaces it. This option needs room for a complete file
in addition to any existing resume data. Do not run two setup processes against
the same model directory. Default downloads use up to three independent files
concurrently; set `--jobs 1` for serial downloads.

By default, all new files stay in this directory. If another model-storage path
is chosen, set `SPRITE_MODEL_DIR` to its absolute path for **both setup and run**;
code and outputs remain here. The current setup has not used an external drive.

The environment inherits the existing `../pyxelate-study/.venv` through a `.pth`
file; do not remove that runtime. Setup installs only missing pinned packages
into the new environment. It does not upgrade the study environment. This is
tested on Python 3.10.12, Linux x86_64, torch 2.5.1+cu124 and uv 0.12.5.
`requirements.in`, `requirements.lock.txt`, the study lock, and
`metadata/runtime-versions.json` capture exact dependencies. Source archive
revisions/hashes and model URLs/hashes are recorded in `metadata/` and
`models.lock.json`. SAM2's optional CUDA extension is not required; its extra
mask postprocessing is disabled.

To repeat the real static masking experiment without the motion weights:

```bash
.venv/bin/python pipeline.py prepare --preset all
```

To reproduce the named validation artifacts, use a new output directory or
preserve the existing one first. `prepare`/`run` refuse to overwrite an output
directory. The commands originally used were:

```bash
.venv/bin/python pipeline.py prepare --preset all --output outputs/mask-pilot
.venv/bin/python validate_masks.py
.venv/bin/python test_pipeline.py
.venv/bin/python smoke.py api
.venv/bin/python smoke.py tracking
```

The last command uses a **synthetic translated knight cutout** as a fixture for
BiRefNet → SAM2 → export integration. It is explicitly labeled in its manifests
and atlas metadata and must not be presented as a Wan animation result.

An existing ordered directory of masked RGBA PNGs can also be processed:

```bash
.venv/bin/python pipeline.py process /absolute/path/to/cutouts outputs/imported --preset knight-idle
```

`doctor`, `run`, and `process` return exit code 2 for unavailable prerequisites
or rejected candidates. Other runtime/setup errors return nonzero with a reason.
Model checksums are verified before `run`; it never silently starts a model
download. An occupied ComfyUI port is rejected; choose `--port 8190` to use a
different port. Only the process started by this script is stopped.

## Settings and outputs

Edit a copy of `presets.json` and pass `--config /absolute/path/config.json`
**before** the subcommand. Defaults are 512×512, 33 generated frames at 24 fps,
20 sampling steps, CFG 5, shift 8, `uni_pc`/`simple`, and two seed attempts.
Image dimensions must be divisible by 32; frame count must be `4n+1`.

Each run records source hashes, prompts, negative prompts, seeds, generation
settings, source/model revisions, dependency versions, the actual Comfy API
graph, server logs and generated original PNGs. The input files under
`dark-fantasy-01/` are preserved.

Each candidate retains:

- `motion/frames/`: generated RGB PNGs at the generation size.
- `tracking/`: original masks, temporal masks, cutout PNGs and BiRefNet/SAM agreement.
- `export/nearest-64`, `nearest-128`, `conservative-64`, `conservative-128`: every
  processed frame, eight-frame `spritesheet.png`, individual target-size PNGs,
  `spritesheet.json`, transparent `preview.apng` and 4× nearest-neighbor GIF.
- `export/comparison.png`: labeled 64/128 comparisons enlarged by integer NN.
- `export/report.json`, `attempt.json`: crop/pivot, loop interval, timings,
  measurements and explicit pass/rejection status.

The atlas JSON uses Aseprite-style frame rectangles, source sizes, durations and
animation tags, plus a documented normalized pivot. The PNG atlas uses an 8×1
layout with untrimmed, equally sized RGBA frames. APNG is the authoritative
transparent preview. GIF has a checkerboard background and may quantize preview
colors/timing; Pillow can combine adjacent identical preview frames. Individual
PNGs and atlas JSON preserve the exact eight-frame sequence and durations.

Each completed run also creates `review.html`, an offline comparison player with
synchronized methods, 64/128px selection, playback speed and background controls.
It uses the actual atlas PNGs and JSON timing, with integer nearest-neighbor
display. Run `.venv/bin/python review.py outputs/RUN_NAME` to rebuild it.
Browser UI automation was unavailable during setup; the script syntax and local
HTTP response were checked. The PNG comparison sheets are separately inspected.

`motion/resources.json` and masking `*.resources.json` files record stage timing,
sampled process RSS, whole-GPU use and available system RAM every five seconds.
GPU totals include other applications; these samples are not allocator maxima.

## Processing and limits

The static pilot favors **128px nearest-neighbor + the fixed palette**: it keeps
armor highlights, thin sword detail and ribs sharper. It is the default path
used to choose the loop. Conservative Pyxelate outputs are still always emitted
with exactly the same masks, crop, palette and selected frame indices.

The conservative path calls the pinned Pyxelate HSV median and Sobel-weighted
reducer. It bypasses stock BGM fitting, SVD, CLAHE and color boosting, then maps
to the closest ENDESGA color using CIEDE2000. This avoids the blue-to-purple
assignment observed with the original Euclidean CIELAB (CIE76) matcher on the
generated flame. Set `color_metric` to `cie76` to reproduce that control; both
modes retain the exact same ENDESGA colors. This is a custom Pyxelate wrapper, not
unmodified `Pyx.transform()`. See the [alpha audit](../animation-research/README.md)
for why stock RGBA handling is not used.

Background removal runs before source conditioning and again after RGB motion
generation. High-resolution soft alpha is retained. Mixed edge/background RGB is
replaced with the nearest confident foreground color before filtering, avoiding
matte halos. This is an edge-color approximation, not physical matting; soft glow
and translucent glass can be simplified. Alpha is resized separately with
coverage averaging and a 128/255 threshold by default, then made binary. Set
`mask_resize` to `nearest` in a config to compare thinner-edge behavior.

A single square union crop preserves aspect ratio and gives the entire clip one
grid and scale. Frames are never independently recentered. The knight's pivot
comes from both boots in a lower ground band; components that do not reach the
ground are excluded from the measurement, leaving all exported pixels intact.
This prevents the anchor jumping between boots or following a cape tip.
Floating and stationary presets use
their fixed configured pivots. No automatic connected-component deletion removes
potentially valid sparks, fingers or sword tips.

Loop selection compares endpoint appearance and motion direction, favors
candidates with actual motion, and samples eight frames without duplicating the
endpoint. It does not force ping-pong playback or crossfade silhouettes. Default
quality thresholds remain **heuristics tested on this small pilot** for mask
size jumps, borders, ground-anchor drift, segmenter/tracker agreement,
insufficient motion and seam quality. Character presets also require at least
2% silhouette change within the selected interval, so color flicker alone does
not pass. The lantern omits that constraint because its flame can move inside a
stable housing. `min_loop_frames` controls the minimum cycle interval; the longer
knight preset uses 36 generated frames (1.5 seconds). Rejected outputs stay
labeled as rejected, and attempts are bounded.

These checks cannot certify anatomy, character identity, equipment retention,
rigid lantern housing, flame physics, or intentional motion. Passing the checks
does not guarantee a useful game asset. Matching ENDESGA colors does not establish
consistent character design. The short knight failed the revised motion checks;
the longer knight passed but retains subtle motion and shading flicker. The
lantern changes flame shape/brightness, and the wraith performs an arm/robe gesture
with little vertical hovering. These are useful motion drafts; strict motion
compliance still needs better conditioning or another animation method.

## Repeat the measured comparisons

The original CIE76 control is preserved in `presets-pilot-33-cie76.json` and
`outputs/wan-pilot-01`. The settings reproduce the original four pixel variants
exactly when applied to the retained first knight frame. The final conversion
and rejection fixes are separate exports; original generated frames are intact.

```bash
.venv/bin/python pipeline.py --config presets-pilot-33-cie76.json run --preset all --attempts 2
.venv/bin/python pipeline.py --config presets-longer-knight.json run --preset knight-idle --attempts 1

# Reprocess saved motion without running the GPU models again; choose unused output paths.
.venv/bin/python reprocess.py outputs/wan-pilot-01 outputs/my-revised-pilot
.venv/bin/python reprocess.py outputs/knight-longer-01 outputs/my-revised-knight --config presets-longer-knight.json
.venv/bin/python validate_run.py outputs/my-revised-pilot
.venv/bin/python validate_run.py outputs/my-revised-knight
.venv/bin/python test_pipeline.py
```

`package_pilot.py` assembles the measured selections into `outputs/delivery` and
the asset ZIP, refusing to overwrite an existing delivery directory. Every run
retains prompts, seeds, model hashes, settings and its ComfyUI API graph. Repeating
generation on another hardware/software stack is not guaranteed bitwise identical.

Licenses: ComfyUI is GPL-3.0; Wan and SAM2 weights/code are Apache-2.0; rembg and
BiRefNet are MIT; Pyxelate is MIT. Their downloaded source licenses remain in
`vendor/`. The ENDESGA palette's attribution/source are retained in `palette.json`.
