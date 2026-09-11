#!/usr/bin/env python3
"""Audit all exported poses and build a portable animated review from game atlases."""
from pathlib import Path
import base64
import hashlib
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "image-generation/sprite-animation"))
from pixels import palette_colors


def main():
    catalog = json.loads((ROOT / "assets/sprites/catalog.json").read_text())
    allowed = set(map(tuple, palette_colors()))
    report = {"frames": 0, "actions": 0, "frame_size": [128, 128], "entities": {}}
    pictures = {}
    for key, entity in catalog["entities"].items():
        pictures[key] = {}
        assert entity["frameSize"] == [128, 128], key
        for action, clip in entity["actions"].items():
            path = ROOT / f"assets/sprites/{key}--{action}.png"
            pictures[key][action] = "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()
            if key == "barbarian_player":
                continue
            assert len(clip["frames"]) == 8
            assert clip["loop"] == (action in ("idle", "walk"))
            sheet = Image.open(path).convert("RGBA")
            bounds = []
            for frame in clip["frames"]:
                x, y = frame["x"], frame["y"]
                tile = sheet.crop((x, y, x + 128, y + 128))
                rgba = np.asarray(tile)
                bbox = tile.getbbox()
                assert bbox and min(bbox[:2]) > 0 and max(bbox[2:]) < 128, (key, action, bbox)
                assert set(np.unique(rgba[..., 3])) <= {0, 255}
                assert not rgba[rgba[..., 3] == 0, :3].any()
                assert set(map(tuple, rgba[rgba[..., 3] > 0, :3])) <= allowed
                assert frame["duration"] > 0
                bounds.append(bbox)
                report["frames"] += 1
            report["actions"] += 1
            report["entities"].setdefault(key, {})[action] = {"bounds": bounds,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "duration_ms": clip["duration"]}
    assert report["frames"] == 160 and report["actions"] == 20
    (HERE / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
    html = TEMPLATE.replace("__CATALOG__", json.dumps(catalog)).replace("__IMAGES__", json.dumps(pictures))
    (HERE / "review.html").write_text(html)
    # A compact comparison at authored game-relative sizes, enlarged 2x.
    lineup = Image.new("RGB", (1200, 240), "#111e22")
    draw = ImageDraw.Draw(lineup)
    draw.rectangle((0, 200, 1200, 240), fill="#304635")
    for i, (key, entity) in enumerate(catalog["entities"].items()):
        sprite = Image.open(ROOT / f"assets/sprites/{key}--idle.png").convert("RGBA").crop((0, 0, 128, 128))
        factor = 110 * entity["heightScale"] / entity["idleHeight"]
        size = round(128 * factor)
        sprite = sprite.resize((size, size), Image.Resampling.NEAREST)
        x = round(i * 200 + 100 - entity["pivot"][0] * size)
        y = round(200 - entity["pivot"][1] * size)
        lineup.paste(sprite, (x, y), sprite)
        draw.text((i * 200 + 12, 216), entity["name"], fill="#e4e9dc")
    lineup.save(HERE / "lineup.png")
    print("Audit passed: 160 enemy poses, 20 actions, 128px, palette, alpha, clearance and timing. Portable review.html and lineup.png written.")


TEMPLATE = '''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wetlands · 128px roster</title>
<style>
:root{color-scheme:dark;font:15px system-ui;background:#111e22;color:#e4e9dc}
body{max-width:1250px;margin:30px auto;padding:0 20px}h1{font-size:27px;margin-bottom:6px}p{color:#adbbb1;line-height:1.6}
nav{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:24px 0}button,select{font:inherit;color:inherit;background:#23382e;border:1px solid #56704a;border-radius:6px;padding:8px 12px}
canvas{width:100%;image-rendering:pixelated;background:#15231f;border-radius:10px}#cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:16px}article{border:1px solid #34473c;border-radius:10px;padding:12px}h2{font-size:17px;margin:0 0 10px}small{color:#adbbb1}a{color:#8ae3b1}input{vertical-align:middle}
</style>
<h1>Wetlands · 128 × 128</h1><p>Five regenerated enemies alongside the current player. Eight poses per action; idle and walk loop, attacks recover, deaths stay down. All images are embedded, so this review also opens offline.</p>
<nav><label>Action <select id="action"><option>idle</option><option>walk</option><option>attack</option><option>death</option></select></label>
<label>Speed <select id="speed"><option value="1">1×</option><option value="0.5">½×</option><option value="0.25">¼×</option></select></label>
<button id="pause">Pause</button><button id="restart">Restart</button><label>Pose <input id="frame" type="range" min="0" max="7" value="0"></label></nav>
<canvas id="lineup" width="1200" height="260"></canvas><p>Lineup uses the game’s relative heights and ground pivots. Individual cards show the native 128px frame enlarged 2×.</p><div id="cards"></div>
<p>This is a style trial with authored imagegen poses. Some texture, body-volume and gait variation remains between poses; a full-motion cleanup pass is still useful. The shared palette warms several original gray-green colors. <a href="README.md">Recipe and review notes</a>.</p>
<script>
const catalog=__CATALOG__,pictures=__IMAGES__;
const action=document.querySelector('#action'),speed=document.querySelector('#speed'),slider=document.querySelector('#frame'),pause=document.querySelector('#pause');
let elapsed=0,previous=performance.now(),playing=true,manual=false,cards=[];
function sample(clip,time){if(clip.loop)time%=clip.duration;for(let i=0;i<clip.frames.length;i++){if(time<clip.frames[i].duration)return i;time-=clip.frames[i].duration}return clip.frames.length-1}
async function start(){for(const [id,entity] of Object.entries(catalog.entities)){const images={};for(const [name,src] of Object.entries(pictures[id])){const im=new Image();im.src=src;await im.decode();images[name]=im}
const article=document.createElement('article'),title=document.createElement('h2'),canvas=document.createElement('canvas'),detail=document.createElement('small');title.textContent=entity.name;canvas.width=256;canvas.height=256;article.append(title,canvas,detail);document.querySelector('#cards').append(article);cards.push({id,entity,images,canvas,detail})}requestAnimationFrame(draw)}
function draw(now){if(playing)elapsed+=(now-previous)*Number(speed.value);previous=now;const lineup=document.querySelector('#lineup').getContext('2d');lineup.imageSmoothingEnabled=false;lineup.clearRect(0,0,1200,260);lineup.fillStyle='#304635';lineup.fillRect(0,215,1200,45);
for(const [n,card] of cards.entries()){let state=action.value,time=elapsed,clip=card.entity.actions[state];if(!manual&&state==='attack'&&time>=720){state='idle';time-=720;clip=card.entity.actions.idle}else if(state==='attack')time*=clip.duration/720;else if(state==='death')time*=clip.duration/800;
const i=manual?Number(slider.value):sample(clip,time),frame=clip.frames[i],c=card.canvas.getContext('2d');c.imageSmoothingEnabled=false;c.clearRect(0,0,256,256);for(let y=0;y<256;y+=16)for(let x=0;x<256;x+=16){c.fillStyle=((x+y)/16)%2?'#26353a':'#1d2a30';c.fillRect(x,y,16,16)}c.drawImage(card.images[state],frame.x,frame.y,128,128,0,0,256,256);
const scale=110*card.entity.heightScale/card.entity.idleHeight,size=128*scale;lineup.drawImage(card.images[state],frame.x,frame.y,128,128,n*200+100-card.entity.pivot[0]*size,215-card.entity.pivot[1]*size,size,size);lineup.fillStyle='#e4e9dc';lineup.font='13px system-ui';lineup.fillText(card.entity.name,n*200+12,245);card.detail.textContent=state+' · pose '+(i+1)+'/8';}requestAnimationFrame(draw)}
function reset(){elapsed=0;manual=false;slider.value=0;playing=true;pause.textContent='Pause'}action.onchange=reset;document.querySelector('#restart').onclick=reset;pause.onclick=()=>{playing=!playing;manual=false;pause.textContent=playing?'Pause':'Resume'};slider.oninput=()=>{manual=true;playing=false;pause.textContent='Resume'};start();
</script></html>'''


if __name__ == "__main__":
    main()
