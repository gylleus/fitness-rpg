#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
.venv/bin/python generate.py 2>&1 | tee logs/generation.log
.venv/bin/python process.py all 2>&1 | tee logs/processing.log
