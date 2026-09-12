#!/usr/bin/env python3
"""Prepare a separate local runtime, pinned upstream sources and verified models."""
from __future__ import annotations

import argparse
import importlib.metadata as metadata
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
from concurrent.futures import ThreadPoolExecutor

from common import ROOT, STUDY, COMFY_REV, SAM_REV, PYX_REV, download, fast_download, model_dir, save_json, sha256


def run(*args, **kwargs):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), check=True, **kwargs)


def source(name, repo, revision):
    dest = ROOT / "vendor" / name
    marker = dest / ".sprite-source.json"
    if marker.exists() and json.loads(marker.read_text())["revision"] == revision:
        return
    if dest.exists():
        raise RuntimeError(f"Unrecognized source directory: {dest}")
    archive = ROOT / "vendor" / f"{name}-{revision}.tar.gz"
    download(f"https://codeload.github.com/{repo}/tar.gz/{revision}", archive)
    staging = ROOT / "vendor" / f"{name}.extract"
    staging.mkdir(exist_ok=True)
    with tarfile.open(archive) as tf:
        # Reject traversal and escaping links; SAM2 contains internal YAML links.
        for member in tf.getmembers():
            target = (staging / member.name).resolve()
            link_target = ((target.parent if member.issym() else staging) / member.linkname).resolve()
            if (not target.is_relative_to(staging.resolve()) or
                ((member.issym() or member.islnk()) and not link_target.is_relative_to(staging.resolve())) or
                not (member.isfile() or member.isdir() or member.issym() or member.islnk())):
                raise RuntimeError(f"Unsafe archive entry {member.name}")
        tf.extractall(staging, filter="data")
    folders = list(staging.iterdir())
    if len(folders) != 1:
        raise RuntimeError("Unexpected archive layout")
    folders[0].rename(dest)
    staging.rmdir()
    record = {"repository": f"https://github.com/{repo}", "revision": revision,
              "archive_sha256": sha256(archive)}
    save_json(marker, record)
    save_json(ROOT / "metadata" / f"{name}-source.json", record)
    archive.unlink()  # Downloaded setup archive only; extracted source retained.


def environment():
    if sys.platform == "darwin":
        mac_environment()
        return
    base = STUDY / ".venv/bin/python"
    if not base.exists():
        raise RuntimeError(f"Install the existing study runtime first: {base}")
    python = ROOT / ".venv/bin/python"
    if not python.exists():
        run("uv", "venv", "--python", base, ROOT / ".venv")
    site = next((ROOT / ".venv/lib").glob("python*/site-packages"))
    base_site = next((STUDY / ".venv/lib").glob("python*/site-packages"))
    (site / "existing-study-runtime.pth").write_text(str(base_site) + "\n")
    lock = ROOT / "requirements.lock.txt"
    if not lock.exists():
        run("uv", "pip", "compile", ROOT / "requirements.in", "--constraint",
            STUDY / "requirements.lock.txt", "--python-version", "3.10", "--output-file", lock)
    installed = json.loads(subprocess.check_output([str(python), "-c",
        "import importlib.metadata as m,json; print(json.dumps({d.metadata['Name'].lower().replace('_','-'):d.version for d in m.distributions()}))"]))
    extra = []
    for line in lock.read_text().splitlines():
        if not line or line.startswith(("#", " ", "--")):
            continue
        name, version = line.split("==")
        current = installed.get(name.lower().replace("_", "-"), "")
        if current.split("+")[0] != version.split("+")[0]:
            extra.append(line)
    supplemental = ROOT / "metadata" / "supplemental-requirements.txt"
    supplemental.write_text("\n".join(extra) + "\n")
    if extra:
        # uv doesn't inspect inherited .pth distributions. Resolve first, then
        # install only missing pins, avoiding a duplicate multi-GB CUDA runtime.
        run("uv", "pip", "install", "--python", python, "--no-deps", "--no-cache",
            "-r", supplemental)
    source("ComfyUI", "Comfy-Org/ComfyUI", COMFY_REV)
    source("sam2", "facebookresearch/sam2", SAM_REV)
    (site / "sprite-upstreams.pth").write_text(str(ROOT / "vendor/sam2") + "\n" +
        str(STUDY / "vendor" / "pyxelate-f4a046b8b148370a20ab7681fce160551e5fc49b") + "\n")
    run(python, "-c", "import torch,torchvision,torchaudio,rembg,sam2,pyxelate; print('Runtime imports OK; CUDA:',torch.cuda.is_available())")
    versions = subprocess.check_output([str(python), "-c", "import importlib.metadata as m,json; print(json.dumps({d.metadata['Name']:d.version for d in m.distributions()},indent=2))"]).decode()
    (ROOT / "metadata/runtime-versions.json").write_text(versions)


def mac_environment():
    if platform.machine() != "arm64":
        raise RuntimeError("Mac sprite setup requires native ARM64 Python on Apple Silicon (not Rosetta).")
    env = ROOT / ".venv-macos"
    python = env / "bin/python"
    if not python.exists():
        run("uv", "venv", "--python", "3.12.9", env)
    run("uv", "pip", "sync", "--python", python,
        ROOT / "requirements-macos.lock.txt")
    # The bootstrap interpreter can be the dependency-free root environment.
    run(python, "-c", "import setup; setup.mac_sources()", cwd=ROOT)


def mac_sources():
    env = ROOT / ".venv-macos"
    python = env / "bin/python"
    # No inherited study .pth, Linux wheels or CUDA extension builds on Mac.
    source("ComfyUI", "Comfy-Org/ComfyUI", COMFY_REV)
    source("sam2", "facebookresearch/sam2", SAM_REV)
    source("pyxelate", "sedthh/pyxelate", PYX_REV)
    site = next((env / "lib").glob("python*/site-packages"))
    (site / "sprite-upstreams.pth").write_text(
        str(ROOT / "vendor/sam2") + "\n" + str(ROOT / "vendor/pyxelate") + "\n")
    run("uv", "pip", "check", "--python", python)
    run(python, "-c", "import torch,torchvision,torchaudio,rembg,sam2,pyxelate; print('Runtime imports OK; MPS:',torch.backends.mps.is_available())")
    versions = subprocess.check_output([str(python), "-c",
        "import importlib.metadata as m,json; print(json.dumps({d.metadata['Name']:d.version for d in m.distributions()},indent=2))"]).decode()
    (ROOT / "metadata/runtime-versions-macos.json").write_text(versions)


def reference_models(verify_only=False):
    """Reuse pinned study model files without downloading its Linux wheel cache."""
    entries = json.loads((STUDY / "metadata/model-downloads.json").read_text())
    checksums = json.loads((STUDY / "metadata/model-checksums.json").read_text())
    for entry in entries:
        relative = "models/" + entry["path"].split("/models/", 1)[1]
        dest = STUDY / relative
        digest = entry.get("sha256") or checksums[relative]
        if verify_only:
            if not dest.is_file() or dest.stat().st_size != entry["size"] or sha256(dest) != digest:
                raise RuntimeError(f"Missing or changed reference model: {dest}")
        else:
            print("Verifying/downloading", relative, flush=True)
            download(entry["url"], dest, digest, size=entry["size"])


def models(group, verify_only=False, jobs=3, fast=False):
    entries = json.loads((ROOT / "models.lock.json").read_text())["models"]
    entries = [m for m in entries if group == "all" or m["group"] == group
               or (group == "encoder" and m["path"].startswith("comfy/text_encoders/"))]
    root = model_dir()
    root.mkdir(parents=True, exist_ok=True)
    missing_bytes = sum(max(0, m["bytes"] - ((root / (m["path"] + ".part")).stat().st_size
        if (root / (m["path"] + ".part")).exists() else 0)) for m in entries if not (root / m["path"]).exists())
    free = shutil.disk_usage(root).free
    print(json.dumps({"models": str(root), "missing_GiB": round(missing_bytes / 2**30, 2),
                      "free_GiB": round(free / 2**30, 2)}, indent=2))
    if verify_only and any(not (root / m["path"]).exists() for m in entries):
        raise RuntimeError("Models are missing. Run setup.py --models all after providing storage.")
    reserve = 2 * 2**30 if group == "all" else 768 * 2**20
    if missing_bytes and free < missing_bytes + reserve:
        raise RuntimeError(f"Insufficient storage: need {((missing_bytes + reserve)/2**30):.1f} GiB free. Set SPRITE_MODEL_DIR or free storage; no existing data will be deleted.")
    def fetch(m):
        print("Verifying/downloading", m["path"], flush=True)
        transfer = fast_download if fast and not verify_only else download
        path = transfer(m["url"], root / m["path"], m["digest"], m.get("algorithm", "sha256"), m["bytes"])
        return {**m, "local_sha256": sha256(path)}
    # Distinct destination files; all aggregate space is checked before workers
    # start. Each interrupted file has its own resumable partial transfer.
    with ThreadPoolExecutor(max_workers=1 if fast else jobs) as pool:
        records = list(pool.map(fetch, entries))
    save_json(ROOT / "metadata" / f"models-{group}-verified.json", records)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--environment", action="store_true")
    p.add_argument("--models", choices=["all", "segmentation", "motion", "reference", "encoder"])
    p.add_argument("--verify-only", action="store_true")
    p.add_argument("--jobs", type=int, choices=[1, 2, 3], default=3)
    p.add_argument("--fast", action="store_true", help="Official HF parallel-range download; restarts incomplete fast transfers")
    a = p.parse_args()
    if not a.environment and not a.models:
        p.error("Choose --environment and/or --models all|segmentation|motion|reference|encoder")
    if a.environment:
        environment()
    if a.models:
        if a.models == "reference":
            reference_models(a.verify_only)
        else:
            models(a.models, a.verify_only, a.jobs, a.fast)


if __name__ == "__main__":
    main()
