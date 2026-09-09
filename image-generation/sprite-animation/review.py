"""Build an offline, synchronized animation comparison from completed attempts."""
import argparse
import html
import json
from pathlib import Path


def build_review(root):
    root = Path(root).resolve()
    results = json.loads((root / "results.json").read_text())
    clips = []
    for name, result in results.items():
        for attempt in result.get("attempts", []):
            job = Path(attempt["path"])
            report_path = job / "export/report.json"
            if not report_path.exists():
                continue
            report = json.loads(report_path.read_text())
            variants = {}
            for method in ("nearest", "conservative"):
                for size in (64, 128):
                    atlas = job / "export" / f"{method}-{size}"
                    if not (atlas / "spritesheet.json").exists():
                        continue
                    variants[f"{method}-{size}"] = {
                        "url": str((atlas / "spritesheet.png").relative_to(root)),
                        "data": json.loads((atlas / "spritesheet.json").read_text())}
            clips.append({"name": name, "seed": attempt["seed"], "quality": report["quality"],
                "variants": variants, "seconds": round(attempt["seconds"]),
                "comparison": str((job / "export/comparison.png").relative_to(root)),
                "report": str(report_path.relative_to(root)), "origin": report["origin"]})
    payload = json.dumps(clips).replace("</", "<\\/")
    template = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dark fantasy sprite animation comparison</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#181425;color:#ead4aa;font:16px system-ui,sans-serif}
main{max-width:1100px;margin:auto;padding:28px}h1{font-size:27px;margin:0 0 10px}p{line-height:1.5}
.controls{display:flex;gap:18px;flex-wrap:wrap;align-items:center;padding:16px 0;position:sticky;top:0;background:#181425;z-index:1}
button,select{font:inherit;background:#262b44;color:#fff;border:1px solid #5a6988;border-radius:5px;padding:7px}
article{border-top:1px solid #3a4466;margin-top:22px;padding-top:10px}h2{font-size:21px}
.variants{display:flex;gap:22px;flex-wrap:wrap}.panel{margin:0}canvas{display:block;width:256px;height:256px;image-rendering:pixelated;
background-color:#3a4466;background-image:conic-gradient(#262b44 25%,transparent 0 50%,#262b44 0 75%,transparent 0);background-size:16px 16px}
figcaption{padding:9px 0}a{color:#2ce8f5}.status{color:#fee761}.subtle{color:#c0cbdc;font-size:14px}
</style><main>
<h1>Dark fantasy animation pilot</h1>
<p>Compare the same generated motion, masks, frame indices and ENDESGA 32 palette.
Automatic checks do not certify anatomy, equipment or a good animation.</p>
<div class="controls"><button id="pause">Pause</button><label>Output <select id="size"><option>128</option><option>64</option></select></label>
<label>Background <select id="background"><option value="checker">Checker</option><option value="#ffffff">White</option><option value="#000000">Black</option><option value="#265c42">Green</option></select></label>
<label>Speed <select id="speed"><option value="1">1×</option><option value="0.5">0.5×</option><option value="2">2×</option></select></label></div>
<div id="clips"></div><p class="subtle">PNG sheets and timing JSON are the source assets. Canvas previews use integer enlargement with smoothing disabled. This page makes no external network or API requests.</p>
</main><script>
const clips=__DATA__, panels=[];const container=document.getElementById('clips');
function element(tag,text,parent){const e=document.createElement(tag);if(text)e.textContent=text;if(parent)parent.appendChild(e);return e;}
for(const clip of clips){const section=element('article','',container);element('h2',`${clip.name} · seed ${clip.seed}`,section);
const status=element('p',clip.quality.passed?'Automatic checks passed':`Rejected: ${clip.quality.reasons.join(', ')}`,section);status.className='status';
element('p',`${clip.origin} · ${clip.seconds}s total attempt`,section).className='subtle';const row=element('div','',section);row.className='variants';
for(const method of ['nearest','conservative']){const figure=element('figure','',row);figure.className='panel';const canvas=element('canvas','',figure);
const caption=element('figcaption','',figure);const variants={};for(const size of [64,128]){const variant=clip.variants[`${method}-${size}`];if(variant){const image=new Image();image.src=variant.url;variants[size]={...variant,image};}}
panels.push({canvas,caption,method,variants});}
for(const [label,url] of [['Comparison PNG',clip.comparison],['Measurements JSON',clip.report]]){const a=element('a',label,section);a.href=url;section.append(' · ');}
}
let paused=false,last=performance.now(),elapsed=0;
document.getElementById('pause').onclick=()=>{paused=!paused;document.getElementById('pause').textContent=paused?'Play':'Pause';};
function paint(now){if(!paused)elapsed+=(now-last)*Number(document.getElementById('speed').value);last=now;const size=Number(document.getElementById('size').value),bg=document.getElementById('background').value;
for(const panel of panels){const v=panel.variants[size];if(!v||!v.image.complete)continue;const frames=v.data.frames,total=frames.reduce((a,f)=>a+f.duration,0);let t=elapsed%total,index=0;while(index<frames.length-1&&t>=frames[index].duration)t-=frames[index++].duration;
const c=panel.canvas;if(c.width!==size){c.width=size;c.height=size;}c.style.backgroundImage=bg==='checker'?'':'none';c.style.backgroundColor=bg==='checker'?'#3a4466':bg;
const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,size,size);const f=frames[index].frame;ctx.drawImage(v.image,f.x,f.y,f.w,f.h,0,0,size,size);
panel.caption.textContent=`${panel.method==='nearest'?'Nearest + palette':'Conservative Pyxelate'} · ${size}px · frame ${index+1}/${frames.length}`;}
requestAnimationFrame(paint);}requestAnimationFrame(paint);
</script></html>'''
    target = root / "review.html"
    target.write_text(template.replace("__DATA__", payload))
    return target


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("run", type=Path)
    a = p.parse_args()
    print(build_review(a.run))
