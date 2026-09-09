"""Generate the fixed sample set locally; never replaces an existing original."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(ROOT / ".cache/huggingface"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

import hashlib
import importlib.metadata
import json
import platform
import subprocess
import time
from datetime import datetime, timezone

import torch
from diffusers import AutoencoderKL, DPMSolverMultistepScheduler, StableDiffusionXLPipeline
from PIL.PngImagePlugin import PngInfo


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-models", action="store_true", help="Load the local model/LoRA/VAE on CPU without generating")
    args = parser.parse_args()
    config = json.loads((ROOT / "config.json").read_text())
    if not args.check_models:
        assert torch.cuda.is_available(), "CUDA is required: run in a terminal/session with access to /dev/nvidia*"
    torch.set_num_threads(4)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True)
    vae = AutoencoderKL.from_pretrained(ROOT / "models/vae", torch_dtype=torch.float16, local_files_only=True)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        ROOT / "models/sdxl", vae=vae, variant="fp16", torch_dtype=torch.float16,
        use_safetensors=True, local_files_only=True, add_watermarker=False,
    )
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(
        pipe.scheduler.config, algorithm_type="dpmsolver++", solver_order=2, use_karras_sigmas=True,
    )
    pipe.load_lora_weights(str(ROOT / "models/pixel-art-xl"), weight_name="pixel-art-xl.safetensors", adapter_name="pixel")
    pipe.set_adapters("pixel", adapter_weights=config["lora"]["weight"])
    if args.check_models:
        print("PASS: local SDXL + fixed VAE + Pixel Art XL loaded; scheduler and LoRA configured. No images generated.")
        return
    pipe.to("cuda")
    metadata = {
        "utc": datetime.now(timezone.utc).isoformat(), "python": platform.python_version(),
        "platform": platform.platform(), "gpu": torch.cuda.get_device_name(),
        "vram_bytes": torch.cuda.get_device_properties(0).total_memory,
        "torch_cuda": torch.version.cuda, "deterministic_algorithms": True,
        "tf32": False, "generator_device": "cpu", "watermarker": False,
        "scheduler_config": dict(pipe.scheduler.config), "configuration": config,
        "packages": {p: importlib.metadata.version(p) for p in ["torch", "diffusers", "transformers", "accelerate", "peft", "safetensors", "numpy", "pillow"]},
    }
    (ROOT / "metadata/generation-environment.json").write_text(json.dumps(metadata, indent=2) + "\n")
    (ROOT / "metadata/nvidia-smi.txt").write_text(subprocess.check_output(["nvidia-smi"], text=True))
    for asset in config["assets"]:
        path = ROOT / "originals" / (asset["name"] + ".png")
        if path.exists():
            print("Skipping existing", path.name, flush=True)
            continue
        print("Generating", asset["name"], "seed", asset["seed"], flush=True)
        started = time.monotonic()
        torch.cuda.reset_peak_memory_stats()
        kwargs = {k: config["generation"][k] for k in ["width", "height", "num_inference_steps", "guidance_scale"]}
        image = pipe(
            asset["prompt"], negative_prompt=config["negative_prompt"],
            generator=torch.Generator(device="cpu").manual_seed(asset["seed"]), **kwargs,
        ).images[0]
        record = {**asset, **kwargs, "negative_prompt": config["negative_prompt"],
                  "seconds": time.monotonic() - started,
                  "peak_allocated_bytes": torch.cuda.max_memory_allocated(),
                  "mode": image.mode, "size": list(image.size)}
        info = PngInfo()
        info.add_text("generation", json.dumps(record))
        image.save(path, pnginfo=info)
        record["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        (ROOT / "originals" / (asset["name"] + ".json")).write_text(json.dumps(record, indent=2) + "\n")
        print("Saved", path.name, round(record["seconds"], 1), "s", flush=True)


if __name__ == "__main__":
    main()
