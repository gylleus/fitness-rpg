#!/usr/bin/env python3
"""Alternative official Xet transport, isolated from the older inference runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

ROOT = Path(__file__).resolve().parent
os.environ["HF_XET_HIGH_PERFORMANCE"] = "1"
os.environ["HF_XET_CHUNK_CACHE_SIZE_BYTES"] = "0"
os.environ["HF_XET_CACHE"] = str(ROOT / ".download-cache/xet")
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
from huggingface_hub import hf_hub_download


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8 * 2**20), b""):
            h.update(chunk)
    return h.hexdigest()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--only", default="", help="Manifest path substring")
    a = p.parse_args()
    entries = json.loads((ROOT / "models.lock.json").read_text())["models"]
    for m in entries:
        if a.only not in m["path"]:
            continue
        dest = ROOT / m["path"]
        if dest.exists():
            if digest(dest) != m["sha256"]:
                raise RuntimeError(f"Existing checksum mismatch: {dest}")
            continue
        if shutil.disk_usage(ROOT).free < m["bytes"] + 3 * 2**30:
            raise RuntimeError("Insufficient space for download plus 3 GiB reserve")
        started = time.monotonic()
        print("Downloading via Xet:", m["path"], flush=True)
        local = Path(hf_hub_download(repo_id=m["repo"], filename=m["remote_path"], revision=m["revision"],
            local_dir=ROOT / ".download-cache" / m["repo"].replace("/", "--"), token=False))
        if local.stat().st_size != m["bytes"] or digest(local) != m["sha256"]:
            raise RuntimeError(f"Downloaded checksum mismatch: {local}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        local.replace(dest)
        print(json.dumps({"path": m["path"], "bytes": m["bytes"], "sha256": m["sha256"],
            "seconds": time.monotonic() - started}), flush=True)
