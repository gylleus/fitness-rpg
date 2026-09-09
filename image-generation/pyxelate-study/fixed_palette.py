"""Test an editable, explicitly fixed palette with SVD on/off; no GPU needed."""
import json
import time
import warnings
import hashlib

import numpy as np
from PIL import Image, ImageDraw
from pyxelate import Pal, Pyx
from skimage.transform import resize
from threadpoolctl import threadpool_limits

from process import ROOT, NAMES, fit_size, font, image_panel, map_palette, save_json


def conservative_pixelate(source, colors, bound=128):
    """Custom wrapper, NOT unmodified Pyxelate.

    Reuse this pinned version's HSV median and Sobel-weighted downsampling.
    Skip SVD, CLAHE and saturation/value boosts; choose the closest supplied
    palette color in CIELAB instead of Pyxelate's adaptive BGM classifier.
    Private method use is intentional and tied to the recorded Pyxelate commit.
    """
    if source.mode != "RGB":
        raise ValueError("This comparison expects RGB input; handle the foreground/alpha mask separately.")
    width,height=fit_size(source.size,bound)
    geometry=Pyx(width=width,height=height,palette=Pal.from_rgb(colors.tolist()),
                 svd=False,dither="none",sobel=3,depth=1)
    working=resize(np.asarray(source.convert("RGB")),(height*3,width*3),anti_aliasing=True)
    working=geometry._pyxelate(geometry._median(working))
    rgb=Image.fromarray(np.clip(np.rint(working*255),0,255).astype(np.uint8))
    return map_palette(rgb,colors)


def main():
    palette_config = json.loads((ROOT / "fantasy-palette.json").read_text())
    colors = np.array([list(bytes.fromhex(h.lstrip("#"))) for h in palette_config["colors"]],dtype=np.uint8)
    assert 2 <= len(colors) <= 256 and len(np.unique(colors,axis=0)) == len(colors)
    palette = Pal.from_hex(palette_config["colors"])
    images = {n: Image.open(ROOT / f"originals/{n}.png").convert("RGB") for n in NAMES}
    # Fixed output colors do not mean a fixed classifier. Fit once on a balanced
    # collage, then reuse that model everywhere. Include the scene this time;
    # the supplied output palette stays fixed throughout.
    training = np.concatenate([np.asarray(im.resize((128,128),Image.Resampling.NEAREST)) for im in images.values()],axis=1)
    model = Pyx(width=128,height=128,palette=palette,svd=True,dither="none",sobel=3,depth=1,alpha=.6)
    model.BGM_RESIZE = 640  # preserves all five equal 128x128 panels during fit
    started = time.monotonic()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        model.fit(training)
    assert np.array_equal(model.colors.reshape(-1,3).astype(np.uint8),colors)
    fit_seconds = time.monotonic()-started
    out = ROOT / "fixed-palette"
    out.mkdir(exist_ok=True)
    Image.fromarray(training).save(out / "training.png")
    records=[]
    for name,source in images.items():
        model.width,model.height=fit_size(source.size,128)
        outputs={"nearest":map_palette(source.resize((model.width,model.height),Image.Resampling.NEAREST),colors)}
        for enabled,label in [(True,"pyxelate_svd_on"),(False,"pyxelate_svd_off")]:
            model.svd=enabled
            outputs[label]=Image.fromarray(model.transform(np.asarray(source)))
        outputs["conservative"]=conservative_pixelate(source,colors)
        for label,im in outputs.items():
            path=out/f"{name}-{label}-128.png";im.save(path)
            assert im.size==(128,128)
            used=set(map(tuple,np.asarray(im).reshape(-1,3)))
            assert used<=set(map(tuple,colors)),path
            records.append({"path":str(path.relative_to(ROOT)),"colors":len(used),"size":list(im.size),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
        print("Fixed palette processed",name,flush=True)
    save_json(ROOT/"metadata/fixed-palette.json",{
        "palette":palette_config,"parameters":{"width":128,"height":128,"palette":"Pal.from_hex(colors)","svd":[True,False],"dither":"none","depth":1,"sobel":3},
        "training":"Five equal 128x128 NN thumbnails (including scene); one fixed-palette BGM fit reused for all transforms.",
        "fit_seconds":fit_seconds,"warnings":[str(w.message) for w in caught],"artifacts":records,
        "conservative_wrapper":"Custom mode: pinned Pyxelate HSV median + Sobel-weighted reduction; SVD, CLAHE and saturation/value boost skipped; nearest CIELAB palette assignment replaces BGM. Not stock Pyxelate.",
        "checks":"All 20 outputs exactly 128x128 RGB; every pixel belongs to the supplied hex palette; Pyxelate exported palette equals requested RGB values.",
    })
    palette_rows=(len(colors)+15)//16
    label_y=112+palette_rows*54
    row_start=label_y+54
    footer_y=row_start+len(NAMES)*314+8
    sheet=Image.new("RGB",(1794,footer_y+32),"#171d2a");d=ImageDraw.Draw(sheet)
    d.text((24,18),f"Choose the colors | {palette_config['name']} | 128 x 128 outputs",font=font(28),fill="white")
    d.text((24,59),"Same fixed palette throughout. Stock Pyxelate: same BGM, SVD on/off. Custom wrapper: no color boost, nearest palette. Dither: none.",font=font(19),fill="#c6cfdd")
    for i,hex_color in enumerate(palette_config["colors"]):
        x=24+(i%16)*86;y=100+(i//16)*54
        d.rectangle((x,y,x+74,y+27),fill=hex_color)
        d.text((x,y+30),hex_color,font=font(13),fill="white")
    labels=["Original preview","Nearest + fixed palette","Pyxelate / SVD on","Pyxelate / SVD off","Custom Pyx resizing only"]
    for col,label in enumerate(labels):d.text((24+col*354,label_y),label,font=font(21),fill="#90c6ff")
    for row,name in enumerate(NAMES):
        y=row_start+row*314
        paths=[ROOT/f"originals/{name}.png"]+[out/f"{name}-{method}-128.png" for method in ["nearest","pyxelate_svd_on","pyxelate_svd_off","conservative"]]
        for col,path in enumerate(paths):
            x=24+col*354;d.text((x,y-24),name.upper(),font=font(17),fill="white")
            image_panel(sheet,Image.open(path),(x,y),original=(col==0))
            d.text((x,y+265),"1024px source / 256px preview" if col==0 else "128 x 128 / 2x nearest display",font=font(15),fill="#c6cfdd")
    d.text((24,footer_y),"Fixed colors constrain the output palette; they do not prevent wrong color assignments, halos, or source design errors.",font=font(18),fill="#e7bd7e")
    sheet.save(ROOT/"sheets/fixed-palette-svd.png")
    print("Saved fixed-palette comparison; dimensions and exact hex palette membership verified.")


if __name__=="__main__":
    with threadpool_limits(limits=4):main()
