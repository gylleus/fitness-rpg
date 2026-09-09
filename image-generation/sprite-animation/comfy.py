"""Owned loopback ComfyUI process and native Wan 2.2 TI2V-5B API workflow."""
from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid

import requests

from common import ROOT, model_dir, save_json
from resources import ProcessMonitor


def workflow(reference, prompt, negative, settings, seed):
    size, length = settings["size"], settings["length"]
    if size % 32 or (length - 1) % 4:
        raise ValueError("Wan size must be divisible by 32; length must be 4n+1")
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "wan2.2_ti2v_5B_fp16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "wan2.2_vae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": negative}},
        "6": {"class_type": "LoadImage", "inputs": {"image": reference}},
        "7": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["1", 0], "shift": settings["shift"]}},
        "8": {"class_type": "Wan22ImageToVideoLatent", "inputs": {"vae": ["3", 0], "start_image": ["6", 0],
              "width": size, "height": size, "length": length, "batch_size": 1}},
        "9": {"class_type": "KSampler", "inputs": {"model": ["7", 0], "positive": ["4", 0], "negative": ["5", 0],
              "latent_image": ["8", 0], "seed": seed, "steps": settings["steps"], "cfg": settings["cfg"],
              "sampler_name": "uni_pc", "scheduler": "simple", "denoise": 1.0}},
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["3", 0]}},
        "11": {"class_type": "SaveImage", "inputs": {"images": ["10", 0], "filename_prefix": "wan"}},
    }


@contextmanager
def server(out, port=8189):
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    for directory in ("comfy-output", "comfy-input", "comfy-user"):
        (out / directory).mkdir(exist_ok=True)
    with socket.socket() as sock:
        if sock.connect_ex(("127.0.0.1", port)) == 0:
            raise RuntimeError(f"Port {port} is in use. Choose another --port; this pipeline never controls an unrelated server.")
    model_config = out / "extra-model-paths.json"
    # JSON is valid YAML and safely quotes paths with spaces.
    save_json(model_config, {"sprite_animation": {"base_path": str(model_dir() / "comfy"),
        "diffusion_models": "diffusion_models", "text_encoders": "text_encoders", "vae": "vae"}})
    command = [sys.executable, str(ROOT / "vendor/ComfyUI/main.py"), "--listen", "127.0.0.1",
        "--port", str(port), "--disable-auto-launch", "--disable-all-custom-nodes",
        "--preview-method", "none", "--lowvram", "--reserve-vram", "1",
        "--extra-model-paths-config", str(model_config), "--output-directory", str(out / "comfy-output"),
        "--input-directory", str(out / "comfy-input"), "--user-directory", str(out / "comfy-user"),
        "--database-url", "sqlite:///" + str(out / "comfy-user/comfyui.db")]
    save_json(out / "server-command.json", command)
    log = (out / "comfy.log").open("w")
    process = subprocess.Popen(command, cwd=ROOT / "vendor/ComfyUI", stdout=log, stderr=subprocess.STDOUT)
    monitor = ProcessMonitor(process.pid, out / "resources.json")
    url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"ComfyUI exited {process.returncode}; see {out / 'comfy.log'}")
            try:
                r = requests.get(url + "/object_info", timeout=3)
                r.raise_for_status()
                info = r.json()
                save_json(out / "object-info.json", info)
                break
            except requests.RequestException:
                time.sleep(1)
        else:
            raise TimeoutError("ComfyUI startup exceeded 180 seconds")
        yield url, info
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        log.close()
        monitor.stop()


def generate(reference, out, preset, settings, seed, port=8189, timeout=3600):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with server(out, port) as (url, info):
        with open(reference, "rb") as f:
            r = requests.post(url + "/upload/image", files={"image": ("reference.png", f, "image/png")},
                              data={"overwrite": "true"}, timeout=60)
        r.raise_for_status()
        upload = r.json()
        image_name = (upload.get("subfolder", "").rstrip("/") + "/" + upload["name"]).lstrip("/")
        graph = workflow(image_name, preset["prompt"], preset["negative"], settings, seed)
        missing = {n["class_type"] for n in graph.values()} - set(info)
        if missing:
            raise RuntimeError(f"ComfyUI missing required nodes: {missing}")
        save_json(out / "workflow-api.json", graph)
        r = requests.post(url + "/prompt", json={"prompt": graph, "client_id": str(uuid.uuid4())}, timeout=60)
        if not r.ok:
            save_json(out / "submission-error.json", r.json())
        r.raise_for_status()
        submitted = r.json()
        save_json(out / "submission.json", submitted)
        prompt_id = submitted["prompt_id"]
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            r = requests.get(url + f"/history/{prompt_id}", timeout=30)
            r.raise_for_status()
            history = r.json().get(prompt_id)
            if history:
                save_json(out / "history.json", history)
                if history.get("status", {}).get("status_str") == "error":
                    raise RuntimeError(f"Wan generation failed; see {out / 'history.json'}")
                if history.get("status", {}).get("completed"):
                    break
            time.sleep(2)
        else:
            raise TimeoutError(f"Generation exceeded {timeout}s; owned ComfyUI process will be stopped")
        images = history.get("outputs", {}).get("11", {}).get("images", [])
        if len(images) != settings["length"]:
            raise RuntimeError(f"Expected {settings['length']} generated frames; got {len(images)}")
        frames = out / "frames"
        frames.mkdir(exist_ok=True)
        for i, descriptor in enumerate(images):
            r = requests.get(url + "/view", params=descriptor, timeout=60)
            r.raise_for_status()
            (frames / f"{i:05d}.png").write_bytes(r.content)
        save_json(out / "generation.json", {"seed": seed, "settings": settings,
            "prompt": preset["prompt"], "negative": preset["negative"],
            "seconds": time.monotonic() - started, "frames": len(images), "transport": "lossless PNG"})
    # Exiting the owned server releases diffusion/T5/VAE VRAM before SAM2.
    return frames
