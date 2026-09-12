#!/usr/bin/env python3
"""Local source → mask → Wan motion → SAM2 → pixels → loop → sheets.

Run --help for unattended commands. Heavy model stages run in subprocesses.
"""
from __future__ import annotations

import argparse
import datetime
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import traceback

os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")

from common import ROOT, COMFY_REV, SAM_REV, PYX_REV, model_dir, save_json, sha256


def configuration(path=None):
    return json.loads((Path(path) if path else ROOT / "presets.json").read_text())


def worker(*args, log):
    from resources import ProcessMonitor
    with open(log, "w") as f:
        command = [sys.executable, str(ROOT / "masking.py"), *map(str, args)]
        print("+", " ".join(command), flush=True)
        process = subprocess.Popen(command, stdout=f, stderr=subprocess.STDOUT)
        monitor = ProcessMonitor(process.pid, Path(log).with_suffix(".resources.json"))
        try:
            process.wait(timeout=1800)
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
            monitor.stop()
    if process.returncode:
        raise RuntimeError(f"Masking worker failed ({process.returncode}); see {log}")


def provenance():
    return {"comfy_revision": COMFY_REV, "sam2_revision": SAM_REV, "pyxelate_revision": PYX_REV,
        "python": sys.version, "model_manifest": json.loads((ROOT / "models.lock.json").read_text()),
        "palette": json.loads((ROOT / "palette.json").read_text()),
        "code_sha256": {p.name: sha256(p) for p in ROOT.glob("*.py")},
        "dependencies": {d.metadata["Name"]: d.version for d in importlib.metadata.distributions()}}


def doctor():
    import torch
    import psutil
    from runtime import device_name, device_metadata
    try:
        device = device_name()
        hardware = device_metadata(device)
    except (RuntimeError, ValueError) as exc:
        device = None
        hardware = {"device": None, "gpu": None, "device_error": str(exc)}
    root = model_dir()
    existing = root
    while not existing.exists():
        existing = existing.parent
    entries = json.loads((ROOT / "models.lock.json").read_text())["models"]
    report = {**hardware, "cuda_available": torch.cuda.is_available(), "mps_available": torch.backends.mps.is_available(),
        "vram_GiB": torch.cuda.get_device_properties(0).total_memory / 2**30 if torch.cuda.is_available() else None,
        "ram_available_GiB": psutil.virtual_memory().available / 2**30,
        "disk_free_GiB": shutil.disk_usage(existing).free / 2**30, "model_dir": str(root),
        "comfy_source_present": (ROOT / "vendor/ComfyUI/main.py").exists(),
        "sam2_source_present": (ROOT / "vendor/sam2/sam2").exists(),
        "models": [{"path": m["path"], "present_with_expected_size": (root / m["path"]).exists()
            and (root / m["path"]).stat().st_size == m["bytes"]} for m in entries]}
    report["ready_for_generation"] = device is not None and all(m["present_with_expected_size"] for m in report["models"]) and report["comfy_source_present"] and report["sam2_source_present"]
    report["note"] = "Size check only. run performs full model checksums before inference."
    save_json(ROOT / "metadata/doctor.json", report)
    print(json.dumps(report, indent=2))
    return report


def prepare(name, preset, config, out):
    from PIL import Image
    from pixels import comparison, fixed_crop, convert
    source = (ROOT / preset["source"]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    worker("source", source, out, "--size", config["generation"]["size"], log=out / "mask.log")
    cutout = Image.open(out / "source-cutout.png").convert("RGBA")
    crops, box = fixed_crop([cutout])
    original = Image.open(source).convert("RGBA").crop(box)
    rows = []
    for size in config["export"]["sizes"]:
        panels = []
        # The unmasked control uses precisely the same crop, scale and palette.
        for method in ("nearest", "conservative"):
            masked = convert(crops[0], size, method, config["export"]["mask_resize"], config["export"]["alpha_threshold"], config["export"].get("color_metric", "ciede2000"))
            masked.save(out / f"{name}-{method}-{size}.png")
            panels.append((method + " masked", masked))
        unmasked = convert(original, size, "conservative", color_metric=config["export"].get("color_metric", "ciede2000"))
        unmasked.save(out / f"{name}-unmasked-{size}.png")
        rows.append((f"{name} / static mask pilot", [("unmasked control", unmasked), *panels]))
    comparison(rows, out / "mask-comparison.png")
    return out / "reference.png"


def postprocess(input_dir, out, name, preset, config, tracking=None, origin="imported RGBA frames"):
    import numpy as np
    from PIL import Image
    from threadpoolctl import threadpool_limits
    from pixels import fixed_crop, convert, select_loop, mask_metrics, quality, export, comparison, ground_anchor
    paths = sorted(Path(input_dir).glob("*.png"))
    if not paths:
        raise ValueError("No ordered PNG frames")
    frames = [Image.open(p).convert("RGBA") for p in paths]
    if any(f.getchannel("A").getextrema() == (255, 255) for f in frames):
        raise ValueError("Postprocess expects masked RGBA frames, not opaque generated RGB")
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    metrics = mask_metrics(frames, preset["anchor"])
    crops, crop = fixed_crop(frames)
    anchor = preset["anchor"]
    pivot = preset["pivot"]
    if anchor == "ground":
        mask = np.asarray(frames[0].getchannel("A")) >= 128
        center, floor = ground_anchor(mask)
        pivot = [(float(center) - crop[0]) / (crop[2] - crop[0]), (int(floor) - crop[1]) / (crop[3] - crop[1])]
    processed = {}
    with threadpool_limits(limits=4):
        for size in config["export"]["sizes"]:
            for method in ("nearest", "conservative"):
                print(f"Pixel conversion: {method}, {size}px, {len(crops)} frames", flush=True)
                processed[(size, method)] = [convert(f, size, method, config["export"]["mask_resize"],
                    config["export"]["alpha_threshold"], config["export"].get("color_metric", "ciede2000")) for f in crops]
    primary = (max(config["export"]["sizes"]), config["export"]["method"])
    gates = {**config["gates"], **preset.get("gates", {})}
    loop = select_loop(processed[primary], config["generation"]["fps"], config["export"]["frames"],
                       min_gap=config["export"].get("min_loop_frames", 12),
                       min_motion=gates["min_motion"], min_shape_motion=gates.get("min_shape_motion", 0))
    qc = quality(metrics, loop, gates, anchor, tracking["min_check_iou"] if tracking else None)
    # Keep both methods on the same selected interval and the same pivot/crop.
    for (size, method), sequence in processed.items():
        method_out = out / f"{method}-{size}"
        all_frames = method_out / "all-frames"
        all_frames.mkdir(parents=True, exist_ok=True)
        for i, frame in enumerate(sequence):
            frame.save(all_frames / f"{i:05d}.png")
        export(sequence, loop, method_out, name, pivot,
               {"qc_passed": qc["passed"], "origin": origin, "method": method, "crop": crop,
                "color_metric": config["export"].get("color_metric", "ciede2000")})
    rows = []
    label = "SYNTHETIC fixture" if "synthetic" in origin.lower() else ("Wan frame" if "Wan" in origin else "imported frame")
    for i in loop["indices"][::2]:
        rows.append((f"{name} / {label} {i} / {'QC PASS' if qc['passed'] else 'REJECTED'}", [
            (f"{method} {size}px", processed[(size, method)][i])
            for size in config["export"]["sizes"] for method in ("nearest", "conservative")]))
    comparison(rows, out / "comparison.png")
    report = {"name": name, "origin": origin, "input_frames": len(paths), "crop": crop, "pivot": pivot,
        "mask_metrics": metrics, "tracking": tracking, "loop": loop, "quality": qc,
        "primary": {"size": primary[0], "method": primary[1], "color_metric": config["export"].get("color_metric", "ciede2000")},
        "input_sha256": {p.name: sha256(p) for p in paths}}
    save_json(out / "report.json", report)
    return report


def run(names, config, output, attempts, port):
    from comfy import generate
    from setup import models
    if not 1 <= attempts <= 5:
        raise ValueError("Attempts must be between 1 and 5")
    # Download is an explicit setup action, never an implicit inference side effect.
    models("all", verify_only=True)
    output.mkdir(parents=True, exist_ok=False)
    save_json(output / "provenance.json", provenance())
    save_json(output / "config.json", config)
    results = {}
    for name in names:
        preset = config["presets"][name]
        subject = output / name
        subject.mkdir()
        print(f"Preparing {name}", flush=True)
        try:
            reference = prepare(name, preset, config, subject / "source")
        except Exception as exc:
            results[name] = {"status": "failed", "stage": "source", "error": str(exc)}
            save_json(output / "results.json", results)
            continue
        attempts_log = []
        for attempt in range(attempts):
            seed = preset["seed"] + attempt
            job = subject / f"attempt-{attempt + 1:02d}-seed-{seed}"
            job.mkdir()
            started = time.monotonic()
            try:
                print(f"Generating {name}, attempt {attempt + 1}, seed {seed}", flush=True)
                raw = generate(reference, job / "motion", preset, config["generation"], seed, port=port)
                worker("track", raw, job / "tracking", log=job / "tracking.log")
                tracking = json.loads((job / "tracking/tracking.json").read_text())
                report = postprocess(job / "tracking/cutouts", job / "export", name, preset, config, tracking,
                                     origin="local Wan2.2 TI2V-5B + BiRefNet + SAM2.1")
                record = {"seed": seed, "seconds": time.monotonic() - started, "path": str(job),
                          "status": "accepted" if report["quality"]["passed"] else "rejected", "quality": report["quality"]}
            except Exception as exc:
                (job / "error.txt").write_text(traceback.format_exc())
                record = {"seed": seed, "seconds": time.monotonic() - started, "path": str(job),
                          "status": "failed", "error": str(exc)}
            attempts_log.append(record)
            save_json(job / "attempt.json", record)
            if record["status"] == "accepted":
                break
        results[name] = {"status": attempts_log[-1]["status"], "attempts": attempts_log}
        save_json(output / "results.json", results)
        from review import build_review
        build_review(output)
    artifacts = {str(p.relative_to(output)): sha256(p) for p in output.rglob("*") if p.is_file() and p.suffix in {".png", ".apng", ".gif", ".json"}}
    save_json(output / "artifacts.sha256.json", artifacts)
    print(json.dumps(results, indent=2))
    return all(r["status"] == "accepted" for r in results.values())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", type=Path, help="Complete config JSON; defaults to presets.json")
    subs = p.add_subparsers(dest="command", required=True)
    subs.add_parser("doctor")
    for command in ("prepare", "run"):
        q = subs.add_parser(command)
        q.add_argument("--preset", default="all")
        q.add_argument("--output", type=Path)
        if command == "run":
            q.add_argument("--attempts", type=int, default=2)
            q.add_argument("--port", type=int, default=8189)
    q = subs.add_parser("process", help="Export an existing ordered directory of masked RGBA PNGs")
    q.add_argument("input", type=Path)
    q.add_argument("output", type=Path)
    q.add_argument("--preset", default="knight-idle")
    a = p.parse_args()
    config = configuration(a.config)
    if a.command == "doctor":
        return 0 if doctor()["ready_for_generation"] else 2
    if a.command == "process":
        report = postprocess(a.input, a.output, a.preset, config["presets"][a.preset], config)
        return 0 if report["quality"]["passed"] else 2
    names = list(config["presets"]) if a.preset == "all" else [a.preset]
    for name in names:
        if name not in config["presets"]:
            p.error(f"Unknown preset {name}; choose all or {list(config['presets'])}")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = a.output.resolve() if a.output else ROOT / "outputs" / f"{a.command}-{stamp}"
    if a.command == "prepare":
        output.mkdir(parents=True, exist_ok=False)
        save_json(output / "provenance.json", provenance())
        save_json(output / "config.json", config)
        for name in names:
            prepare(name, config["presets"][name], config, output / name)
        print(output)
        return 0
    return 0 if run(names, config, output, a.attempts, a.port) else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, FileNotFoundError) as exc:
        print(f"Pipeline stopped: {exc}", file=sys.stderr)
        raise SystemExit(2)
