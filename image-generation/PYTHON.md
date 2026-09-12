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

## GPU environment and setup

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

On this machine the GPU runtime and models are already installed. For a fresh
checkout, the existing setup procedure is:

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
