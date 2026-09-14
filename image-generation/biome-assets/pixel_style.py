"""Deterministic scenery exports measured against the authored actors' world scale.

Generation masters stay untouched. This is the shared texture compiler used by
both the layer preparer and prop atlas packer, never a per-biome art script.
"""
from copy import deepcopy
import math
from pathlib import Path
import tomllib
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from asset_palette import map_palette, palette_contract, palette_guidance, load_palette

STYLE = Path(__file__).with_name("style.toml")


def validate(profile):
    if profile.get("schema_version") != 1:
        raise ValueError("Unsupported pixel profile")
    for key in ("pixels_per_unit", "reference_height"):
        value = profile.get(key)
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"Invalid pixel profile {key}")
    for kind in ("background", "ground", "prop"):
        colors = profile.get(f"{kind}_colors")
        if type(colors) is not int or not 2 <= colors <= 256:
            raise ValueError(f"Invalid {kind} palette budget")
    result = deepcopy(profile)
    # Saved older recipes retain their geometry but cannot select independent colors.
    result.update({f"{kind}_colors": len(load_palette()["colors"]) for kind in ("background", "ground", "prop")})
    result["palette"] = palette_contract()
    return result


def load_profile(path=None):
    return validate(tomllib.loads(Path(path or STYLE).read_text())["pixels"])


def export_contract(profile, kind):
    profile = validate(profile)
    return {"palette": palette_contract(), "resolution": "world", "sampling": "nearest", "reduction": "area",
            "dither": "none", "colors": profile[f"{kind}_colors"],
            "pixel_profile": validate(profile)}


def guidance(profile, canvas=None, height_scale=None):
    density = profile["pixels_per_unit"]
    reference = profile["reference_height"]
    text = (f"Pixel scale: match the authored player and enemy sprites at {density:g} texture pixels per game unit; "
            f"a {reference:g}-unit standing actor is approximately {density * reference:g} visible pixels tall. "
            "Use deliberate connected color clusters and a few stepped shade bands, with no photographic grain or dithering. "
            "Keep scenery contrast below the actors. " + palette_guidance() + " ")
    if height_scale is not None:
        text += f"This prop occupies {reference * height_scale:g} game units in height and exports at approximately {round(reference * height_scale * density)} visible pixels tall. "
    elif canvas:
        text += f"The runtime texture is {round(canvas[0] * density)} by {round(canvas[1] * density)} pixels. "
    return text + "A larger generation master is allowed; compose its details for this final pixel grid."


def compile_texture(image, logical_size, profile, kind):
    """Area-reduce microtexture, use the master game palette and restore hard alpha.

    Premultiplied filtering excludes hidden matte colors. Palette mapping uses
    visible pixels only, with the same fixed RGB choices as every actor.
    Runtime magnification remains nearest-neighbor, without interpolation blur.
    """
    import numpy as np
    from PIL import Image

    validate(profile)
    if len(logical_size) != 2 or any(not math.isfinite(n) or n <= 0 for n in logical_size):
        raise ValueError("Texture needs positive finite world dimensions")
    size = tuple(max(1, round(n * profile["pixels_per_unit"])) for n in logical_size)
    rgba = image.convert("RGBA")
    sampling = Image.Resampling.BOX if size[0] <= rgba.width and size[1] <= rgba.height else Image.Resampling.NEAREST
    pixels = np.array(rgba.convert("RGBa").resize(size, sampling).convert("RGBA"))
    visible = pixels[..., 3] > 128
    if not visible.any():
        raise ValueError("Asset disappears at the configured pixel density")
    pixels[..., 3] = visible.astype(np.uint8) * 255
    pixels[~visible] = 0
    return map_palette(Image.fromarray(pixels))
