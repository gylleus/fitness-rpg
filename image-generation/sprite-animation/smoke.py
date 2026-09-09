#!/usr/bin/env python3
"""Real API and tracker integration checks that don't require Wan weights.

The tracker fixture repeats/translates the real masked knight reference. This is
explicitly a synthetic test sequence, not an AI-generated animation result.
"""
import argparse
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image
import requests

from common import ROOT, save_json
from comfy import server, workflow
from pipeline import configuration, worker, postprocess


def api():
    out = ROOT / "outputs/comfy-smoke"
    with server(out, 8189) as (url, info):
        config = configuration()
        graph = workflow("reference.png", "test", "", config["generation"], 1)
        for node in graph.values():
            cls = node["class_type"]
            declared = info[cls]["input"]
            assert set(declared.get("required", {})) <= set(node["inputs"]), cls
            assert set(node["inputs"]) <= set(declared.get("required", {})) | set(declared.get("optional", {})), cls
        source = Image.new("RGBA", (64, 64), "#0099db")
        source.putpixel((1, 2), (255, 255, 255, 255))
        source.save(out / "api-input.png")
        with (out / "api-input.png").open("rb") as f:
            r = requests.post(url + "/upload/image", files={"image": ("api-input.png", f, "image/png")}, timeout=30)
        r.raise_for_status()
        minimal = {"1": {"class_type": "LoadImage", "inputs": {"image": r.json()["name"]}},
                   "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "api-smoke"}}}
        r = requests.post(url + "/prompt", json={"prompt": minimal}, timeout=30)
        r.raise_for_status()
        prompt_id = r.json()["prompt_id"]
        end = time.monotonic() + 60
        while time.monotonic() < end:
            r = requests.get(url + f"/history/{prompt_id}", timeout=10)
            r.raise_for_status()
            history = r.json().get(prompt_id)
            if history:
                break
            time.sleep(0.5)
        else:
            raise TimeoutError("API smoke prompt timed out")
        assert history["status"]["completed"], history
        image = history["outputs"]["2"]["images"][0]
        r = requests.get(url + "/view", params=image, timeout=30)
        r.raise_for_status()
        path = out / "api-output.png"
        path.write_bytes(r.content)
        np.testing.assert_array_equal(np.array(source.convert("RGB")), np.array(Image.open(path).convert("RGB")))
        save_json(ROOT / "metadata/comfy-api-smoke.json", {"required_inputs_valid": True,
            "upload_queue_history_download_roundtrip": True, "pixels_unchanged": True,
            "wan_models_loaded": False, "nodes": sorted({n["class_type"] for n in graph.values()})})
    print("Comfy API round trip passed; owned process stopped.", flush=True)


def tracking():
    source = ROOT / "outputs/mask-pilot/knight-idle/reference-cutout.png"
    if not source.exists():
        raise RuntimeError("Run pipeline.py prepare --output outputs/mask-pilot first")
    out = ROOT / "outputs/tracker-smoke"
    raw = out / "frames"
    raw.mkdir(parents=True, exist_ok=True)
    reference = Image.open(source).convert("RGBA")
    for i in range(17):
        frame = Image.new("RGBA", reference.size, "#8b9bb4")
        frame.alpha_composite(reference, (round(3 * np.sin(i * np.pi / 8)), 0))
        frame.convert("RGB").save(raw / f"{i:05d}.png")
    save_json(out / "fixture.json", {"origin": "synthetic translated existing knight cutout",
        "purpose": "BiRefNet/SAM2 and full exporter integration; NOT generated motion", "frames": 17})
    worker("track", raw, out / "tracking", log=out / "tracking.log")
    tracking_record = json.loads((out / "tracking/tracking.json").read_text())
    config = configuration()
    report = postprocess(out / "tracking/cutouts", out / "export", "knight-idle",
        config["presets"]["knight-idle"], config, tracking_record,
        origin="synthetic translation of an existing knight cutout; integration fixture, NOT Wan output")
    assert report["input_frames"] == 17
    assert tracking_record["min_check_iou"] > 0.6, tracking_record
    save_json(ROOT / "metadata/tracker-smoke.json", {"integration_completed": True,
        "fixture": "synthetic translation; NOT a generated animation", "tracking": tracking_record,
        "quality_gate_result": report["quality"], "exported_frames_per_sheet": 8,
        "sizes": [64, 128], "methods": ["nearest", "conservative"]})
    print("Tracker/export integration completed on synthetic fixture.", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("stage", choices=["api", "tracking"])
    args = p.parse_args()
    api() if args.stage == "api" else tracking()
