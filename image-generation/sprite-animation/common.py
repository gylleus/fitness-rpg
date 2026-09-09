"""Paths, manifests and bounded, resumable downloads. No hosted inference."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STUDY = ROOT.parent / "pyxelate-study"
PYX_REV = "f4a046b8b148370a20ab7681fce160551e5fc49b"
COMFY_REV = "d5c1954d5cd4a789bbf84d2b75a955a5a3f93de8"
SAM_REV = "2b90b9f5ceec907a1c18123530e92e794ad901a4"


def model_dir():
    return Path(os.environ.get("SPRITE_MODEL_DIR", str(ROOT / "models"))).expanduser().resolve()


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_text(json.dumps(value, indent=2) + "\n")
    tmp.replace(path)


def download(url, dest, expected_hash=None, algorithm="sha256", size=None):
    """Resume interrupted transfers, verify before promotion; preserve bad files."""
    import requests
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    def verify(path):
        if size is not None and path.stat().st_size != size:
            return False
        if expected_hash:
            h = hashlib.new(algorithm)
            with path.open("rb") as f:
                for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
                    h.update(chunk)
            return h.hexdigest() == expected_hash
        return True

    if dest.exists():
        if not verify(dest):
            raise RuntimeError(f"Checksum/size mismatch: {dest}. Preserve or remove this file before retrying.")
        return dest
    partial = dest.with_name(dest.name + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if not (size is not None and offset == size):
        with requests.get(url, headers={"Range": f"bytes={offset}-"} if offset else {},
                          stream=True, timeout=(30, 120)) as r:
            r.raise_for_status()
            if r.status_code == 206:
                if not r.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                    raise RuntimeError("Unexpected download range")
            else:
                offset = 0  # Server ignored Range. Restart, never append a full response.
            with partial.open("ab" if offset else "wb") as f:
                for chunk in r.iter_content(4 * 1024 * 1024):
                    if shutil.disk_usage(dest.parent).free < len(chunk) + 256 * 2**20:
                        raise RuntimeError("Download paused: fewer than 256 MiB would remain. Partial file retained.")
                    f.write(chunk)
    if not verify(partial):
        raise RuntimeError(f"Downloaded checksum/size mismatch: {partial}")
    partial.replace(dest)
    return dest


def fast_download(url, dest, expected_hash, algorithm="sha256", size=None):
    """Optional official HF parallel-range transfer; verify before promotion.

    Uses a separate temporary file, retaining sequential resume data on failure.
    Fast transfers restart after interruption; normal downloads remain resumable.
    """
    import hf_transfer
    import time
    dest = Path(dest)
    if dest.exists():
        return download(url, dest, expected_hash, algorithm, size)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if size is None or shutil.disk_usage(dest.parent).free < size + 2 * 2**30:
        raise RuntimeError("Parallel transfer needs space for the whole file plus 2 GiB reserve")
    partial = dest.with_name(dest.name + ".fast.part")
    state = {"bytes": 0, "last": time.monotonic()}

    def progress(n):
        state["bytes"] += n
        if time.monotonic() - state["last"] >= 30:
            print(f"{dest.name}: {state['bytes'] / size:.0%}", flush=True)
            state["last"] = time.monotonic()

    hf_transfer.download(url=url, filename=str(partial), max_files=16,
        chunk_size=16 * 2**20, parallel_failures=4, max_retries=5, callback=progress)
    # Reuse the standard verifier without issuing another network request.
    download(url, partial, expected_hash, algorithm, size)
    partial.replace(dest)
    sequential_partial = dest.with_name(dest.name + ".part")
    if sequential_partial.exists():
        sequential_partial.unlink()  # Superseded task-created partial, verified full file now exists.
    return dest
