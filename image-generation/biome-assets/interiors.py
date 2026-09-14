"""Data-driven enclosed-location plans; resolution is independent of logical layout."""
from copy import deepcopy
import json
import math
from pathlib import Path

from biome_assets import HERE, digest, safe_id, sha, tomllib


def validate_scene(scene):
    if scene.get("schema_version") != 1:
        raise ValueError("Unsupported interior scene schema")
    if len(scene["canvas"]) != 2 or any(type(n) is not int or n < 1 for n in scene["canvas"]):
        raise ValueError("Invalid logical scene canvas")
    for key in ("reference_height", "ground_y", "ceiling_clearance"):
        value = scene[key]
        if type(value) not in (float, int) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"Invalid interior {key}")
    if scene["ceiling_clearance"] < scene["reference_height"] * 1.4:
        raise ValueError("Ceiling must leave room for actors and their attacks")
    ids = set()
    for layer in scene["layers"]:
        safe_id(layer["id"])
        if layer["id"] in ids or layer["role"] not in ("rear", "ceiling"):
            raise ValueError("Duplicate layer or invalid role")
        ids.add(layer["id"])
        if not 0 <= layer["parallax"] <= 1 or not math.isfinite(layer["parallax"]):
            raise ValueError("Parallax must be 0..1")
        if layer["repeat"] != "mirror":
            raise ValueError("Interior layers require reviewed mirrored repetition")
        if len(layer["canvas"]) != 2 or any(type(n) is not int or n < 1 for n in layer["canvas"]):
            raise ValueError("Invalid layer canvas")
        if layer["origin_y"] != "alpha_bottom" and not 0 <= layer["origin_y"] <= layer["canvas"][1]:
            raise ValueError("Layer anchor is outside its canvas")
    if not any(layer["role"] == "ceiling" for layer in scene["layers"]):
        raise ValueError("An enclosed interior needs a ceiling layer")


def make_interior_plan(theme, biome_id=None, recipe_path=None, style_path=None):
    from pixel_style import export_contract, guidance
    recipe_path = Path(recipe_path or HERE / "interiors.toml")
    recipe = tomllib.loads(recipe_path.read_text())
    if recipe["schema_version"] != 1 or theme not in recipe["themes"]:
        raise ValueError(f"Unknown interior theme: {theme}")
    biome_id = safe_id(biome_id or theme)
    selected = recipe["themes"][theme]
    scene = {"schema_version": 1, **deepcopy(recipe["scene"]), **deepcopy(selected.get("scene", {})), "layers": []}
    style_path = Path(style_path or HERE / "style.toml")
    style = tomllib.loads(style_path.read_text())
    assets = []
    for spec in recipe["layers"]:
        asset_id = f"{biome_id}_{spec['id']}"
        layer = {key: deepcopy(spec[key]) for key in ("id", "role", "canvas", "parallax", "origin_y")}
        layer.update(asset_id=asset_id, repeat="mirror")
        scene["layers"].append(layer)
        prompt = "\n".join([
            "Use case: stylized-concept",
            f"Asset type: independently scrolling {spec['id']} layer for a claustrophobic side-scrolling game interior",
            f"Primary request: {selected['name']}",
            f"Materials: {selected['materials']}",
            f"Composition: {spec['prompt']}",
            "Camera: strict orthographic side view along a horizontal tunnel, parallel to the image plane. The passage continues sideways off both edges.",
            f"Style/medium: {style['style']} {style['background']}",
            f"Color palette: {selected['palette']}",
            f"Lighting: {selected['lighting']}",
            f"Canvas: {spec['canvas'][0]} by {spec['canvas'][1]} logical units; generate a large image with width at least 1536 pixels and this aspect ratio.",
            guidance(style["pixels"], spec["canvas"]),
            "Transparency: genuine alpha in all empty areas; never paint checkerboard or a colored matte." if spec["transparent"] else "Opacity: completely opaque edge-to-edge image.",
            "If a reference image is supplied, use it for pixel texture density and restrained shading only; keep the requested indoor subject and enclosed composition.",
            "Avoid: " + ", ".join(style["avoid"] + ["tiny-resolution upscaling", "flat featureless polygons", "harsh white highlights", "vast cave expanses", "soaring ceilings", "long vanishing-point corridors", "characters"])])
        assets.append({"id": asset_id, "name": f"{selected['name']} — {spec['id']}", "kind": "background",
            "canvas": spec["canvas"], "transparent": spec["transparent"], "prompt": prompt, "prompt_sha256": digest(prompt),
            "source_definition": {"visual_description": selected["materials"], "layer": spec},
            "export": {**export_contract(style["pixels"], "background"), "min_width": 1536,
                       "alpha": "binary" if spec["transparent"] else "opaque"}})
    validate_scene(scene)
    return {"schema_version": 1, "biome_id": biome_id, "theme": theme, "interior": scene,
            "style": style, "style_sha256": sha(style_path),
            "recipe": {"text": recipe_path.read_text(), "sha256": sha(recipe_path)}, "assets": assets}


def prepared_scene(plan, prepared_images):
    import numpy as np
    scene = deepcopy(plan["interior"])
    validate_scene(scene)
    for layer in scene["layers"]:
        image = prepared_images[layer["asset_id"]]
        if layer["role"] == "ceiling":
            alpha = image.getchannel("A")
            bounds = alpha.getbbox()
            if not bounds or bounds[3] >= image.height:
                raise ValueError("Ceiling needs transparent clearance below its underside")
            solid_rows = np.flatnonzero((np.array(alpha) == 255).all(axis=1))
            if not len(solid_rows):
                raise ValueError("Ceiling needs a solid cross-section across its complete width")
            # Background removal may clear the dark band above the rock. Join
            # its first full-width solid row to the scene fill in the renderer.
            layer["cap_y"] = int(solid_rows[0]) * layer["canvas"][1] / image.height
            if layer["origin_y"] == "alpha_bottom":
                layer["origin_y"] = bounds[3] * layer["canvas"][1] / image.height
        elif layer["origin_y"] == "alpha_bottom":
            raise ValueError("Only ceiling layers support alpha_bottom anchors")
    validate_scene(scene)
    return scene


def review_html(manifest):
    """Offline composition preview driven by the same resolved scene contract."""
    data = json.dumps({"scene": manifest["interior"], "assets": manifest["assets"]}).replace("<", "\\u003c")
    return '''<h2>Interior composition</h2>
<p>Drag travel to inspect parallax and mirrored seams. The outline marks one reference-height actor; review actual combat sprites in the runtime audit too.</p>
<label>Travel <input id="travel" type="range" min="0" max="12800" value="0" step="1"></label>
<label>Viewport <select id="viewport"><option value="wide">Landscape</option><option value="tall">Portrait</option></select></label>
<p id="layers"></p><canvas id="scene"></canvas>
<script type="application/json" id="interior-data">''' + data + '''</script>
<script>
const data=JSON.parse(document.getElementById('interior-data').textContent);
const canvas=document.getElementById('scene'), ctx=canvas.getContext('2d');
const travel=document.getElementById('travel'), viewport=document.getElementById('viewport');
const loaded={}, enabled={};
for(const layer of data.scene.layers){
  const label=document.createElement('label'), check=document.createElement('input');
  check.type='checkbox';check.checked=true;enabled[layer.id]=true;
  check.onchange=()=>{enabled[layer.id]=check.checked;draw()};
  label.append(check,document.createTextNode(layer.id));document.getElementById('layers').append(label);
}
function draw(){
  const s=data.scene, tall=viewport.value==='tall';
  canvas.width=tall?390:640;canvas.height=tall?600:360;
  const scale=(tall?100:64)/s.reference_height, ground=canvas.height-(tall?70:72);
  const ceiling=ground-s.ceiling_clearance*scale;
  ctx.imageSmoothingEnabled=false;ctx.fillStyle=s.fill;ctx.fillRect(0,0,canvas.width,canvas.height);
  for(const layer of s.layers){
    const im=loaded[layer.asset_id];if(!im||!enabled[layer.id])continue;
    const w=layer.canvas[0]*scale,h=layer.canvas[1]*scale;
    const y=(layer.role==='ceiling'?ceiling:ground)-layer.origin_y*scale;
    if(layer.role==='ceiling'){ctx.fillStyle=s.fill;ctx.fillRect(0,0,canvas.width,Math.max(0,y+(layer.cap_y||0)*scale))}
    const offset=(-Number(travel.value)*layer.parallax)%(2*w);
    for(let n=Math.floor(-offset/w)-1;n*w+offset<canvas.width;n++){
      ctx.save();ctx.translate(n*w+offset,y);if(Math.abs(n%2)===1){ctx.translate(w,0);ctx.scale(-1,1)}
      if(y>0)ctx.drawImage(im,0,0,im.width,1,0,-y,w,y);
      ctx.drawImage(im,0,0,w,h);
      if(y+h<canvas.height)ctx.drawImage(im,0,im.height-1,im.width,1,0,h,w,canvas.height-y-h);
      ctx.restore();
    }
  }
  ctx.fillStyle=s.fill;ctx.fillRect(0,ground,canvas.width,canvas.height-ground);
  ctx.strokeStyle='#d5b969';ctx.lineWidth=1;
  ctx.strokeRect(canvas.width*.22-12*scale,ground-s.reference_height*scale,24*scale,s.reference_height*scale);
}
travel.oninput=draw;viewport.onchange=draw;
Promise.all(Object.entries(data.assets).map(([id,asset])=>new Promise((resolve,reject)=>{
  const im=new Image();im.onload=()=>{loaded[id]=im;resolve()};im.onerror=reject;im.src=asset.image;
}))).then(draw).catch(()=>{document.getElementById('layers').append(' Image load failed. Keep this page beside its PNGs.')});
</script>'''
