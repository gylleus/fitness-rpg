#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
mkdir -p logs
../pyxelate-study/.venv/bin/python batch.py all 2>&1 | tee logs/batch.log
