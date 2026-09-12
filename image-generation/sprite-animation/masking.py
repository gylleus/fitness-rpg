"""Subprocess workers: automatic BiRefNet extraction and SAM2 mask propagation."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import numpy as np
from PIL import Image

from common import ROOT, model_dir, save_json, sha256


def biref_session():
    from rembg import new_session
    root = model_dir() / "rembg"
    if not (root / "birefnet-general.onnx").exists():
        raise RuntimeError("Missing BiRefNet weights: run setup.py --models segmentation")
    os.environ["U2NET_HOME"] = str(root)
    os.environ["OMP_NUM_THREADS"] = "4"
    return new_session("birefnet-general", providers=["CPUExecutionProvider"])


def extract(image, session):
    if image.mode == "RGBA" and image.getchannel("A").getextrema()[0] < 255:
        return image.copy(), "existing-alpha"
    mask = session.predict(image.convert("RGB"))[0]
    rgba = image.convert("RGBA")
    rgba.putalpha(mask)
    if not (np.asarray(mask) >= 128).any():
        raise RuntimeError("BiRefNet returned an empty foreground")
    return rgba, "birefnet-general"


def source(input_path, out, size=512, background="#8b9bb4"):
    from pixels import fixed_crop, extend_foreground
    out.mkdir(parents=True, exist_ok=True)
    im = Image.open(input_path)
    needs_mask = im.mode != "RGBA" or im.getchannel("A").getextrema()[0] == 255
    rgba, method = extract(im, biref_session() if needs_mask else None)
    rgba.save(out / "source-cutout.png")
    rgba.getchannel("A").save(out / "source-mask.png")
    fitted, box = fixed_crop([rgba], margin=0.14)
    fitted = fitted[0]
    # Prematted RGB does not survive untouched: replace mixed edge RGB first.
    cleaned = extend_foreground(fitted).convert("RGBA")
    cleaned.putalpha(fitted.getchannel("A"))
    cleaned = cleaned.resize((size, size), Image.Resampling.LANCZOS)
    cleaned.save(out / "reference-cutout.png")
    composite = Image.new("RGBA", (size, size), background)
    composite.alpha_composite(cleaned)
    composite.convert("RGB").save(out / "reference.png")
    save_json(out / "source.json", {"input": str(input_path), "sha256": sha256(input_path),
        "mask_method": method, "generation_reference_crop": box, "background": background,
        "size": size, "note": "Source soft alpha retained. Mixed edge RGB extended from confident foreground."})


def track(input_dir, out, check_every=8):
    import torch
    from sam2.build_sam import build_sam2_video_predictor
    from runtime import device_name, tracking_context
    device = device_name()
    paths = sorted(input_dir.glob("*.png"))
    if len(paths) < 2:
        raise ValueError("Tracking requires at least two ordered PNG frames")
    if type(check_every) is not int or check_every < 1:
        raise ValueError("check_every must be a positive integer")
    sizes = {Image.open(p).size for p in paths}
    if len(sizes) != 1:
        raise ValueError("Generated frame dimensions differ")
    out.mkdir(parents=True, exist_ok=True)
    # BiRefNet is CPU-only; discard its session before allocating SAM on GPU.
    session = biref_session()
    checks = sorted(set([0, len(paths) - 1, *range(0, len(paths), check_every)]))
    check_masks = {}
    for i in checks:
        rgba, _ = extract(Image.open(paths[i]).convert("RGB"), session)
        check_masks[i] = np.asarray(rgba.getchannel("A")) >= 128
        rgba.getchannel("A").save(out / f"biref-check-{i:05d}.png")
    del session
    # SAM2's pinned loader filters .jpg suffixes, but Pillow detects file content.
    # Lossless PNG hardlinks with numeric .jpg names avoid a JPEG round trip.
    sam_input = out / "sam-input"
    sam_input.mkdir(exist_ok=True)
    for i, path in enumerate(paths):
        dest = sam_input / f"{i:05d}.jpg"
        if not dest.exists():
            os.link(path, dest)
    checkpoint = model_dir() / "sam2/sam2.1_hiera_tiny.pt"
    if not checkpoint.exists():
        raise RuntimeError("Missing SAM2 checkpoint")
    predictor = build_sam2_video_predictor("configs/sam2.1/sam2.1_hiera_t.yaml",
        str(checkpoint), device=device, apply_postprocessing=False)
    agreement = {}
    with torch.inference_mode(), tracking_context(device):
        state = predictor.init_state(str(sam_input), offload_video_to_cpu=True,
                                     offload_state_to_cpu=True)
        predictor.add_new_mask(state, frame_idx=0, obj_id=1, mask=check_masks[0])
        cutouts = out / "cutouts"
        cutouts.mkdir(exist_ok=True)
        masks = out / "masks"
        masks.mkdir(exist_ok=True)
        for i, ids, logits in predictor.propagate_in_video(state):
            probability = torch.sigmoid(logits[0, 0]).float().cpu().numpy()
            foreground = probability >= 0.5
            if i in check_masks:
                reference = check_masks[i]
                agreement[str(i)] = float((foreground & reference).sum() / max(1, (foreground | reference).sum()))
            mask = Image.fromarray(np.rint(probability * 255).astype(np.uint8), "L")
            rgba = Image.open(paths[i]).convert("RGBA")
            rgba.putalpha(mask)
            rgba.save(cutouts / f"{i:05d}.png")
            mask.save(masks / f"{i:05d}.png")
    save_json(out / "tracking.json", {"tracker": "SAM2.1 Hiera tiny", "device": device, "initialization": "BiRefNet mask, frame 0",
        "check_every": check_every, "check_indices": checks,
        "frames": len(paths), "biref_check_iou": agreement,
        "min_check_iou": min(agreement.values()), "postprocessing": False,
        "input": "Lossless PNG content; .jpg hardlink aliases for pinned SAM2 loader. No JPEG encoding."})


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    subs = p.add_subparsers(dest="command", required=True)
    s = subs.add_parser("source")
    s.add_argument("input", type=Path)
    s.add_argument("output", type=Path)
    s.add_argument("--size", type=int, default=512)
    s.add_argument("--background", default="#8b9bb4")
    t = subs.add_parser("track")
    t.add_argument("input", type=Path)
    t.add_argument("output", type=Path)
    t.add_argument("--check-every", type=int, default=8, help="BiRefNet diagnostic cadence; SAM still tracks every frame")
    a = p.parse_args()
    if a.command == "source":
        source(a.input.resolve(), a.output.resolve(), a.size, a.background)
    else:
        track(a.input.resolve(), a.output.resolve(), a.check_every)
