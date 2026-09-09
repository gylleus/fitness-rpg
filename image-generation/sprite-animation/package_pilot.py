"""Package selected measured pilot candidates; retain the rejected control separately."""
import json
from pathlib import Path
import shutil
import zipfile

from PIL import Image

from common import ROOT, save_json, sha256
from pipeline import configuration
from pixels import comparison
from review import build_review
from validate_run import validate


def main():
    output = ROOT / "outputs/delivery"
    output.mkdir(parents=True, exist_ok=False)
    choices = [("knight-idle", "knight-longer-final"), ("lantern-flame", "wan-pilot-final"), ("wraith-hover", "wan-pilot-final")]
    notes = {
        "knight-idle": "65-frame candidate: restrained chest/cape movement; fine armor shading still flickers. Stronger than the rejected 33-frame control.",
        "lantern-flame": "Active blue flame and mostly stable housing. Flame shape/brightness changes strongly; the model shifts the original cyan. CIEDE2000 avoids a further purple palette shift.",
        "wraith-hover": "Small arm/robe movement; weak compliance with the requested vertical hover. A motion draft, not a certified hover animation.",
    }
    results, rows = {}, []
    save_json(output / "config.json", configuration())
    for name, run in choices:
        source_run = ROOT / "outputs" / run
        record = json.loads((source_run / "results.json").read_text())[name]["attempts"][-1]
        if record["status"] != "accepted":
            raise RuntimeError(f"Selected candidate failed automatic checks: {name}")
        job = Path(record["path"])
        original = Path(record["source_attempt"])
        target = output / name
        target.mkdir()
        for src, dest in [(job / "export", target / "export"), (original / "motion/frames", target / "generated-frames"),
            (original / "tracking/cutouts", target / "cutouts"), (original / "tracking/masks", target / "masks"),
            (original.parent / "source", target / "source")]:
            shutil.copytree(src, dest)
        for filename in ("generation.json", "workflow-api.json", "resources.json"):
            shutil.copy2(original / "motion" / filename, target / filename)
        shutil.copy2(original / "tracking/tracking.json", target / "tracking.json")
        source = json.loads((target / "source/source.json").read_text())
        shutil.copy2(source["input"], target / "source-original.png")
        save_json(target / "selection.json", {"source_export": str(job), "source_generation": str(original),
            "seed": record["seed"], "automatic_qc_passed": True, "visual_notes": notes[name]})
        results[name] = {"status": "accepted", "attempts": [{**record, "path": str(target)}]}
        report = json.loads((target / "export/report.json").read_text())
        for selected in (0, 4):
            i = report["loop"]["indices"][selected]
            raw = Image.open(target / "generated-frames" / f"{i:05d}.png").convert("RGBA").resize((128, 128), Image.Resampling.NEAREST)
            panels = [("RGB 512px preview", raw)]
            for size in (64, 128):
                for method in ("nearest", "conservative"):
                    panel = Image.open(target / "export" / f"{method}-{size}" / f"frame-{selected:03d}.png").convert("RGBA")
                    panels.append((method, panel))
            rows.append((f"{name} | seed {record['seed']} | generated frame {i}", panels))
    save_json(output / "results.json", results)
    for name in ("models.lock.json", "palette.json"):
        shutil.copy2(ROOT / name, output / name)
    shutil.copy2(ROOT / "metadata/runtime-versions.json", output / "runtime-versions.json")
    comparison(rows, output / "comparison.png")
    build_review(output)
    validate(output)
    (output / "README.md").write_text("""# Dark fantasy animation pilot assets

Open `review.html` for synchronized nearest/Pyxelate playback, or `comparison.png`
for an integer-nearest enlarged sheet. Each subject includes its original source,
generated 512px RGB frames, masks/cutouts, actual 64/128px processed frames,
eight-frame PNG sheets, Aseprite-style timing JSON, APNG and GIF previews.

These candidates pass the current automatic checks; this does not certify game
readiness. Knight motion remains restrained with shading flicker. The lantern
changes flame shape/brightness and loses some source cyan. The wraith moves its
arms/robes with little vertical hovering. See each `selection.json` for notes.

Use 128px nearest + ENDESGA 32 for the strongest fine detail. Both methods use
the same crop, masks, frame indices and CIEDE2000 palette mapping, with no dithering.
Atlas alpha is binary. Soft glow/translucency and rigid pixel details may need cleanup.

Exact prompts, seeds and generation settings are in each `generation.json`;
ComfyUI graphs, model hashes and dependency versions are included. Reproducible
commands/code and the rejected short-knight control remain in the repository's
`image-generation/sprite-animation` directory. This ZIP is an asset bundle,
not a standalone model/runtime installation. No hosted inference was used.
""")
    save_json(output / "checksums.sha256.json", {str(p.relative_to(output)): sha256(p) for p in output.rglob("*") if p.is_file()})
    archive = ROOT / "outputs/dark-fantasy-animation-pilot.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(output.rglob("*")):
            if p.is_file():
                z.write(p, str(p.relative_to(output)))
    print(archive, archive.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
