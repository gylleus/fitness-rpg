"""Device policy shared by references, tracking and owned ComfyUI servers.

Imports torch lazily so planning and export do not require a working GPU.
Linux keeps its original CUDA settings; Apple Silicon uses its own runtime.
"""
from contextlib import nullcontext
import os
import platform


def configured_device():
    """Backend for saved graphs/commands; no torch import needed for planning."""
    requested = os.environ.get("SPRITE_DEVICE", "auto")
    if requested not in ("auto", "cuda", "mps", "cpu"):
        raise ValueError("SPRITE_DEVICE must be auto, cuda, mps or cpu")
    return ("mps" if platform.system() == "Darwin" else "cuda") if requested == "auto" else requested


def comfy_flags(reserve="1.5"):
    device = configured_device()
    if device == "mps":
        return ["--lowvram", "--reserve-vram", "6", "--fp16-unet", "--cpu-vae",
                "--fp32-vae", "--use-split-cross-attention", "--disable-xformers"]
    if device == "cpu":
        return ["--cpu"]
    return ["--lowvram", "--reserve-vram", reserve]


def inference_timeout(default=3600):
    """Mac animation can take much longer; callers still own/stop subprocesses."""
    value = os.environ.get("SPRITE_INFERENCE_TIMEOUT", str(14400 if configured_device() == "mps" else default))
    try:
        seconds = int(value)
    except ValueError as exc:
        raise ValueError("SPRITE_INFERENCE_TIMEOUT must be a positive integer in seconds") from exc
    if seconds < 1:
        raise ValueError("SPRITE_INFERENCE_TIMEOUT must be a positive integer in seconds")
    return seconds


def device_name():
    import torch
    requested = os.environ.get("SPRITE_DEVICE", "auto")
    if requested not in ("auto", "cuda", "mps", "cpu"):
        raise ValueError("SPRITE_DEVICE must be auto, cuda, mps or cpu")
    available = {"cuda": torch.cuda.is_available(),
                 "mps": torch.backends.mps.is_available(), "cpu": True}
    if requested != "auto":
        if not available[requested]:
            raise RuntimeError(f"Requested sprite device {requested!r} is unavailable")
        return requested
    for name in ("cuda", "mps"):
        if available[name]:
            return name
    raise RuntimeError("No CUDA or Apple MPS device available. Set SPRITE_DEVICE=cpu for CPU processing/inference.")


def configure_reference(device):
    import torch
    torch.set_num_threads(4)
    if device == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
        torch.use_deterministic_algorithms(True)
    else:
        # MPS does not implement every deterministic variant used by SDXL.
        torch.use_deterministic_algorithms(True, warn_only=True)


def tracking_context(device):
    import torch
    return torch.autocast("cuda", dtype=torch.bfloat16) if device == "cuda" else nullcontext()


def device_metadata(device):
    import torch
    result = {"device": device, "platform": platform.platform(), "torch": torch.__version__}
    if device == "cuda":
        result.update(gpu=torch.cuda.get_device_name(),
                      vram=torch.cuda.get_device_properties(0).total_memory)
    elif device == "mps":
        import psutil
        result.update(gpu="Apple Silicon (MPS)", unified_memory=psutil.virtual_memory().total)
    else:
        result["gpu"] = None
    return result
