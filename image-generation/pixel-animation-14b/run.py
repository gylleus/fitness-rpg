#!/usr/bin/env python3
"""Local, resumable 14B pixel-animation experiment using isolated expert stages."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import uuid

os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")
ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent / "sprite-animation"
sys.path.insert(0, str(BASE))
import requests
from common import COMFY_REV, save_json, sha256
from resources import ProcessMonitor
from runtime import configured_device, comfy_flags, inference_timeout


def workflow(reference, preset, settings, stage, latent="handoff.latent"):
    """Same noise/schedule in two processes; no simultaneous high/low RAM residency."""
    side, length = settings["size"], settings["length"]
    if side % 32 or (length - 1) % 4 or stage not in ("high", "low"):
        raise ValueError("Invalid Wan dimensions, length or expert")
    graph = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": f"wan2.2_i2v_{stage}_noise_14B_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan", "device": "cpu"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "wan_2.1_vae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": preset["prompt"]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": preset["negative"]}},
        "6": {"class_type": "LoadImage", "inputs": {"image": reference}},
    }
    if configured_device() == "mps":
        from prepare_macos import model_name
        graph["1"]["inputs"]["unet_name"] = model_name(stage)
    model = ["1", 0]
    if settings.get("distilled", True):
        graph["12"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": model,
            "lora_name": f"wan2.2_i2v_lightx2v_4steps_lora_v1_{stage}_noise.safetensors", "strength_model": 1.0}}
        model = ["12", 0]
    if settings["pixel_lora"]:
        graph["13"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": model,
            "lora_name": "wan2.2_animate_adapter_model.safetensors", "strength_model": settings["pixel_lora"]}}
        model = ["13", 0]
    graph["7"] = {"class_type": "ModelSamplingSD3", "inputs": {"model": model, "shift": settings["shift"]}}
    conditioning = {"positive": ["4", 0], "negative": ["5", 0], "vae": ["3", 0],
        "start_image": ["6", 0], "width": side, "height": side, "length": length, "batch_size": 1}
    if settings.get("end_condition", False):
        conditioning["end_image"] = ["6", 0]
    graph["8"] = {"class_type": "WanFirstLastFrameToVideo" if settings.get("end_condition") else "WanImageToVideo", "inputs": conditioning}
    source = ["8", 2]
    if stage == "low":
        graph["14"] = {"class_type": "LoadLatent", "inputs": {"latent": latent}}
        source = ["14", 0]
    graph["9"] = {"class_type": "KSamplerAdvanced", "inputs": {"model": ["7", 0],
        "positive": ["8", 0], "negative": ["8", 1], "latent_image": source,
        "noise_seed": settings["seed"], "steps": settings["steps"], "cfg": settings["cfg"],
        "sampler_name": settings["sampler"], "scheduler": "simple",
        "add_noise": "enable" if stage == "high" else "disable",
        "start_at_step": 0 if stage == "high" else settings["split_step"],
        "end_at_step": settings["split_step"] if stage == "high" else settings["steps"],
        "return_with_leftover_noise": "enable" if stage == "high" else "disable"}}
    if stage == "high":
        graph["11"] = {"class_type": "SaveLatent", "inputs": {"samples": ["9", 0], "filename_prefix": "handoff"}}
    else:
        graph["10"] = {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["3", 0]}}
        graph["11"] = {"class_type": "SaveImage", "inputs": {"images": ["10", 0], "filename_prefix": "wan14b"}}
    return graph


@contextmanager
def server(out, port=8190):
    from runtime import device_name
    device_name()  # Fail before launching ComfyUI if the requested GPU is absent.
    if configured_device() == "mps":
        from prepare_macos import prepare
        prepare(verify_only=True)
    for sub in ("input", "output", "user"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    with socket.socket() as sock:
        if sock.connect_ex(("127.0.0.1", port)) == 0:
            raise RuntimeError(f"Port {port} already used; will not control unrelated server")
    paths = out / "model-paths.json"
    save_json(paths, {"pixel14b": {"base_path": str(ROOT / "models"),
        "diffusion_models": "diffusion_models", "loras": "loras", "vae": "vae",
        "text_encoders": str(BASE / "models/comfy/text_encoders")}})
    cmd = [sys.executable, str(BASE / "vendor/ComfyUI/main.py"), "--listen", "127.0.0.1", "--port", str(port),
        "--disable-auto-launch", "--disable-all-custom-nodes", "--preview-method", "none", *comfy_flags(),
        "--extra-model-paths-config", str(paths), "--input-directory", str(out / "input"),
        "--output-directory", str(out / "output"), "--user-directory", str(out / "user"),
        "--database-url", "sqlite:///" + str(out / "user/comfy.db")]
    save_json(out / "command.json", cmd)
    with (out / "comfy.log").open("w") as log:
        proc = subprocess.Popen(cmd, cwd=BASE / "vendor/ComfyUI", stdout=log, stderr=subprocess.STDOUT)
        monitor = ProcessMonitor(proc.pid, out / "resources.json")
        url = f"http://127.0.0.1:{port}"
        try:
            until = time.monotonic() + 180
            while time.monotonic() < until:
                if proc.poll() is not None:
                    raise RuntimeError(f"ComfyUI exited {proc.returncode}: {out / 'comfy.log'}")
                try:
                    r = requests.get(url + "/object_info", timeout=3)
                    r.raise_for_status()
                    break
                except requests.RequestException:
                    time.sleep(1)
            else:
                raise TimeoutError("Server startup timed out")
            yield url, proc
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=10)
            monitor.stop()


def execute_stage(out, reference, preset, settings, stage, handoff=None, port=8190):
    out.mkdir(parents=True, exist_ok=True)
    (out / "input").mkdir(exist_ok=True)
    shutil.copyfile(reference, out / "input/reference.png")
    if handoff:
        shutil.copyfile(handoff, out / "input/handoff.latent")
    graph = workflow("reference.png", preset, settings, stage)
    save_json(out / "workflow-api.json", graph)
    started = time.monotonic()
    with server(out, port) as (url, proc):
        r = requests.post(url + "/prompt", json={"prompt": graph, "client_id": str(uuid.uuid4())}, timeout=30)
        save_json(out / "submission.json", r.json())
        r.raise_for_status()
        prompt_id = r.json()["prompt_id"]
        deadline = time.monotonic() + inference_timeout()
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"ComfyUI died ({proc.returncode}), see {out / 'comfy.log'}")
            r = requests.get(url + f"/history/{prompt_id}", timeout=30)
            r.raise_for_status()
            result = r.json().get(prompt_id)
            if result:
                save_json(out / "history.json", result)
                status = result.get("status", {})
                if status.get("status_str") == "error":
                    raise RuntimeError(f"Inference failed; see {out / 'history.json'}")
                if status.get("completed"):
                    break
            time.sleep(2)
        else:
            raise TimeoutError("Expert exceeded SPRITE_INFERENCE_TIMEOUT")
    key = "latents" if stage == "high" else "images"
    items = result["outputs"]["11"][key]
    if len(items) != (1 if stage == "high" else settings["length"]):
        raise RuntimeError("Unexpected output frame/latent count")
    paths = [out / "output" / d["subfolder"] / d["filename"] for d in items]
    save_json(out / "completed.json", {"seconds": time.monotonic() - started,
        "files": {str(p.relative_to(out)): sha256(p) for p in paths}})
    return paths


def run(config_path, job_name, port=8190):
    config = json.loads(config_path.read_text())
    job = config["jobs"][job_name]
    settings = {**config["generation"], **job.get("generation", {})}
    preset = config["presets"][job["preset"]]
    reference = (ROOT / preset["reference"]).resolve()
    out = ROOT / "outputs" / job_name
    out.mkdir(parents=True, exist_ok=True)
    contract = {"preset": preset, "generation": settings, "job": job,
        "reference_sha256": sha256(reference), "model_manifest_sha256": sha256(ROOT / "models.lock.json")}
    old = out / "config.json"
    if old.exists() and json.loads(old.read_text()) != contract:
        raise RuntimeError("Existing job has different settings; choose a new job name")
    save_json(old, contract)
    save_json(out / "provenance.json", {"comfy_revision": COMFY_REV,
        "models": json.loads((ROOT / "models.lock.json").read_text()),
        "python": sys.version, "dependencies": {d.metadata["Name"]: d.version for d in importlib.metadata.distributions()},
        "code": {p.name: sha256(p) for p in ROOT.glob("*.py")},
        "reused_code": {str(p.relative_to(BASE)): sha256(p) for p in BASE.glob("*.py")},
        "palette_sha256": sha256(BASE / "palette.json"),
        "conditioning": "Native Wan conditioning, no PainterI2V amplification; end condition is experimental for this I2V checkpoint."})
    shutil.copyfile(reference, out / "reference.png")
    stages = {}
    handoff = None
    for stage in ("high", "low"):
        stage_out = out / stage
        record = stage_out / "completed.json"
        if record.exists():
            saved = json.loads(record.read_text())
            paths = [stage_out / p for p in saved["files"]]
            if any(not p.exists() or sha256(p) != saved["files"][str(p.relative_to(stage_out))] for p in paths):
                raise RuntimeError("Existing stage output hash mismatch")
        else:
            print(f"{job_name}: {stage} expert", flush=True)
            paths = execute_stage(stage_out, reference, preset, settings, stage, handoff, port)
        stages[stage] = json.loads(record.read_text())
        if stage == "high":
            handoff = paths[0]
    frames = out / "frames"
    frames.mkdir(exist_ok=True)
    for i, source in enumerate(paths):
        target = frames / f"{i:05d}.png"
        if not target.exists():
            os.link(source, target)
    save_json(out / "generation.json", {**contract, "stages": stages, "frames": len(paths),
        "seconds": sum(s["seconds"] for s in stages.values()), "reference_sha256": sha256(reference),
        "note": "High/low experts run in separate processes; raw PNGs retained. Completion is not an art-quality approval."})
    print(f"Generated {len(paths)} frames: {frames}", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("job")
    p.add_argument("--config", type=Path, default=ROOT / "config.json")
    p.add_argument("--port", type=int, default=8190)
    a = p.parse_args()
    run(a.config.resolve(), a.job, a.port)
