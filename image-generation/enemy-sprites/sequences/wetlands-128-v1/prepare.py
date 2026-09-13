#!/usr/bin/env python3
"""Compatibility entry point; sheet layout and corrections live in sheet-recipe.json."""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "sprite-pipeline"))
from authored_sheets import prepare

if __name__ == "__main__":
    prepare(HERE / "sheet-recipe.json", HERE)
