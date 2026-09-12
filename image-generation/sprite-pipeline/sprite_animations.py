"""Reuse the installed Wan expert runner, mask tracker, and Pyxelate reducer."""
from __future__ import annotations
import importlib.metadata
import json
import math
import os
from pathlib import Path
import shutil
import sys
import time
import uuid

from sprites import BASE, WAN, ROOT, STUDY, load, save_json, sha256, entries, subject, id_field, actions_for, motion, looping


def selected(config, enemies=None):
    if enemies and set(enemies) - {subject(e)["id"] for e in entries(config)}:
        raise ValueError("Unknown asset in this run")
    return [e for e in entries(config) if not enemies or subject(e)["id"] in enemies]


def animate(run, enemies=None, action=None, mask_check_every=8):
    config = load(run)
    candidates = selected(config, enemies)
    if not any(actions_for(config, entry) for entry in candidates):
        if action:
            raise ValueError("Selected assets do not define the requested action")
        print("Static-only assets: no animation inference needed", flush=True)
        return
    import run as wan_run
    from common import COMFY_REV, SAM_REV, PYX_REV
    from pipeline import worker
    if type(mask_check_every) is not int or mask_check_every < 1:
        raise ValueError("Mask diagnostic interval must be a positive integer")
    if action and action not in config["actions"]:
        raise ValueError("Action is not in the run plan")
    jobs = []
    for entry in selected(config, enemies):
        if action and action not in actions_for(config, entry):
            continue
        key = subject(entry)["id"]
        reference = run / "references" / key / "reference.png"
        from reference_assets import verify_prepared
        verify_prepared(reference.parent)
        for act in ([action] if action else actions_for(config, entry)):
            out = run / "animations" / key / act
            out.mkdir(parents=True, exist_ok=True)
            settings = {**config["animation_generation"], "seed": entry["seeds"][act],
                        "end_condition": looping(subject(entry), act)}
            preset = {"prompt": entry["prompts"]["motions"][act], "negative": entry["prompts"]["negative"]}
            contract = {id_field(config): key, "action": act, "preset": preset, "generation": settings,
                "reference_sha256": sha256(reference), "model_manifest_sha256": config["model_manifest_sha256"]}
            saved = out / "config.json"
            if saved.exists() and json.loads(saved.read_text()) != contract:
                raise ValueError(f"Existing animation contract differs: {out}")
            save_json(saved, contract)
            provenance = out / "provenance.json"
            if not provenance.exists():
                save_json(provenance, {"comfy_revision": COMFY_REV, "sam2_revision": SAM_REV,
                    "pyxelate_revision": PYX_REV, "python": sys.version,
                    "models": {p.parent.name: json.loads(p.read_text()) for p in
                        (WAN / "models.lock.json", BASE / "models.lock.json")},
                    "dependencies": {d.metadata["Name"]: d.version for d in importlib.metadata.distributions()},
                    "code_sha256": {str(p.relative_to(ROOT.parent)): sha256(p) for folder in (ROOT, WAN, BASE)
                                    for p in folder.glob("*.py")},
                    "conditioning": "Native Wan conditioning; loops use experimental same-first-and-last reference. One-shot actions use start reference only. Negative prompt has no CFG effect at cfg=1."})
            jobs.append({"out": out, "reference": reference, "contract": contract, "stages": {}})
    if action and not jobs:
        raise ValueError("Selected assets do not define the requested action")
    # Load each expert once for the batch. Still only one 14B expert resident.
    for stage in ("high", "low"):
        pending = []
        for job in jobs:
                stage_out = job["out"] / stage
                record = stage_out / "completed.json"
                if record.exists():
                    saved_stage = json.loads(record.read_text())
                    paths = [stage_out / p for p in saved_stage["files"]]
                    expected = 1 if stage == "high" else job["contract"]["generation"]["length"]
                    if len(paths) != expected:
                        raise ValueError("Incomplete animation stage manifest")
                    if any(not p.exists() or sha256(p) != saved_stage["files"][str(p.relative_to(stage_out))] for p in paths):
                        raise ValueError("Animation stage hash mismatch")
                else:
                    pending.append(job)
        if pending:
            shared = run / "expert-batches" / f"{stage}-{time.time_ns()}"
            with wan_run.server(shared) as (url, proc):
                for job in pending:
                    if shutil.disk_usage(run).free < 700 * 2**20:
                        raise RuntimeError("Less than 700 MiB disk free; safely stopped between jobs")
                    stage_out = job["out"] / stage
                    stage_out.mkdir(parents=True, exist_ok=True)
                    c = job["contract"]
                    name = f"{c[id_field(config)]}-{c['action']}"
                    shutil.copyfile(job["reference"], shared / "input" / f"{name}.png")
                    if stage == "low":
                        high = json.loads((job["out"] / "high/completed.json").read_text())
                        handoff = job["out"] / "high" / next(iter(high["files"]))
                        shutil.copyfile(handoff, shared / "input" / f"{name}.latent")
                    graph = wan_run.workflow(f"{name}.png", c["preset"], c["generation"], stage, f"{name}.latent")
                    graph["11"]["inputs"]["filename_prefix"] = name
                    save_json(stage_out / "workflow-api.json", graph)
                    print(f"{name}: {stage} expert", flush=True)
                    started = time.monotonic()
                    result = submit(url, proc, graph, stage_out)
                    items = result["outputs"]["11"]["latents" if stage == "high" else "images"]
                    if len(items) != (1 if stage == "high" else c["generation"]["length"]):
                        raise ValueError("Unexpected number of generated outputs")
                    files = {}
                    (stage_out / "output").mkdir(exist_ok=True)
                    for item in items:
                        source = shared / "output" / item["subfolder"] / item["filename"]
                        target = stage_out / "output" / item["filename"]
                        if target.exists():
                            if sha256(source) != sha256(target):
                                raise ValueError("Existing partial stage differs from rerun; preserve and inspect it")
                        else:
                            os.link(source, target)
                        files[str(target.relative_to(stage_out))] = sha256(target)
                    save_json(stage_out / "completed.json", {"seconds": time.monotonic()-started,
                        "files": files, "shared_expert_session": str(shared.relative_to(run))})
    # Servers have exited before mask models are loaded.
    for job in jobs:
            out, contract = job["out"], job["contract"]
            stages = {stage: json.loads((out / stage / "completed.json").read_text()) for stage in ("high", "low")}
            paths = [out / "low" / p for p in stages["low"]["files"]]
            frames = out / "frames"
            frames.mkdir(exist_ok=True)
            for i, source in enumerate(paths):
                target = frames / f"{i:05d}.png"
                if target.exists():
                    if sha256(target) != sha256(source):
                        raise ValueError("Raw frame changed")
                else:
                    os.link(source, target)
            save_json(out / "generation.json", {**contract, "stages": stages, "frames": len(paths)})
            if not (out / "tracking/tracking.json").exists():
                save_json(out / "masking-settings.json", {"check_every": mask_check_every,
                    "meaning": "Independent BiRefNet diagnostic cadence; SAM foreground tracking covers every frame",
                    "masking_script_sha256": sha256(BASE / "masking.py")})
                worker("track", frames, out / "tracking", "--check-every", str(mask_check_every), log=out / "tracking.log")
            print(f"Finished {contract[id_field(config)]}/{contract['action']}: {len(paths)} raw frames and automatic masks", flush=True)
            # Refresh exports once every planned action for this asset is ready.
            key = contract[id_field(config)]
            if all((run / "animations" / key / act / "tracking/tracking.json").exists() for act in next(actions_for(config, e) for e in entries(config) if subject(e)["id"] == key)):
                export(run, [key])
                review(run)


def submit(url, proc, graph, out):
    import requests
    r = requests.post(url + "/prompt", json={"prompt": graph, "client_id": str(uuid.uuid4())}, timeout=30)
    save_json(out / "submission.json", r.json())
    r.raise_for_status()
    prompt_id = r.json()["prompt_id"]
    deadline = time.monotonic()+3600
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError("Owned ComfyUI process exited; see shared expert session log")
        response = requests.get(url + f"/history/{prompt_id}", timeout=30)
        response.raise_for_status()
        result = response.json().get(prompt_id)
        if result:
            save_json(out / "history.json", result)
            status = result.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"Local inference failed: {out / 'history.json'}")
            if status.get("completed"):
                return result
        time.sleep(2)
    raise TimeoutError("Animation exceeded one hour")


def timing(length, fps, action, step, loop=None):
    from export_sheet import skip_frames
    if loop is None:
        loop = action == "idle"
    if length < 3 or fps <= 0:
        raise ValueError("Invalid action/timing")
    count = length - 1 if loop else length
    boundaries = [round(i * 1000/fps) for i in range(count+1)]
    base = {"start": 0, "end_exclusive": count, "indices": list(range(count)),
            "durations_ms": [b-a for a, b in zip(boundaries, boundaries[1:])],
            "repeat": loop, "action": action}
    result = skip_frames(base, step)
    result["endpoint_policy"] = ("Omit generated cycle boundary frame" if loop else
                                  "Keep complete one-shot clip; preview repetition is only a viewing aid")
    return result


def export_options(config, size=None, frame_step=None):
    options = {**config["export"]}
    if size is not None:
        options["size"] = size
    if frame_step is not None:
        options["frame_step"] = frame_step
    if not 16 <= options["size"] <= 256 or not 1 <= options["frame_step"] <= 16:
        raise ValueError("Use frame size 16..256 and frame step 1..16")
    suffix = "" if options == config["export"] else f"-{options['size']}-step-{options['frame_step']}"
    return options, suffix


def export(run, enemies=None, action=None, size=None, frame_step=None):
    import numpy as np
    from PIL import Image
    from pixels import convert, fixed_crop, comparison
    from analyze import export as export_pixels, transition_metrics
    from export_sheet import verify
    from threadpoolctl import threadpool_limits
    config = load(run)
    options, suffix = export_options(config, size, frame_step)
    size, columns = options["size"], options["columns"]
    for entry in selected(config, enemies):
        key = subject(entry)["id"]
        if subject(entry).get("kind") == "background":
            from backgrounds import export as export_background
            export_background(run, entry, options, suffix)
            continue
        reference = Image.open(run / "references" / key / "reference-cutout.png").convert("RGBA")
        source_meta = json.loads((run / "references" / key / "source.json").read_text())
        frames, paths = {}, {}
        # Always require and measure all planned actions, even when exporting one.
        for act in actions_for(config, entry):
            folder = run / "animations" / key / act
            paths[act] = sorted((folder / "tracking/cutouts").glob("*.png"))
            if not (folder / "tracking/tracking.json").exists() or len(paths[act]) != config["animation_generation"]["length"]:
                raise ValueError(f"Incomplete masks for {key}/{act}; cannot freeze shared framing yet")
            frames[act] = [Image.open(p).convert("RGBA") for p in paths[act]]
        if "assets" in config or not frames:
            frames["reference"] = [reference]
        combined = [reference, *[f for seq in frames.values() for f in seq]]
        # Include the ground origin in the fit, including below hovering bodies.
        # This measurement-only marker is never added to any sprite pixels.
        origin = Image.new("RGBA", reference.size)
        origin.putpixel(tuple(min(511, max(0, round(source_meta["pivot"][i]*512))) for i in (0,1)), (255,255,255,255))
        combined.append(origin)
        _, box = fixed_crop(combined, options["margin"])
        side = box[2]-box[0]
        pivot = [(source_meta["pivot"][i]*512-box[i])/side for i in (0,1)]
        idle_bbox = reference.getbbox()
        idle_height = (idle_bbox[3]-idle_bbox[1])*size/side
        folder = run / ("exports"+suffix) / key
        folder.mkdir(parents=True, exist_ok=True)
        manifest = {id_field(config): key, "name": subject(entry)["name"], "facing": config["facing"],
            "frame_size": [size, size], "shared_crop": box, "pivot": pivot,
            "height_scale": subject(entry)["visual"]["height_scale"], "reference_idle_height_px": idle_height,
            "display_scale_formula": "height_scale * adventurer_idle_height_in_game_pixels / reference_idle_height_px",
            "framing": "One square union crop for reference, ground origin and every frame of every planned action. No per-frame fit, recenter, or aspect stretch.",
            "palette": options["palette"], "source_palette": subject(entry)["visual"]["palette"],
            "pyxelate": {"mode": "conservative geometry + CIEDE2000 palette mapping", "svd": False,
                         "dither": "none", "sobel": 3, "depth": 1},
            "cutout_sha256": {act: {p.name: sha256(p) for p in ps} for act, ps in paths.items()},
            "source_reference_sha256": sha256(run / "references" / key / "reference-cutout.png"),
            "code_sha256": {str(p.relative_to(ROOT.parent)): sha256(p) for p in
                (Path(__file__), BASE / "pixels.py", WAN / "analyze.py", WAN / "export_sheet.py", WAN / "previews.py")},
            "actions": {}, "art_status": "Experimental candidate; technical validation is not visual approval"}
        rows = []
        with threadpool_limits(limits=4):
            for act, seq in frames.items():
                schedule = ({"start": 0, "end_exclusive": 1, "indices": [0], "durations_ms": [1000],
                             "repeat": False, "action": "reference", "endpoint_policy": "Single static reference; duration is a preview hold"}
                            if act == "reference" else
                            timing(len(seq), config["animation_generation"]["fps"], act, options["frame_step"], looping(subject(entry), act)))
                manifest["actions"][act] = {"timing": schedule, "variants": {}}
                for label, method in (("nearest", "nearest"), ("pyxelate", "conservative")):
                    dest = folder / act / label
                    selected_frames = {i: convert(seq[i].crop(box), size, method, color_metric="ciede2000")
                                       for i in schedule["indices"]}
                    export_pixels(selected_frames, schedule, dest, act, pivot,
                        {id_field(config): key, "action": act, "facing": config["facing"],
                         "repeat": schedule["repeat"], "preview_repeat": True, "height_scale": manifest["height_scale"],
                         "reference_idle_height_px": idle_height, "fixed_source_crop": box, "method": label})
                    atlas = json.loads((dest / "spritesheet.json").read_text())
                    count = len(atlas["frames"])
                    sheet = Image.new("RGBA", (columns*size, math.ceil(count/columns)*size))
                    for i, record in enumerate(atlas["frames"]):
                        x,y = (i % columns)*size, (i // columns)*size
                        sheet.paste(selected_frames[record["source_frame"]], (x,y))
                        record["frame"]["x"], record["frame"]["y"] = x,y
                    sheet.save(dest / "spritesheet.png")
                    atlas["meta"]["size"] = {"w": sheet.width, "h": sheet.height}
                    atlas["meta"]["grid"] = {"columns": columns, "rows": math.ceil(count/columns), "order": "row-major"}
                    save_json(dest / "spritesheet.json", atlas)
                    check = verify(dest, size, count, sum(schedule["durations_ms"]), columns)
                    displayed = list(selected_frames.values())
                    check["transition_metrics"] = (transition_metrics(displayed) if len(displayed) >= 2 else
                                                   {"note": "Single displayed pose; no motion metrics"})
                    if not schedule["repeat"]:
                        check["transition_metrics"]["note"] += " Action is one-shot; wrap metrics describe preview repetition only."
                    manifest["actions"][act]["variants"][label] = check
                    chosen = sorted(set([0, count//4, count//2, 3*count//4, count-1]))
                    rows.append((f"{key} / {act} / {label} / {size}px / step {options['frame_step']}",
                        [(str(schedule["indices"][i]), displayed[i]) for i in chosen]))
                    if schedule["repeat"] and len(displayed) >= 2:
                        comparison([(f"{key} {label} actual {act} wrap",
                            [(str(schedule["indices"][i]), displayed[i]) for i in (-2,-1,0,1)])], dest / "wrap.png")
                if act == "reference":
                    continue
                raw_paths = sorted((run / "animations" / key / act / "frames").glob("*.png"))
                samples = sorted(set([0, len(seq)//4, len(seq)//2, 3*len(seq)//4, len(seq)-1]))
                comparison([(f"{key} {act}: raw motion before masking", [(str(i), Image.open(raw_paths[i]).resize((128,128), Image.Resampling.NEAREST)) for i in samples]),
                            ("automatic masks before pixel conversion", [(str(i), seq[i].resize((128,128), Image.Resampling.NEAREST)) for i in samples])], folder / f"{act}-mask-review.png")
        comparison(rows, folder / "comparison.png")
        save_json(folder / "manifest.json", manifest)
        print(f"Exported {key}: {len(frames)} states, both {size}px reducers validated", flush=True)
    review(run, size=size, frame_step=options["frame_step"])


def review(run, enemies=None, action=None, size=None, frame_step=None):
    from PIL import Image
    from pixels import comparison
    config = load(run)
    options, suffix = export_options(config, size, frame_step)
    export_root = "exports"+suffix
    records, rows = [], []
    reference_review_path = run / "reference-review.json"
    reference_reviews = json.loads(reference_review_path.read_text()) if reference_review_path.exists() else {}
    motion_review_path = run / "visual-review.json"
    motion_reviews = json.loads(motion_review_path.read_text()).get("jobs", {}) if motion_review_path.exists() else {}
    for entry in entries(config):
        key = subject(entry)["id"]
        manifest_path = run / export_root / key / "manifest.json"
        if not manifest_path.exists():
            continue
        manifest = json.loads(manifest_path.read_text())
        for act, result in manifest["actions"].items():
            folder = f"{export_root}/{key}/{act}"
            records.append({"name": subject(entry)["name"], id_field(config): key, "action": act,
                "kind": subject(entry).get("kind", "enemy"),
                "direction": "Static ready pose from the selected reference." if act == "reference" else motion(subject(entry), act),
                "folder": folder, "timing": result["timing"],
                "height_scale": manifest["height_scale"], "reference_review": reference_reviews.get(key, {}),
                "motion_review": motion_reviews.get(f"{key}/{act}", {})})
            schedule = result["timing"]
            last = len(schedule["indices"])-1
            panels = []
            for method in ("nearest", "pyxelate"):
                for i in (0, last//2, last):
                    panels.append((f"{method} f{schedule['indices'][i]}", Image.open(run / folder / method / f"frame-{i:03d}.png")))
            rows.append((f"{key} / {act} / {config['facing']}-facing / {options['size']}px", panels))
    if rows:
        comparison(rows, run / f"comparison{suffix}.png")
    payload = json.dumps(records).replace("<", "\\u003c")
    template = (ROOT / "viewer.html").read_text()
    template = template.replace('href="comparison.png"', f'href="comparison{suffix}.png"').replace('href="index.json"', f'href="index{suffix}.json"')
    if (run / "reference-review.html").exists():
        template = template.replace('href="references.png"', 'href="reference-review.html"')
    (run / f"review{suffix}.html").write_text(template.replace("__DATA__", payload))
    save_json(run / f"index{suffix}.json", {"planned_assets": len(entries(config)),
        "completed_animations": sum(r["action"] != "reference" for r in records),
        "completed_stills": sum(r["action"] == "reference" for r in records),
        "export_settings": options, "animations": records})
    print(f"Review updated: {len(records)} completed states", flush=True)


def package(run, enemies=None, action=None):
    """Compact, self-contained preview/atlas archive; raw video data stays in repo."""
    from zipfile import ZipFile, ZIP_DEFLATED
    config = load(run)
    index = json.loads((run / "index.json").read_text())
    expected = sum(len(actions_for(config, e)) for e in entries(config))
    if index["completed_animations"] != expected:
        raise ValueError("Cannot package an incomplete batch")
    if "assets" in config and index.get("completed_stills") != len(entries(config)):
        raise ValueError("Cannot package incomplete reference exports")
    paths = [p for folder in run.glob("exports*") if folder.is_dir() for p in folder.rglob("*") if p.is_file()]
    paths.extend(p for p in run.glob("*") if p.is_file() and p.suffix in (".png", ".html", ".json", ".md"))
    paths.extend(p for p in (run / "references").rglob("*") if p.is_file())
    paths.extend(p for p in (run / "inputs").rglob("*") if p.is_file())
    archive = run / ("sprites.zip" if "assets" in config else "enemy-sprites.zip")
    with ZipFile(archive, "w", ZIP_DEFLATED) as z:
        for path in sorted(set(paths)):
            z.write(path, str(path.relative_to(run)))
        for entry in entries(config):
            key = subject(entry)["id"]
            source = json.loads((run / "references" / key / "source.json").read_text())
            original = ROOT.parent / source["original"]
            z.write(original, f"selected-originals/{key}.png")
            if original.with_suffix(".json").exists():
                z.write(original.with_suffix(".json"), f"selected-originals/{key}.json")
        for path in [ROOT / "README.md", *ROOT.glob("*.py"), ROOT / "viewer.html"]:
            z.write(path, "pipeline/"+path.name)
        if config["reference_generation"].get("guide_image"):
            guide = (run / config["reference_generation"]["guide_image"]).resolve()
            z.write(guide, "guide/"+guide.name)
            if guide.with_suffix(".json").exists():
                z.write(guide.with_suffix(".json"), "guide/"+guide.with_suffix(".json").name)
        for entry in entries(config):
            if entry.get("reference_guide"):
                guide = (run / entry["reference_guide"]["image"]).resolve()
                z.write(guide, f"guide/{subject(entry)['id']}{guide.suffix}")
        for path in (BASE / "requirements.lock.txt", STUDY / "requirements.lock.txt", BASE / "models.lock.json", WAN / "models.lock.json"):
            z.write(path, "provenance/"+path.parent.name+"/"+path.name)
        for folder in (BASE, WAN):
            for path in folder.glob("*.py"):
                z.write(path, "provenance/code/"+folder.name+"/"+path.name)
    with ZipFile(archive) as z:
        if z.testzip() is not None:
            raise ValueError("ZIP integrity failure")
    print(f"Packaged {expected} animations: {archive} ({archive.stat().st_size / 2**20:.1f} MiB)", flush=True)
