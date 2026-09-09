#!/usr/bin/env python3
"""Download pinned 14B models into this experiment, reusing the existing runtime."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent / "sprite-animation"
sys.path.insert(0, str(BASE))
from common import fast_download, download, save_json, sha256


def parallel_transfer(m, connections):
    import hf_transfer
    dest = ROOT / m["path"]
    if dest.exists():
        return download(m["url"], dest, m["sha256"], size=m["bytes"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    temporary = dest.with_suffix(dest.suffix + ".parallel.part")
    progress = {"bytes": 0, "last": time.monotonic()}
    def update(n):
        progress["bytes"] += n
        if time.monotonic() - progress["last"] > 30:
            print(f"{dest.name}: {progress['bytes'] / m['bytes']:.0%}", flush=True)
            progress["last"] = time.monotonic()
    hf_transfer.download(url=m["url"], filename=str(temporary), max_files=connections,
        chunk_size=4 * 2**20, parallel_failures=16, max_retries=5, callback=update)
    download(m["url"], temporary, m["sha256"], size=m["bytes"])
    temporary.replace(dest)
    return dest


def setup(verify_only=False, only=None, connections=16):
    manifest = json.loads((ROOT / "models.lock.json").read_text())
    entries = [m for m in manifest["models"] if not only or only in m["path"]]
    missing = sum(m["bytes"] for m in entries if not (ROOT / m["path"]).exists())
    free = shutil.disk_usage(ROOT).free
    print(json.dumps({"missing_GiB": missing / 2**30, "free_GiB": free / 2**30}), flush=True)
    if verify_only and missing:
        raise RuntimeError("Missing models; run setup_models.py first")
    if missing and free < missing + 3 * 2**30:
        raise RuntimeError("Need space for all missing models plus 3 GiB reserve")
    records = []
    record_name = "models-verified.json" if not only else "models-subset-" + hashlib.sha256(only.encode()).hexdigest()[:12] + ".json"
    for m in entries:
        print("Verifying/downloading", m["path"], flush=True)
        if not verify_only and connections != 16:
            p = parallel_transfer(m, connections)
        else:
            fn = download if verify_only else fast_download
            p = fn(m["url"], ROOT / m["path"], m["sha256"], size=m["bytes"])
        records.append({**m, "local_sha256": sha256(p)})
        save_json(ROOT / "metadata" / record_name, records)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--verify-only", action="store_true")
    p.add_argument("--only", help="Download only manifest paths containing this string")
    p.add_argument("--connections", type=int, choices=[16, 32, 64], default=64)
    a = p.parse_args()
    setup(a.verify_only, a.only, a.connections)
