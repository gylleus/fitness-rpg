"""Create separate, scale-correct FP16 Wan experts for Apple MPS.

The original FP8 checkpoints and Linux model manifest are never modified.
Conversion reads one tensor at a time and writes a safetensors file directly,
avoiding a second complete 28 GB state dict in unified memory.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import shutil
import struct
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "sprite-animation"))
from common import save_json, sha256

CONVERSION = "frpg-scaled-fp8-to-fp16-v1"
FP8_TYPES = {"F8_E4M3", "F8_E5M2"}


def model_name(stage):
    if stage not in ("high", "low"):
        raise ValueError("Expected high or low Wan expert")
    return f"wan2.2_i2v_{stage}_noise_14B_mps_fp16.safetensors"


def read_header(path):
    with path.open("rb") as stream:
        size = struct.unpack("<Q", stream.read(8))[0]
        if size > 16 * 2**20:
            raise ValueError("Unexpectedly large safetensors header")
        return json.loads(stream.read(size)), 8 + size


def conversion_plan(header):
    """Remove quantization controls and materialize their scale into each weight."""
    keys = set(header) - {"__metadata__"}
    controls = {key for key in keys if key == "scaled_fp8" or key.endswith(".scaled_fp8")
                or key.endswith((".scale_weight", ".scale_input"))}
    if not any(key == "scaled_fp8" or key.endswith(".scaled_fp8") for key in keys):
        raise ValueError("Expected the pinned ComfyUI scaled-FP8 checkpoint format")
    for key in controls:
        if key.endswith((".scale_weight", ".scale_input")):
            weight = key.rsplit(".", 1)[0] + ".weight"
            if weight not in keys:
                raise ValueError(f"Orphan quantization scale: {key}")
    plan = []
    offset = 0
    for key in sorted(keys - controls):
        spec = header[key]
        scale = key[:-len("weight")] + "scale_weight" if key.endswith(".weight") else None
        scale = scale if scale in keys else None
        convert = spec["dtype"] in FP8_TYPES or scale is not None
        if spec["dtype"] in FP8_TYPES and scale is None:
            raise ValueError(f"Missing scale for FP8 weight: {key}")
        size = math.prod(spec["shape"]) * 2 if convert else spec["data_offsets"][1] - spec["data_offsets"][0]
        output = {"dtype": "F16" if convert else spec["dtype"], "shape": spec["shape"],
                  "data_offsets": [offset, offset + size]}
        plan.append((key, scale, convert, output))
        offset += size
    return plan, offset


def dequantize(tensor, scale):
    import torch
    # Multiplication before FP16 rounding retains the recorded weight scale.
    if scale.numel() != 1:
        raise ValueError("Expected a scalar scale_weight in the pinned Wan checkpoint")
    result = (tensor.float() * scale.float()).to(torch.float16)
    if not torch.isfinite(result).all():
        raise ValueError("FP16 conversion produced non-finite weights")
    return result


def verify(source, target, expected_hash):
    record_path = target.with_suffix(".json")
    if not source.is_file() or sha256(source) != expected_hash:
        raise RuntimeError(f"Missing or changed original Wan weights: {source}")
    if not target.is_file() or not record_path.is_file():
        raise RuntimeError("Mac Wan weights are not prepared. Run: uv run sprite-python "
                           "image-generation/pixel-animation-14b/prepare_macos.py")
    record = json.loads(record_path.read_text())
    if (record.get("conversion") != CONVERSION or record.get("source_sha256") != expected_hash
            or sha256(target) != record.get("sha256")):
        raise RuntimeError(f"Mac Wan conversion provenance mismatch: {target}")
    return record


def convert(source, target, expected_hash):
    if target.exists():
        return verify(source, target, expected_hash)
    if not source.is_file() or sha256(source) != expected_hash:
        raise RuntimeError(f"Missing or changed original Wan weights: {source}")
    header, data_start = read_header(source)
    plan, data_bytes = conversion_plan(header)
    if shutil.disk_usage(source.parent).free < data_bytes + 2 * 2**30:
        raise RuntimeError("Mac conversion needs space for the FP16 expert plus 2 GiB reserve")
    from safetensors import safe_open
    output_header = {key: spec for key, _, _, spec in plan}
    output_header["__metadata__"] = {**header.get("__metadata__", {}),
                                   "frpg_conversion": CONVERSION, "frpg_source_sha256": expected_hash}
    encoded = json.dumps(output_header, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 8)
    partial = target.with_suffix(target.suffix + ".part")
    with safe_open(str(source), framework="pt", device="cpu") as tensors, source.open("rb") as original, partial.open("wb") as output:
        output.write(struct.pack("<Q", len(encoded)))
        output.write(encoded)
        for key, scale_key, needs_conversion, spec in plan:
            if needs_conversion:
                converted = dequantize(tensors.get_tensor(key), tensors.get_tensor(scale_key))
                output.write(converted.numpy().tobytes())
                del converted
            else:
                original.seek(data_start + header[key]["data_offsets"][0])
                remaining = spec["data_offsets"][1] - spec["data_offsets"][0]
                while remaining:
                    block = original.read(min(8 * 2**20, remaining))
                    if not block:
                        raise ValueError(f"Truncated tensor: {key}")
                    output.write(block)
                    remaining -= len(block)
    if partial.stat().st_size != 8 + len(encoded) + data_bytes:
        raise ValueError("Converted checkpoint size mismatch")
    digest = sha256(partial)
    partial.replace(target)
    record = {"conversion": CONVERSION, "source": source.name, "source_sha256": expected_hash,
              "sha256": digest, "bytes": target.stat().st_size,
              "note": "FP8 weights multiplied by scale_weight in FP32, then rounded to FP16. Quantization controls removed."}
    save_json(target.with_suffix(".json"), record)
    return record


def prepare(verify_only=False):
    manifest = json.loads((ROOT / "models.lock.json").read_text())["models"]
    results = []
    for stage in ("high", "low"):
        name = f"wan2.2_i2v_{stage}_noise_14B_fp8_scaled.safetensors"
        entry = next(item for item in manifest if Path(item["path"]).name == name)
        source = ROOT / entry["path"]
        target = source.with_name(model_name(stage))
        print("Verifying" if verify_only else "Preparing", target.name, flush=True)
        results.append((verify if verify_only else convert)(source, target, entry["sha256"]))
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    print(json.dumps(prepare(args.verify_only), indent=2))
