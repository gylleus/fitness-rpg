#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

# Python 3.10 / Linux x86_64; wheel manifest records exact files and SHA-256.
if [ ! -x .venv/bin/python ]; then
  uv venv .venv --python python3.10 --no-cache
fi
python3 download.py
uv pip install --python .venv/bin/python --offline --no-cache --link-mode copy \
  --find-links vendor/wheels -r requirements.lock.txt

PYX_REV=f4a046b8b148370a20ab7681fce160551e5fc49b
if [ ! -f vendor/pyxelate.tar.gz ]; then
  curl -L --fail --retry 3 -sS \
    "https://codeload.github.com/sedthh/pyxelate/tar.gz/$PYX_REV" -o vendor/pyxelate.tar.gz
fi
tar -xzf vendor/pyxelate.tar.gz -C vendor
uv pip install --python .venv/bin/python --offline --no-cache --no-build-isolation \
  --find-links vendor/wheels "./vendor/pyxelate-$PYX_REV"
uv pip check --python .venv/bin/python --no-cache
