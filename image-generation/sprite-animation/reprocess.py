"""Re-export saved Wan cutouts with a new config; never regenerate or overwrite originals."""
import argparse
import json
from pathlib import Path
import time

from common import save_json, sha256
from pipeline import configuration, postprocess, provenance
from review import build_review


def reprocess(source, output, config):
    source, output = source.resolve(), output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    save_json(output / "provenance.json", {**provenance(), "source_run": str(source),
        "source_provenance_sha256": sha256(source / "provenance.json"), "motion_regenerated": False})
    save_json(output / "config.json", config)
    results = {}
    original_results = json.loads((source / "results.json").read_text())
    for name, result in original_results.items():
        records = []
        for old in result.get("attempts", []):
            original_job = Path(old["path"])
            if not (original_job / "tracking/tracking.json").exists():
                continue
            out = output / name / original_job.name
            tracking = json.loads((original_job / "tracking/tracking.json").read_text())
            started = time.monotonic()
            report = postprocess(original_job / "tracking/cutouts", out / "export", name,
                config["presets"][name], config, tracking,
                origin="local Wan2.2 TI2V-5B + BiRefNet + SAM2.1; revised export of retained frames")
            seconds = time.monotonic() - started
            record = {"seed": old["seed"], "path": str(out), "source_attempt": str(original_job),
                "status": "accepted" if report["quality"]["passed"] else "rejected",
                "seconds": old["seconds"] + seconds, "reprocessing_seconds": seconds,
                "quality": report["quality"]}
            save_json(out / "attempt.json", record)
            records.append(record)
        results[name] = {"status": records[-1]["status"] if records else "failed", "attempts": records}
    save_json(output / "results.json", results)
    build_review(output)
    save_json(output / "artifacts.sha256.json", {str(p.relative_to(output)): sha256(p)
        for p in output.rglob("*") if p.is_file()})
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("source", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--config", type=Path)
    a = p.parse_args()
    reprocess(a.source, a.output, configuration(a.config))
