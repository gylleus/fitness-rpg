#!/usr/bin/env python3
"""Automatic masks, fixed canvas exports and seam measurements on exported frames."""
import argparse
import html
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys

os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")
ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent / "sprite-animation"
sys.path.insert(0, str(BASE))
import numpy as np
from PIL import Image
from threadpoolctl import threadpool_limits
from common import save_json, sha256
from pixels import convert, export as base_export, comparison, mask_metrics, ground_anchor
from pipeline import worker
from previews import gif_preview


def export(frames, loop, out, name, pivot, metadata_extra=None):
    base_export(frames, loop, out, name, pivot, metadata_extra)
    gif_preview(out)


def transition_metrics(frames):
    """Measure the actual last-displayed → first-displayed step at native size.

    This deliberately does not score an unused generated endpoint or blur to 32px.
    Reports evidence, never labels art acceptable based on arbitrary thresholds.
    """
    a = np.stack([np.asarray(f.convert("RGBA"), dtype=np.float32) / 255 for f in frames])
    a[..., :3] *= a[..., 3:4]
    mask = a[..., 3] >= .5
    next_a, next_mask = np.roll(a, -1, axis=0), np.roll(mask, -1, axis=0)
    union = (mask | next_mask).sum((1, 2)).clip(1)
    distances = np.abs(next_a - a).sum((1, 2, 3)) / (4 * union)
    iou = (mask & next_mask).sum((1, 2)) / union
    changed = (np.any(a != next_a, axis=-1) & (mask | next_mask)).sum((1, 2)) / union
    internal = distances[:-1]
    incoming = a[-1] - a[-2]
    seam_velocity = a[0] - a[-1]
    outgoing = a[1] - a[0]
    occupancy = max(.001, float(mask.mean()))
    corner = float((np.abs(seam_velocity - incoming).mean() + np.abs(outgoing - seam_velocity).mean()) / (2 * occupancy))
    return {"transition_distances": distances.tolist(), "transition_silhouette_iou": iou.tolist(),
        "changed_visible_pixel_fraction": changed.tolist(),
        "wrap_distance": float(distances[-1]), "internal_median": float(np.median(internal)),
        "wrap_to_internal_median_ratio": float(distances[-1] / max(1e-6, float(np.median(internal)))),
        "wrap_silhouette_iou": float(iou[-1]), "wrap_changed_pixel_fraction": float(changed[-1]),
        "wrap_velocity_corner": corner,
        "note": "Native resolution, actual displayed frame order. Low scores can mean static animation; no automatic artistic pass."}


def process(job_name):
    out = ROOT / "outputs" / job_name
    generation = json.loads((out / "generation.json").read_text())
    settings = generation["generation"]
    if not (out / "tracking/tracking.json").exists():
        worker("track", out / "frames", out / "tracking", log=out / "tracking.log")
    frames = [Image.open(p).convert("RGBA") for p in sorted((out / "tracking/cutouts").glob("*.png"))]
    if len(frames) != settings["length"] or any(f.size != (settings["size"], settings["size"]) for f in frames):
        raise ValueError("Tracked frames do not match the generated sequence")
    # Keep the input camera canvas fixed for every frame and every 14B ablation.
    # No per-frame or per-clip fitting, recentering, or rescaling of the silhouette.
    indices = np.linspace(0, len(frames) - 1, 12, endpoint=False).astype(int).tolist()
    boundaries = np.rint(np.arange(13) * (len(frames) - 1) / settings["fps"] * 1000 / 12).astype(int)
    loop = {"start": 0, "end_exclusive": len(frames) - 1, "indices": indices,
        "durations_ms": np.diff(boundaries).tolist(),
        "selection": "Full requested cycle, final boundary frame omitted; no best-interval search, ping-pong or crossfade."}
    full_boundaries = np.rint(np.arange(len(frames)) * 1000 / settings["fps"]).astype(int)
    full_loop = {**loop, "indices": list(range(len(frames) - 1)),
        "durations_ms": np.diff(full_boundaries).tolist()}
    # Freeze the pivot from the original native reference, not the generated
    # first frame or an old crop's metadata. All ablations share this anchor.
    reference = Image.open(ROOT / "inputs" / (generation["job"]["preset"] + "-128.png")).convert("RGBA")
    pivot = generation["preset"]["pivot"]
    if generation["preset"]["anchor"] in ("ground", "stationary"):
        point = ground_anchor(np.asarray(reference.getchannel("A")) >= 128)
        pivot = [float(point[0]) / reference.width, float(point[1]) / reference.height]
    report = {"generation": generation, "loop": loop, "full_rate_loop": full_loop,
        "processing_provenance": {"analyze_sha256": sha256(Path(__file__)),
            "pixels_sha256": sha256(BASE / "pixels.py"), "palette_sha256": sha256(BASE / "palette.json")},
        "pivot": pivot, "pivot_source": "fixed native input reference",
        "tracking": json.loads((out / "tracking/tracking.json").read_text()),
        "mask_metrics": mask_metrics(frames, generation["preset"]["anchor"]), "variants": {},
        "art_status": "Needs visual assessment; file validity is not an animation-quality pass."}
    panels = []
    with threadpool_limits(limits=4):
        for size in (64, 128):
            for method in ("nearest", "conservative"):
                name = f"{method}-{size}"
                print(job_name, name, flush=True)
                sequence = [convert(f, size, method, color_metric="ciede2000") for f in frames]
                dest = out / "export" / name
                export(sequence, loop, dest, generation["job"]["preset"], pivot,
                    {"origin": "Wan2.2-I2V-A14B FP8 + optional pixel adapter", "fixed_canvas": settings["size"],
                     "art_status": "unapproved", "method": method})
                export(sequence, full_loop, dest / "full-rate", generation["job"]["preset"], pivot,
                    {"origin": "Wan2.2-I2V-A14B FP8 + optional pixel adapter", "fixed_canvas": settings["size"],
                     "art_status": "unapproved", "method": method, "cadence": "original generated frame rate"})
                (dest / "all-frames").mkdir(exist_ok=True)
                for i, f in enumerate(sequence):
                    f.save(dest / "all-frames" / f"{i:05d}.png")
                full = sequence[:-1]
                # Reuse the explicit integer duration schedule. Pillow rounds a
                # scalar 62.5ms to 62ms per frame, shortening a 16fps cycle.
                shutil.copyfile(dest / "full-rate/preview.apng", dest / "full.apng")
                displayed = [sequence[i] for i in indices]
                metrics = transition_metrics(displayed)
                metrics["full_rate"] = transition_metrics(full)
                metrics["decoded_boundary"] = transition_metrics([sequence[0], sequence[-1]])
                report["variants"][name] = metrics
                if size == 128:
                    panels.append((method, displayed))
                # Inspect the actual wrap: two final frames, first, second.
                comparison([(f"{job_name}: {name} wrap", [(str(indices[i]), displayed[i]) for i in (-2, -1, 0, 1)])],
                           dest / "wrap.png")
                comparison([(f"{job_name}: {name} full-rate wrap", [(str(i), sequence[i]) for i in (len(frames)-3, len(frames)-2, 0, 1)])],
                           dest / "full-rate/wrap.png")
    rows = [(f"{job_name} / {method} / complete 12-frame cycle", [(str(indices[i]), seq[i]) for i in range(12)]) for method, seq in panels]
    comparison(rows, out / "cycle-sheet.png")
    save_json(out / "assessment.json", report)
    build_review()
    return report


def build_review():
    records = []
    rows = []
    review_path = ROOT / "visual-review.json"
    reviews = json.loads(review_path.read_text()).get("jobs", {}) if review_path.exists() else {}
    for path in sorted((ROOT / "outputs").glob("*/assessment.json")):
        report = json.loads(path.read_text())
        job = path.parent.name
        loop = report["loop"]
        settings = report["generation"]["generation"]
        raw_indices = sorted(set([*range(0, settings["length"], 8), settings["length"] - 1]))
        raw_cycle = [(str(i), Image.open(path.parent / "frames" / f"{i:05d}.png").resize((128, 128), Image.Resampling.NEAREST))
                     for i in raw_indices]
        comparison([(f"{job}: raw generation, nearest to 128px, no mask or palette mapping", raw_cycle)], path.parent / "raw-cycle.png")
        records.append({"name": job, "settings": settings, "durations": report["full_rate_loop"]["durations_ms"],
            "compact_durations": loop["durations_ms"],
            "metrics": report["variants"]["nearest-128"]["full_rate"], "root": job,
            "review": reviews.get(job, {})})
        raw = [Image.open(path.parent / "frames" / f"{loop['indices'][i]:05d}.png").resize((128, 128), Image.Resampling.NEAREST)
               for i in (0, 3, 6, 9, 11)]
        rows.append((f"{job}: raw generation, nearest to 128px, no mask or palette mapping",
            [(f"frame {i}", f) for i, f in zip((0, 3, 6, 9, 11), raw)]))
        for method in ("nearest", "conservative"):
            folder = path.parent / "export" / f"{method}-128"
            selected = [Image.open(folder / f"frame-{i:03d}.png") for i in (0, 3, 6, 9, 11)]
            rows.append((f"{job}: {method} (native 128px)", [(f"frame {i}", f) for i, f in zip((0, 3, 6, 9, 11), selected)]))
    if rows:
        comparison(rows, ROOT / "outputs/comparison.png")
    payload = json.dumps(records).replace("<", "\\u003c")
    page = '''<!doctype html><meta charset="utf-8"><title>Local pixel animation 14B comparison</title>
<style>body{background:#181425;color:#ead4aa;font:16px system-ui;margin:24px}button,select{font:inherit;margin:6px;padding:6px}main{display:flex;flex-wrap:wrap;gap:20px}article{max-width:560px;background:#262b44;padding:16px}img{image-rendering:pixelated;background:repeating-conic-gradient(#3a4466 0 25%,#262b44 0 50%) 0/24px 24px;width:256px;height:256px}h2{font-size:18px}a{color:#2ce8f5}small{display:block;max-width:520px}p{max-width:1000px}label{display:inline-block}</style>
<h1>Wan 14B pixel-adapter experiment</h1>
<p>All new jobs use the same fixed canvas, ENDESGA 32 and automatic masks. Left: nearest. Right: conservative Pyxelate. These are experimental candidates; no numerical score certifies animation quality. The comparison sheet also includes unmasked raw frames downscaled without palette mapping.</p>
<button id="play">Pause</button><button id="prev">Previous frame</button><button id="next">Next frame</button>
<label>Speed <select id="speed"><option value="1">1×</option><option value=".5">½×</option><option value=".25">¼×</option></select></label>
<label>Size <select id="size"><option>128</option><option>64</option></select></label>
<label>Cadence <select id="cadence"><option value="full">Full generated rate</option><option value="compact">Compact 12-frame atlas</option></select></label>
<p id="position"></p><main id="cards"></main>
<p><a href="comparison.png">Labeled comparison sheet</a> · <a href="../../sprite-animation/outputs/delivery/review.html">Previous 5B pilot (different input preparation/settings)</a></p>
<script>const jobs=PAYLOAD;let playing=true,clock=0,last=0,frame=0;const images=[];
for(const j of jobs){const a=document.createElement('article');const h=document.createElement('h2');h.textContent=j.name;a.append(h);const pair=[];
for(const method of ['nearest','conservative']){const im=document.createElement('img');im.alt=j.name+' '+method;a.append(im);pair.push({im,method,job:j.root});}images.push(...pair);
const p=document.createElement('p');p.textContent=`Pixel adapter ${j.settings.pixel_lora}; ending-frame conditioning ${j.settings.end_condition}; ${j.settings.steps} steps. Wrap / median internal change: ${j.metrics.wrap_to_internal_median_ratio.toFixed(2)}×`;a.append(p);
if(j.review.summary){const note=document.createElement('p');note.textContent=j.review.summary;a.append(note);}
for(const [title,url] of [['Full-rate animation',`${j.root}/export/nearest-128/full.apng`],['Spritesheet',`${j.root}/export/nearest-128/full-rate/spritesheet.png`],['Input reference',`${j.root}/reference.png`],['Raw data',`${j.root}/assessment.json`]]){const link=document.createElement('a');link.textContent=title+' ';link.href=url;a.append(link);}document.getElementById('cards').append(a);}
function durations(){return jobs.length?(document.getElementById('cadence').value==='full'?jobs[0].durations:jobs[0].compact_durations):[100];}
function render(){const size=document.getElementById('size').value;const folder=document.getElementById('cadence').value==='full'?'full-rate/':'';for(const p of images)p.im.src=`${p.job}/export/${p.method}-${size}/${folder}frame-${String(frame).padStart(3,'0')}.png`;document.getElementById('position').textContent=`Frame ${frame+1}/${durations().length} — inspect the ${durations().length} → 1 transition`;}
function step(d){playing=false;document.getElementById('play').textContent='Play';frame=(frame+d+durations().length)%durations().length;render();}
document.getElementById('prev').onclick=()=>step(-1);document.getElementById('next').onclick=()=>step(1);document.getElementById('size').onchange=render;
document.getElementById('cadence').onchange=()=>{frame=0;clock=0;render();};
document.getElementById('play').onclick=()=>{playing=!playing;document.getElementById('play').textContent=playing?'Pause':'Play';clock=0;};
function tick(t){if(last&&playing&&jobs.length){clock+=Math.min(t-last,250)*Number(document.getElementById('speed').value);while(clock>=durations()[frame]){clock-=durations()[frame];frame=(frame+1)%durations().length;render();}}last=t;requestAnimationFrame(tick);}render();requestAnimationFrame(tick);
</script>'''.replace("PAYLOAD", payload)
    (ROOT / "outputs/review.html").write_text(page)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("job", nargs="?")
    a = p.parse_args()
    process(a.job) if a.job else build_review()
