"""Conditional follow-up on the knight only, after visual failure in main matrix."""
import io
import json
import time
import hashlib
import importlib.metadata

import numpy as np
from PIL import Image, ImageDraw
from pixel_snapper import PixelSnapperConfig, process_image
from threadpoolctl import threadpool_limits

from process import ROOT, fit_size, font, image_panel, map_palette, pyx_instance, save_json


def contain_square(im, bound):
    # Pixel Snapper's inferred grid is not necessarily square. Keep that ratio,
    # then pad the result to the requested square instead of stretching it.
    resized = im.convert("RGB").resize(fit_size(im.size, bound), Image.Resampling.NEAREST)
    canvas = Image.new("RGB", (bound, bound), im.convert("RGB").getpixel((0, 0)))
    canvas.paste(resized, ((bound-resized.width)//2, (bound-resized.height)//2))
    return canvas


def main():
    out = ROOT / "grid-recovery"
    out.mkdir(exist_ok=True)
    source = Image.open(ROOT / "originals/knight.png").convert("RGB")
    start = time.monotonic()
    # High intermediate color count reduces the palette-change confound, but
    # this tool still combines grid recovery with its own quantization.
    data = process_image((ROOT / "originals/knight.png").read_bytes(),
                         PixelSnapperConfig(k_colors=256, pixel_size_override=None))
    (out / "knight-auto.png").write_bytes(data)
    grid = Image.open(io.BytesIO(data)).convert("RGB")
    elapsed = time.monotonic() - start
    # Fit on the ORIGINAL, not on the recovered image: reuse the main experiment's
    # independent palette and BGM decision function for both inputs.
    model = pyx_instance(128, 32, source.size)
    model.fit(np.asarray(source))
    palette = model.colors.reshape(-1, 3).astype(np.uint8)
    expected = json.loads((ROOT / "metadata/palette-knight-32.json").read_text())
    assert palette.tolist() == expected
    grid_canvas = contain_square(grid, 128)
    grid_canvas.save(out / "knight-grid-contained-128.png")
    # Both inputs enter Pyxelate at 1024px, with the recovered pixels enlarged
    # using exactly 8x nearest-neighbor. Preserve all defaults except the stated
    # SVD-off ablation. The same learned color table/classifier is reused.
    recovered_input = grid_canvas.resize((1024, 1024), Image.Resampling.NEAREST)
    recovered_input.save(out / "knight-grid-input-1024.png")
    images = {}
    images["nearest_independent32"] = map_palette(source.resize((128,128), Image.Resampling.NEAREST), palette)
    images["pyxelate_default"] = Image.fromarray(model.transform(np.asarray(source)))
    assert np.array_equal(np.asarray(images["pyxelate_default"]), np.asarray(Image.open(ROOT / "processed/128/32/pyxelate_independent/knight.png")))
    images["grid_palette32"] = map_palette(grid_canvas, palette)
    images["grid_pyxelate_default"] = Image.fromarray(model.transform(np.asarray(recovered_input)))
    model.svd = False
    images["pyxelate_svd_off"] = Image.fromarray(model.transform(np.asarray(source)))
    images["grid_pyxelate_svd_off"] = Image.fromarray(model.transform(np.asarray(recovered_input)))
    records = []
    for name, im in images.items():
        path = out / f"knight-{name}-128.png"
        im.save(path)
        actual = set(map(tuple,np.asarray(im).reshape(-1,3)))
        assert actual <= set(map(tuple,palette))
        records.append({"path": str(path.relative_to(ROOT)), "size": list(im.size),
                        "colors": len(actual), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    save_json(ROOT / "metadata/grid-followup.json", {
        "trigger": "Main knight comparison shows stray sword-adjacent pixels and altered highlights under Pyxelate.",
        "asset": "knight", "pixel_snapper_version": importlib.metadata.version("pixel-snapper"),
        "grid_settings": {"k_colors":256,"pixel_size_override":None},
        "native_grid_size": list(grid.size), "grid_seconds": elapsed,
        "normalization": "Aspect-preserving NEAREST contain within 128x128; center-pad with source corner RGB. Then 8x NEAREST to 1024 for Pyxelate input.",
        "palette": "Same 32-color independent knight palette and BGM, learned from original, for all six panels.",
        "caveat": "Grid tool also quantizes to 256 colors; this is not a pure geometry-only intervention. Automatic grid can alter aspect by inferring unequal row/column counts.",
        "parameters": {"dither":"none","sobel":3,"depth":1,"svd":[True,False]},
        "artifacts": records,
    })
    labels = ["NN + same 32 colors", "Pyxelate / default", "Grid + same 32 colors",
              "Grid -> Pyxelate", "Pyxelate / SVD off", "Grid -> Pyx / SVD off"]
    sheet = Image.new("RGB", (1824, 668), "#171d2a")
    d = ImageDraw.Draw(sheet)
    d.text((16,12), "Knight failure follow-up | 128 x 128 | same independent 32-color palette | dither off",font=font(26),fill="white")
    d.text((16,50), "Pixel Snapper auto grid: 128 x 129; aspect-preserving contain + padding. It also quantizes (256 intermediate colors).",font=font(18),fill="#c6cfdd")
    for i, ((name,im),label) in enumerate(zip(images.items(),labels)):
        x=16+i*300
        d.text((x,90),label,font=font(18),fill="#90c6ff")
        image_panel(sheet,im,(x,122))
        d.text((x,388),"Full canvas / 2x nearest",font=font(16),fill="white")
        crop=im.crop((28,56,64,108)).resize((144,208),Image.Resampling.NEAREST)
        sheet.paste(crop,(x,420))
        d.text((x,638),"Sword crop / 4x nearest",font=font(15),fill="#c6cfdd")
    sheet.save(ROOT / "sheets/knight-followup.png")
    # Keep the earlier large inspection reproducible as well.
    inspection=Image.new("RGB",(1568,570),"#171d2a")
    d=ImageDraw.Draw(inspection)
    for i,(label,path) in enumerate([
        ("Nearest / 128",ROOT/"processed/128/nearest/knight.png"),
        ("Pyxelate independent / 128 / 16",ROOT/"processed/128/16/pyxelate_independent/knight.png"),
        ("Pyxelate shared / 128 / 16",ROOT/"processed/128/16/pyxelate_shared/knight.png")]):
        im=Image.open(path).resize((512,512),Image.Resampling.NEAREST)
        inspection.paste(im,(8+i*520,48));d.text((8+i*520,16),label,font=font(20),fill="white")
    inspection.save(ROOT/"sheets/knight-inspection-128-16.png")
    grid.resize((grid.width*4,grid.height*4),Image.Resampling.NEAREST).save(ROOT/"sheets/knight-grid-native-4x.png")
    print("Saved knight grid/SVD follow-up; verified dimensions, palette membership and matching main Pyxelate output.")


if __name__ == "__main__":
    with threadpool_limits(limits=4):
        main()
