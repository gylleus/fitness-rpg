"""SDXL references with untruncated CLIP chunks; automatic pre-animation cutouts."""
import importlib.metadata
import json
import math
from pathlib import Path
import time

from sprites import BASE, ROOT, STUDY, load, save_json, sha256, entries, subject, id_field, actions_for, motion, looping


def token_chunks(tokens, tokenizer, count, repeat=False):
    width = tokenizer.model_max_length - 2
    chunks = []
    for i in range(count):
        offset = (i % max(1, math.ceil(len(tokens)/width))) if repeat else i
        piece = tokens[offset*width:(offset+1)*width]
        chunks.append([tokenizer.bos_token_id, *piece, tokenizer.eos_token_id] +
                      [tokenizer.pad_token_id] * (width - len(piece)))
    return chunks


def conditioning(pipe, prompt, negative):
    """Concatenate penultimate CLIP states; use first CLIP-G pooled chunk.

    Same tokenization/hidden layer as installed Diffusers SDXL. This explicit
    long-prompt extension retains every token instead of SDXL's default truncation.
    It is a run setting, not a claim that every described detail will be obeyed.
    """
    import torch
    tokenizers = [pipe.tokenizer, pipe.tokenizer_2]
    encoders = [pipe.text_encoder, pipe.text_encoder_2]
    ids = [[t(s, add_special_tokens=False, truncation=False)["input_ids"] for t in tokenizers]
           for s in (prompt, negative)]
    count = max(math.ceil(len(tokens)/(t.model_max_length-2))
                for side in ids for tokens, t in zip(side, tokenizers))
    embeddings, pools = [], []
    with torch.inference_mode():
        for side_index, side in enumerate(ids):
            features = []
            for index, (tokens, tokenizer, encoder) in enumerate(zip(side, tokenizers, encoders)):
                chunks = torch.tensor(token_chunks(tokens, tokenizer, count, repeat=side_index == 1), device="cuda")
                output = encoder(chunks, output_hidden_states=True)
                features.append(output.hidden_states[-2].flatten(0, 1).unsqueeze(0))
                if index == 1:
                    pools.append(output.text_embeds[:1])
            embeddings.append(torch.cat(features, dim=-1))
    return {"prompt_embeds": embeddings[0], "negative_prompt_embeds": embeddings[1],
            "pooled_prompt_embeds": pools[0], "negative_pooled_prompt_embeds": pools[1]}, {
        "mode": "75-content-token CLIP chunks, concatenated penultimate states, first CLIP-G pool; negative chunks repeated to match length",
        "positive_token_counts": [len(x) for x in ids[0]], "negative_token_counts": [len(x) for x in ids[1]],
        "chunks": count, "truncated_tokens": 0}


def generate(run):
    import torch
    from diffusers import AutoencoderKL, DPMSolverMultistepScheduler, StableDiffusionXLPipeline, StableDiffusionXLImg2ImgPipeline
    from PIL import Image
    from PIL.PngImagePlugin import PngInfo
    config = load(run)
    needed = []
    for entry in entries(config):
        path = run / "originals" / (subject(entry)["id"] + ".png")
        if path.exists():
            record = json.loads(path.with_suffix(".json").read_text())
            if sha256(path) != record["sha256"] or record["entry"] != entry or record["settings"] != config["reference_generation"]:
                raise ValueError(f"Reference provenance mismatch: {path}")
        else:
            needed.append((entry, path))
    if not needed:
        print("All original references already verified", flush=True)
        return
    if not torch.cuda.is_available():
        raise RuntimeError("Local CUDA device unavailable")
    torch.set_num_threads(4)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True)
    settings = config["reference_generation"]
    vae = AutoencoderKL.from_pretrained(STUDY / "models/vae", torch_dtype=torch.float16, local_files_only=True)
    pipeline_class = StableDiffusionXLImg2ImgPipeline if settings.get("guide_image") else StableDiffusionXLPipeline
    pipe = pipeline_class.from_pretrained(STUDY / "models/sdxl", vae=vae, variant="fp16",
        torch_dtype=torch.float16, use_safetensors=True, local_files_only=True, add_watermarker=False)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config,
        algorithm_type="dpmsolver++", solver_order=2, use_karras_sigmas=True)
    pipe.load_lora_weights(str(STUDY / "models/pixel-art-xl"), weight_name="pixel-art-xl.safetensors", adapter_name="pixel")
    pipe.set_adapters("pixel", adapter_weights=settings["lora"]["weight"])
    pipe.to("cuda")
    save_json(run / "reference-environment.json", {"gpu": torch.cuda.get_device_name(),
        "vram": torch.cuda.get_device_properties(0).total_memory, "configuration": settings,
        "scheduler": dict(pipe.scheduler.config), "generator_device": "cpu", "deterministic": True,
        "packages": {p: importlib.metadata.version(p) for p in
            ("torch", "diffusers", "transformers", "accelerate", "peft", "numpy", "pillow", "tomli")},
        "script_sha256": sha256(Path(__file__))})
    for entry, path in needed:
        print("Generating reference:", subject(entry)["id"], flush=True)
        started = time.monotonic()
        embeds, text_settings = conditioning(pipe, entry["prompts"]["reference"], entry["prompts"]["negative"])
        kwargs = {k: settings["generation"][k] for k in ("width", "height", "num_inference_steps", "guidance_scale")}
        guide = None
        if settings.get("guide_image"):
            guide_path = (run / settings["guide_image"]).resolve()
            if settings.get("guide_sha256") and sha256(guide_path) != settings["guide_sha256"]:
                raise ValueError("Guide image hash differs from the run plan")
            guide = {"image": settings["guide_image"], "sha256": sha256(guide_path), "strength": settings["guide_strength"]}
            kwargs.update(image=Image.open(guide_path).convert("RGB"), strength=settings["guide_strength"])
        image = pipe(**embeds, **kwargs,
            generator=torch.Generator(device="cpu").manual_seed(entry["seeds"]["reference"])).images[0]
        record = {"entry": entry, "settings": settings, "conditioning": text_settings, "guide": guide,
            "seconds": time.monotonic()-started, "size": list(image.size), "mode": image.mode}
        info = PngInfo()
        info.add_text("generation", json.dumps(record))
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, pnginfo=info)
        save_json(path.with_suffix(".json"), {**record, "sha256": sha256(path)})
        print("Saved", path.name, round(record["seconds"], 1), "seconds", flush=True)


def reference_anchor(native, visual):
    import numpy as np
    from pixels import ground_anchor
    alpha = np.asarray(native.getchannel("A")) >= 128
    anchor = list(ground_anchor(alpha))
    floating = any(word in visual.get("idle", "").lower() for word in ("hover", "float"))
    box = native.getbbox()
    floating = visual.get("anchor", "floating" if floating else "ground") == "floating"
    gap = .2*(box[3]-box[1]) if floating else 0
    anchor[1] += gap
    return {"pivot": [anchor[0]/native.width, anchor[1]/native.height],
            "anchor": "floating" if floating else "ground", "reference_ground_gap_px": gap,
            "anchor_policy": "Ground-contact band; hovering assets use imaginary ground 20% of idle silhouette height below the body"}


def prepare(run):
    from PIL import Image, ImageOps
    from masking import biref_session, extract
    from pixels import fixed_crop, convert, comparison
    config = load(run)
    selections_path = run / "selection.json"
    selections = json.loads(selections_path.read_text()) if selections_path.exists() else {}
    session = None
    rows = []
    for entry in entries(config):
        key = subject(entry)["id"]
        selection = selections.get(key, {})
        original = (run / selection.get("source", f"originals/{key}.png")).resolve()
        selected_image = Image.open(original).convert("RGBA")
        if selection.get("crop"):
            selected_image = selected_image.crop(selection["crop"])
        if selection.get("flip_horizontal"):
            selected_image = ImageOps.mirror(selected_image)
        out = run / "references" / key
        record_path = out / "source.json"
        if not record_path.exists():
            if selected_image.getchannel("A").getextrema()[0] == 255:
                session = session or biref_session()
            out.mkdir(parents=True, exist_ok=True)
            rgba, method = extract(selected_image, session)
            rgba.save(out / "source-cutout.png")
            # Deliberate weapon/effect clearance. Pair export later crops both actions together.
            crops, box = fixed_crop([rgba], margin=.26)
            native = convert(crops[0], 128, "nearest", color_metric="ciede2000")
            native.save(out / "native-128.png")
            enlarged = native.resize((512, 512), Image.Resampling.NEAREST)
            enlarged.save(out / "reference-cutout.png")
            bg = Image.new("RGBA", enlarged.size, "#8b9bb4")
            bg.alpha_composite(enlarged)
            bg.convert("RGB").save(out / "reference.png")
            save_json(record_path, {"original_sha256": sha256(original), "mask_method": method,
                "original": str(original.relative_to(ROOT.parent)), "selection": selection,
                "original_record": (json.loads(original.with_suffix(".json").read_text()) if original.with_suffix(".json").exists()
                                    else {"origin": "provided image", "generation_metadata": "unavailable"}),
                "crop": box, "native_size": 128, "upscale": 4, "background": "#8b9bb4",
                **reference_anchor(native, subject(entry)["visual"]), "reference_idle_bbox": native.getbbox(),
                "height_scale": subject(entry)["visual"]["height_scale"],
                "reference_sha256": sha256(out / "reference.png"),
                "source_palette": subject(entry)["visual"]["palette"], "output_palette": "ENDESGA 32",
                "note": "Source palette guides prose colors; visible output is mapped to ENDESGA32. Scale is a display ratio, not source-image resolution."})
        else:
            record = json.loads(record_path.read_text())
            if record["original_sha256"] != sha256(original) or record["reference_sha256"] != sha256(out / "reference.png") or record.get("selection", {}) != selection:
                raise ValueError("Prepared reference hash mismatch")
            # Pivot metadata can evolve without changing any conditioning pixels.
            record.update(reference_anchor(Image.open(out / "native-128.png").convert("RGBA"), subject(entry)["visual"]))
            save_json(record_path, record)
        rows.append((key, [("selected source", selected_image.resize((128,128), Image.Resampling.NEAREST)),
                           ("masked, ENDESGA", Image.open(out / "native-128.png"))]))
        print("Prepared", key, flush=True)
    comparison(rows, run / "references.png")
