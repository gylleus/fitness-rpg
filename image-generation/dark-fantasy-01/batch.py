"""Local SDXL dark fantasy batch; reuse the installed study environment/weights."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STUDY = ROOT.parent / "pyxelate-study"
os.environ.setdefault("HF_HOME", str(STUDY / ".cache/huggingface"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

import argparse
import hashlib
import importlib.metadata
import json
import platform
import sys
import time
import zipfile
from datetime import datetime, timezone


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate(config, check_only=False):
    import torch
    hardware = {"utc": datetime.now(timezone.utc).isoformat(),
                "python": platform.python_version(), "torch": torch.__version__,
                "cuda_available": torch.cuda.is_available(), "torch_cuda": torch.version.cuda}
    if hardware["cuda_available"]:
        hardware.update(gpu=torch.cuda.get_device_name(),
                        vram_bytes=torch.cuda.get_device_properties(0).total_memory)
    save_json(ROOT / "metadata/hardware-check.json", hardware)
    if not hardware["cuda_available"]:
        raise SystemExit("GPU unavailable to this process. Run bash run.sh in a terminal with CUDA device access. No images generated.")
    if check_only:
        print(json.dumps(hardware, indent=2))
        return

    from diffusers import AutoencoderKL, DPMSolverMultistepScheduler, StableDiffusionXLPipeline
    from PIL.PngImagePlugin import PngInfo

    torch.set_num_threads(4)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True)
    vae = AutoencoderKL.from_pretrained(STUDY / "models/vae", torch_dtype=torch.float16, local_files_only=True)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        STUDY / "models/sdxl", vae=vae, variant="fp16", torch_dtype=torch.float16,
        use_safetensors=True, local_files_only=True, add_watermarker=False)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(
        pipe.scheduler.config, algorithm_type="dpmsolver++", solver_order=2, use_karras_sigmas=True)
    pipe.load_lora_weights(str(STUDY / "models/pixel-art-xl"),
                           weight_name="pixel-art-xl.safetensors", adapter_name="pixel")
    pipe.set_adapters("pixel", adapter_weights=config["lora"]["weight"])
    pipe.to("cuda")
    environment = {**hardware, "configuration": config,
                   "scheduler_config": dict(pipe.scheduler.config), "generator_device": "cpu",
                   "deterministic_algorithms": True, "tf32": False, "watermarker": False,
                   "packages": {p: importlib.metadata.version(p) for p in
                                ["torch", "diffusers", "transformers", "accelerate", "peft", "numpy", "pillow"]}}
    environment_path = ROOT / "metadata/generation-environment.json"
    if environment_path.exists():
        previous = json.loads(environment_path.read_text())
        if previous["configuration"] != config:
            raise SystemExit("Config changed since generation. Use a new batch directory to preserve provenance.")
    else:
        save_json(environment_path, environment)
    for asset in config["assets"]:
        path = ROOT / "originals" / f"{asset['name']}.png"
        if path.exists():
            record = json.loads(path.with_suffix(".json").read_text())
            assert digest(path) == record["sha256"], f"Original changed: {path}"
            print("Keeping existing", asset["name"], flush=True)
            continue
        print("Generating", asset["name"], "seed", asset["seed"], flush=True)
        started = time.monotonic()
        torch.cuda.reset_peak_memory_stats()
        settings = {k: config["generation"][k] for k in
                    ["width", "height", "num_inference_steps", "guidance_scale"]}
        result = pipe(asset["prompt"], negative_prompt=config["negative_prompt"],
                      generator=torch.Generator(device="cpu").manual_seed(asset["seed"]), **settings).images[0]
        record = {**asset, **settings, "negative_prompt": config["negative_prompt"],
                  "seconds": time.monotonic()-started, "size": list(result.size), "mode": result.mode,
                  "peak_allocated_bytes": torch.cuda.max_memory_allocated()}
        info = PngInfo()
        info.add_text("generation", json.dumps(record))
        path.parent.mkdir(parents=True, exist_ok=True)
        result.save(path, pnginfo=info)
        record["sha256"] = digest(path)
        save_json(path.with_suffix(".json"), record)
        print("Saved", path.name, round(record["seconds"], 1), "seconds", flush=True)


def refine():
    """Keep targeted rerolls and their provenance separate from first-seed originals."""
    global ROOT
    parent = ROOT
    config = json.loads((parent / "refinements.json").read_text())
    ROOT = parent / "variants/refinements"
    try:
        generate(config)
    finally:
        ROOT = parent


def process(config):
    import numpy as np
    from PIL import Image, ImageDraw
    from threadpoolctl import threadpool_limits
    sys.path.insert(0, str(STUDY))
    from fixed_palette import conservative_pixelate
    from process import fit_size, font, map_palette

    palette = json.loads((ROOT / "palette.json").read_text())
    colors = np.array([list(bytes.fromhex(h.lstrip("#"))) for h in palette["colors"]], dtype=np.uint8)
    allowed = set(map(tuple, colors))
    selection_path = ROOT / "selection.json"
    selection = json.loads(selection_path.read_text()) if selection_path.exists() else {}
    assets = []
    for asset in config["assets"]:
        source_path = selection.get(asset["name"], {}).get("path", f"originals/{asset['name']}.png")
        source_record = json.loads((ROOT / source_path).with_suffix(".json").read_text())
        assert source_record["sha256"] == digest(ROOT / source_path)
        assets.append({**asset, "seed": source_record["seed"], "source_path": source_path})
    records = []
    with threadpool_limits(limits=4):
        for asset in assets:
            with Image.open(ROOT / asset["source_path"]) as opened:
                source = opened.convert("RGB")
            for bound in [64, 128]:
                size = fit_size(source.size, bound)
                nearest = map_palette(source.resize(size, Image.Resampling.NEAREST), colors)
                custom = conservative_pixelate(source, colors, bound)
                for mode, result in [("nearest", nearest), ("conservative", custom)]:
                    path = ROOT / f"processed/{bound}/{mode}/{asset['name']}.png"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    assert result.size == size
                    used = set(map(tuple, np.asarray(result).reshape(-1, 3)))
                    assert used <= allowed
                    result.save(path)
                    records.append({"path": str(path.relative_to(ROOT)), "size": list(result.size),
                                    "source_path": asset["source_path"], "seed": asset["seed"],
                                    "colors": len(used), "sha256": digest(path)})
            print("Processed", asset["name"], flush=True)

    # One compact gallery per mode; each native 128px result displays at exactly 3x.
    (ROOT / "sheets").mkdir(exist_ok=True)
    for mode in ["originals", "nearest", "conservative"]:
        sheet = Image.new("RGB", (1656, 1476), "#181425")
        draw = ImageDraw.Draw(sheet)
        title = "Originals / 1024px sources shown at 384px" if mode == "originals" else f"ENDESGA 32 / {mode} / 128px at 3x nearest"
        draw.text((24, 18), "Dark fantasy 01 | " + title, font=font(25), fill="#ead4aa")
        for i, color in enumerate(palette["colors"]):
            x = 24 + i*50
            draw.rectangle((x, 62, x+44, 82), fill=color)
        for i, asset in enumerate(assets):
            x, y = 24+(i%4)*408, 118+(i//4)*448
            path = (ROOT / asset["source_path"] if mode == "originals" else
                    ROOT / f"processed/128/{mode}/{asset['name']}.png")
            with Image.open(path) as im:
                sheet.paste(im.resize((384,384), Image.Resampling.NEAREST), (x,y))
            draw.text((x,y+394), asset["name"].replace("_", " ").title(), font=font(22), fill="#c0cbdc")
            draw.text((x,y+422), f"{asset['kind']} | seed {asset['seed']}", font=font(16), fill="#8b9bb4")
        sheet.save(ROOT / f"sheets/{mode}.png")
    save_json(ROOT / "metadata/processing.json", {
        "palette": palette, "artifacts": records, "selection": selection, "dither": "none",
        "nearest": "Nearest-neighbor resizing, then nearest CIELAB palette color (Delta E 76).",
        "conservative": "Custom pinned Pyxelate HSV median/Sobel reduction; no SVD or CLAHE/brightness boost; nearest CIELAB assignment. Not stock Pyxelate.",
        "background_removal": False, "alpha": "RGB opaque sources; no transparency is created.",
        "helper_sha256": {p: digest(STUDY / p) for p in ["fixed_palette.py", "process.py"]},
        "packages": {p: importlib.metadata.version(p) for p in
                     ["pyxelate", "numpy", "pillow", "scikit-image", "scikit-learn", "numba"]}})
    print("All", len(records), "outputs passed exact palette and dimension checks.")


def package():
    paths = sorted(p for p in ROOT.rglob("*") if p.is_file() and
                   p.suffix not in [".zip", ".pyc"] and "__pycache__" not in p.parts and
                   p.name != "checksums.json" and "logs" not in p.parts)
    manifest = ROOT / "metadata/checksums.json"
    save_json(manifest, {str(p.relative_to(ROOT)): digest(p) for p in paths})
    archive = ROOT / "dark-fantasy-01.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for p in paths + [manifest]:
            z.write(p, str(p.relative_to(ROOT.parent)))
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
    print("Saved", archive.name, "with verified ZIP integrity.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "generate", "refine", "process", "package", "all"], default="all", nargs="?")
    args = parser.parse_args()
    config = json.loads((ROOT / "config.json").read_text())
    if args.command in ["check", "generate", "all"]:
        generate(config, check_only=args.command == "check")
    if args.command in ["refine", "all"]:
        refine()
    if args.command in ["process", "all"]:
        process(config)
    if args.command in ["package", "all"]:
        package()


if __name__ == "__main__":
    main()
