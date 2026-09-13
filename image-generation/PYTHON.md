# Python tooling with uv

Run Python tools through `uv` from the repository root. The root
`pyproject.toml`, `uv.lock`, and `.python-version` define a small Python 3.12.9
project for command entry points and content tooling. `uv run` prepares it
automatically; no environment activation is needed.

```bash
uv sync --locked
uv run sprites --help
uv run content
```

## Generate the player reference

```bash
uv run sprites reference \
  --definition content/players/PLAYER.toml \
  --run image-generation/sprite-pipeline/runs/barbarian-club-v1
```

This stops at the pixel reference and `reference-review.html`. Choose a new run
directory after changing a description, seed or input image. The
[reference-first guide](sprite-pipeline/WORKFLOWS.md) covers design iteration,
importing your own pixels, animation, props and static backgrounds.

## Commands

| Command | Purpose |
| --- | --- |
| `uv run sprites …` | Shared asset pipeline: reference, plan, prepare, animate, export, review, package. |
| `uv run enemy-sprites …` | Enemy roster entry point to the same pipeline. |
| `uv run sprite-python …` | Run a helper script or tests in the pinned GPU environment. |
| `uv run sprite-setup …` | Existing sprite environment/model setup commands. |
| `uv run content …` | Validate or export authored game content. |
| `uv run python …` | Standard Python tooling in the lightweight root environment. |

Arguments and exit codes pass through unchanged. Relative input/output paths
are relative to your current directory, just as when running Python directly.
These entry points are local checkout tools, not a distributable sprite engine.

```bash
uv run content --export-json /tmp/game-content.json
uv run python -m unittest discover -s scripts -p 'test_content.py'
uv run sprite-python -m unittest discover -s image-generation/sprite-pipeline -p 'test_*.py' -v
uv run sprite-python -m unittest discover -s image-generation/enemy-sprites -p 'test_*.py' -v
uv run sprite-python -m unittest discover -s image-generation/sprite-animation -p 'test_*.py' -v
```

## Apple Silicon setup

Use native ARM64 Python on macOS 14 or later. The Mac runtime is a separate
Python 3.12.9 environment in `sprite-animation/.venv-macos`, with
`requirements-macos.lock.txt` pins including torch 2.8.0. The root environment
remains lightweight. Linux environments, CUDA locks and model originals are
preserved. Run from the repository root:

```bash
uv sync --locked
uv run sprite-setup --environment
uv run sprite-setup --models reference
uv run sprite-setup --models segmentation
uv run sprites reference \
  --definition content/players/PLAYER.toml \
  --run image-generation/sprite-pipeline/runs/mac-reference-v1
```

SDXL and SAM2 select MPS on Apple Silicon; CUDA remains the default on Linux.
BiRefNet runs on CPU on both platforms. SDXL keeps PyTorch's default attention
and enables VAE slicing on Mac; SAM2 uses FP32 without CUDA autocast. SDXL
attention slicing produced NaNs on this M3 Max in both FP16 and FP32, matching
[the upstream report](https://github.com/huggingface/diffusers/issues/11229).
Invalid pixels now raise an error before a reference can be saved. The launcher enables
`PYTORCH_ENABLE_MPS_FALLBACK=1` before importing torch, unless explicitly set by
the caller. Some operations can consequently run on CPU. Seeds and prompts
are preserved; different backends and precision can produce different pixels.
Device metadata is saved with generated references and masks.

The [Hollow Delve background trial](scene-samples/hollow-delve-v1/README.md)
validates local SDXL generation, pixel preparation, export and packaging on
the 48 GB M3 Max. It includes selected PNGs and device/seed/hash records.

For the shared **Wan 2.2 14B animation** path, also run:

```bash
# Download only the shared encoder, rather than the historical 5B pilot.
uv run sprite-setup --models encoder
uv run sprite-python image-generation/pixel-animation-14b/setup_models.py

# Mac only: prepare scale-correct FP16 copies of both FP8 experts.
uv run sprite-python image-generation/pixel-animation-14b/prepare_macos.py
uv run sprite-python image-generation/pixel-animation-14b/prepare_macos.py --verify-only
```

Then use the usual `sprites plan`, `all`, or individual stages from
[the workflow guide](sprite-pipeline/WORKFLOWS.md), choosing a new run directory.
The Mac runner verifies and selects the converted expert files. It keeps the
text encoder and video VAE on CPU, uses FP16 diffusion with split attention,
and retains separate high/low expert processes and the lossless latent handoff.
Linux continues using the original FP8 files and launch flags.

Conversion writes one tensor at a time, multiplies each quantized weight by its
stored scale in FP32, then rounds to FP16 and removes quantization controls.
This needs roughly **53 GiB of extra disk** for the two converted experts.
Allow approximately **120 GiB free** for a fresh complete setup and working
space. FP16 increases animation memory use; 48 GB is shared with macOS and other
applications. A real render/memory benchmark is still needed to establish Wan
performance and memory fit on this Mac. Tensor conversion tests alone do not
establish successful full-model inference.

`SPRITE_DEVICE=auto` is the default. Set `SPRITE_DEVICE=cuda`, `mps`, or `cpu`
explicitly for diagnostics. GPU selection fails when the requested device is
unavailable; CPU inference must be requested explicitly. Animation timeouts
default to four hours on Mac and one hour on Linux. Set
`SPRITE_INFERENCE_TIMEOUT` to a positive number of seconds to override this.
Owned servers still stop on completion, error or timeout. Use a new run when
switching inference backends; saved exports can be reviewed or re-exported
without regeneration.

Setup downloads require internet access. Generation does not download models.
Rerun `sprite-setup --environment` after an interrupted install. The study
`setup.sh` detects macOS before downloading Linux wheels. Archived study/batch
scripts retain their original CUDA behavior; use shared `sprites` commands on Mac.

Validation after setup:

```bash
uv run sprite-python -m unittest discover -s image-generation/sprite-animation -p 'test_*.py' -v
uv run sprite-python -m unittest discover -s image-generation/sprite-pipeline -p 'test_*.py' -v
uv run sprite-python -m unittest discover -s image-generation/enemy-sprites -p 'test_*.py' -v
uv run sprite-python -m unittest discover -s image-generation/pixel-animation-14b -p 'test_*.py' -v
```

Platform/launcher checks also run without ML dependencies:
`uv run python -m unittest discover -s image-generation/sprite-animation -p test_runtime.py`.
Conversion tests exercise real tensor scaling, safetensors decoding, reuse and
corruption rejection without loading Wan.

## Linux GPU environment and setup

The installed GPU stack stays in
`image-generation/sprite-animation/.venv`, which inherits packages from
`image-generation/pyxelate-study/.venv`. Both were already provisioned with
`uv venv` and `uv pip`. `uv run sprites` selects that interpreter explicitly,
preserving Python 3.10, the torch/CUDA versions, upstream sources and existing
model paths. Its child processes use the same interpreter.

The root `uv.lock` covers the command package, not the GPU stack. GPU dependencies
remain pinned by the two existing `requirements.lock.txt` files and upstream
source revisions. `uv sync` operates on the root `.venv`; do not point
`UV_PROJECT_ENVIRONMENT` at either inherited GPU environment. Project syncing
cannot represent the inherited `.pth` package arrangement safely. See uv's
[project syncing documentation](https://docs.astral.sh/uv/concepts/projects/sync/).

Existing Linux workspaces can continue using their installed GPU runtime and
models. For a fresh Linux checkout, the setup procedure remains:

```bash
# Downloads the pinned study wheels/models and installs its uv environment.
bash image-generation/pyxelate-study/setup.sh

# Adds the pinned supplemental packages, SAM2 and ComfyUI sources.
uv run sprite-setup --environment

# Segmentation and Wan weights are separate from Python dependencies.
uv run sprite-setup --models segmentation
uv run sprite-python image-generation/pixel-animation-14b/setup_models.py
```

Read the [study setup](pyxelate-study/README.md) and
[Wan setup](pixel-animation-14b/README.md) for storage requirements and model
selection. No generation command automatically downloads models or upgrades the
GPU runtime. Older experiment reports retain their original replay commands.

## Adding dependencies

Use `uv add PACKAGE` for ordinary repo tooling, and commit `pyproject.toml` and
`uv.lock` together. Use `uv run --locked …` for checks that must reject lockfile
changes. GPU dependency updates need a deliberate change to the existing
requirements and validation against the saved model pipeline; adding a package
to the root project does not add it to the sprite interpreter.

The root cache is `.cache/uv` and the root environment is `.venv`, both ignored
by Git. The npm/Expo workflow continues to use `package.json` and its lockfile.
