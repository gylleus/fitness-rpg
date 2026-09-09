#!/usr/bin/env python3
"""Enemy roster adapter; rendering is shared with players and other sprite assets."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sprite-pipeline"))
from sprites import *
from enemy_adapter import plan, load_content, read_toml

if __name__ == "__main__":
    main(enemy_adapter=True)
