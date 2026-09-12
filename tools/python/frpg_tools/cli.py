"""uv entry points for repository tools and the existing uv-built GPU environment.

The sprite environment inherits study packages through .pth files. Keeping it
outside the root uv project prevents project syncing from replacing its pins.
"""
from pathlib import Path
import os
import sys


ROOT = Path(__file__).resolve().parents[3]


def _exec(python, *prefix):
    # Do not resolve the interpreter symlink: its venv path selects site-packages.
    os.execv(str(python), [str(python), *map(str, prefix), *sys.argv[1:]])


def _sprite_python():
    python = ROOT / "image-generation/sprite-animation/.venv/bin/python"
    if not python.is_file() or not os.access(python, os.X_OK):
        raise SystemExit(
            "Sprite runtime is not installed. From the repo root, run:\n"
            "  bash image-generation/pyxelate-study/setup.sh\n"
            "  uv run sprite-setup --environment\n"
            "Model setup is separate; see image-generation/PYTHON.md."
        )
    return python


def sprites():
    _exec(_sprite_python(), ROOT / "image-generation/sprite-pipeline/sprites.py")


def enemy_sprites():
    _exec(_sprite_python(), ROOT / "image-generation/enemy-sprites/batch.py")


def sprite_python():
    """Run a helper, module or test with the complete pinned sprite dependencies."""
    _exec(_sprite_python())


def sprite_setup():
    # Setup creates the supplemental environment from the study runtime. This
    # also works before the sprite environment exists, without installing ML
    # packages into the root project's .venv.
    python = ROOT / "image-generation/pyxelate-study/.venv/bin/python"
    if not python.is_file() or not os.access(python, os.X_OK):
        raise SystemExit("Install the study runtime first: bash image-generation/pyxelate-study/setup.sh")
    existing = ROOT / "image-generation/sprite-animation/.venv/bin/python"
    if existing.is_file() and os.access(existing, os.X_OK):
        python = existing
    _exec(python, ROOT / "image-generation/sprite-animation/setup.py")


def content():
    _exec(sys.executable, ROOT / "scripts/content.py")
