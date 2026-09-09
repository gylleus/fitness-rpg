#!/usr/bin/env python3
"""Package a synchronized cadence viewer and verify selected poses are unchanged."""
import argparse
import json
from pathlib import Path
import shutil
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent


def build(job="knight-pixel", size=64):
    out = ROOT / "outputs" / f"{job}-{size}-cadence"
    out.mkdir(exist_ok=True)
    records = []
    baseline = None
    baseline_frames = {}
    for stride in (1, 2, 4):
        source = ROOT / "outputs" / (f"{job}-{size}-sheet" + (f"-step-{stride}" if stride != 1 else ""))
        manifest = json.loads((source / "manifest.json").read_text())
        if baseline is None:
            baseline = manifest
        if any(manifest[k] != baseline[k] for k in ("source_job", "crop", "pivot", "palette", "source_cutout_sha256")):
            raise ValueError("Cadence inputs/crop/pivot/palette differ")
        duration = sum(manifest["loop"]["durations_ms"])
        if duration != sum(baseline["loop"]["durations_ms"]):
            raise ValueError("Loop duration changed")
        rate = len(manifest["loop"]["indices"]) * 1000 / duration
        folder = f"{rate:g}fps"
        for method in ("nearest", "pyxelate"):
            atlas = json.loads((source / method / "spritesheet.json").read_text())
            for frame in atlas["frames"]:
                key = (method, frame["source_frame"])
                data = (source / method / frame["filename"]).read_bytes()
                if stride == 1:
                    baseline_frames[key] = data
                elif data != baseline_frames[key]:
                    raise ValueError(f"Kept frame differs from full-rate source: {key}")
        for path in source.rglob("*"):
            if path.is_file() and path.suffix != ".zip":
                dest = out / folder / path.relative_to(source)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, dest)
        records.append({"fps": rate, "stride": stride, "folder": folder,
            "durations": manifest["loop"]["durations_ms"], "indices": manifest["loop"]["indices"]})
    payload = json.dumps(records).replace("<", "\\u003c")
    page = '''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>64px frame-skipping comparison</title>
<style>body{font:16px system-ui;background:#181425;color:#ead4aa;margin:24px}main{display:flex;flex-wrap:wrap;gap:20px}article{padding:18px;background:#262b44;width:270px}img{width:256px;height:256px;image-rendering:pixelated;background:repeating-conic-gradient(#3a4466 0 25%,#262b44 0 50%) 0/24px 24px}button,select{font:inherit;padding:6px;margin:5px}a{color:#2ce8f5}#scrub{width:min(90vw,850px)}p{max-width:950px}</style>
<h1>Frame skipping: 16fps → 8fps → 4fps</h1>
<p>The same 64×64 knight poses, ENDESGA palette and 2.75-second loop. Fewer poses are held longer: the motion keeps its original speed. All three views share one clock. No new generation or interpolation.</p>
<button id="play">Pause</button><button id="restart">Restart</button>
<label>Conversion <select id="method"><option value="pyxelate">Pyxelate</option><option value="nearest">Nearest-neighbor</option></select></label>
<label>Playback speed <select id="speed"><option value="1">1×</option><option value=".5">½×</option><option value="1.25">1.25×</option></select></label>
<p><input id="scrub" type="range" min="0" max="2749" step="1" value="0"><span id="time"></span></p><main id="cards"></main>
<p>8fps is the moderate stepped option; 4fps has much larger pose jumps. Raising playback speed also shortens the cycle. PNG/APNG carry transparency; GIF previews include a checkerboard.</p>
<script>const clips=PAYLOAD;const total=clips[0].durations.reduce((a,b)=>a+b,0);let elapsed=0,playing=true,last=0;const views=[];
for(const clip of clips){const card=document.createElement('article');const title=document.createElement('h2');title.textContent=`${clip.fps}fps · ${clip.indices.length} frames`;const image=document.createElement('img');image.alt=`${clip.fps}fps knight`;const note=document.createElement('p');note.textContent=clip.stride===1?'Every source frame':`Every ${clip.stride}th source frame`;const state=document.createElement('p');const links=document.createElement('p');card.append(title,image,note,state,links);document.getElementById('cards').append(card);views.push({clip,image,state,links,path:''});}
function frameAt(ms,durations){let end=0;for(let i=0;i<durations.length;i++){end+=durations[i];if(ms<end)return i;}return durations.length-1;}
function render(){const method=document.getElementById('method').value;for(const v of views){const i=frameAt(elapsed,v.clip.durations);const path=`${v.clip.folder}/${method}/frame-${String(i).padStart(3,'0')}.png`;if(v.path!==path){v.image.src=path;v.path=path;}v.state.textContent=`Pose ${i+1}/${v.clip.indices.length} · source frame ${v.clip.indices[i]}`;}document.getElementById('scrub').value=elapsed;document.getElementById('time').textContent=` ${(elapsed/1000).toFixed(2)} / ${(total/1000).toFixed(2)}s`;}
function updateLinks(){const method=document.getElementById('method').value;for(const v of views){v.links.replaceChildren();for(const [label,file] of [['Sheet','spritesheet.png'],['Metadata','spritesheet.json'],['APNG','preview.apng'],['GIF','preview.gif']]){const a=document.createElement('a');a.textContent=label+' ';a.href=`${v.clip.folder}/${method}/${file}`;v.links.append(a);}}}
document.getElementById('play').onclick=()=>{playing=!playing;document.getElementById('play').textContent=playing?'Pause':'Play';};
document.getElementById('restart').onclick=()=>{elapsed=0;render();};
document.getElementById('scrub').max=total-1;document.getElementById('scrub').oninput=e=>{playing=false;document.getElementById('play').textContent='Play';elapsed=Number(e.target.value);render();};
document.getElementById('method').onchange=()=>{updateLinks();render();};
function tick(t){if(last&&playing)elapsed=(elapsed+Math.min(t-last,250)*Number(document.getElementById('speed').value))%total;last=t;render();requestAnimationFrame(tick);}updateLinks();render();requestAnimationFrame(tick);
</script>'''.replace("PAYLOAD", payload)
    (out / "review.html").write_text(page)
    (out / "validation.json").write_text(json.dumps({"status": "valid", "cycle_duration_ms": duration,
        "kept_frame_pngs_match_full_rate_byte_for_byte": True, "cadences": records}, indent=2) + "\n")
    (out / "README.md").write_text("# Frame-skipping comparison\n\nOpen review.html for synchronized 16, 8 and 4fps playback. Each cadence contains nearest and Pyxelate 64px spritesheets, PNG frames, metadata, APNG and GIF previews. All loops last 2.75 seconds. Kept PNGs match their full-rate source byte for byte.\n\nFrom the repository, use export_sheet.py --frame-step 2 or --frame-step 4, then run compare_cadence.py. No model inference is needed. See each cadence README for the full export command.\n")
    archive = out / "cadence-comparison.zip"
    with ZipFile(archive, "w", ZIP_DEFLATED) as z:
        for path in sorted(out.rglob("*")):
            if path.is_file() and path != archive:
                z.write(path, str(path.relative_to(out)))
        for name in ("export_sheet.py", "compare_cadence.py", "test_frame_skipping.py"):
            z.write(ROOT / name, "scripts/" + name)
    with ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError("Archive CRC failed")
    print(out)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--job", default="knight-pixel")
    p.add_argument("--size", type=int, default=64)
    args = p.parse_args()
    build(args.job, args.size)
