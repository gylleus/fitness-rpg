#!/usr/bin/env python3
"""Run the controlled local comparison, retaining failures and every raw candidate."""
import argparse
import json
from pathlib import Path
import time
import traceback
from run import ROOT, run, save_json
from analyze import process, build_review
from validate import validate


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("jobs", nargs="*", default=["knight-control", "knight-pixel", "knight-pixel-loop"])
    p.add_argument("--config", type=Path, default=ROOT / "config.json")
    a = p.parse_args()
    records = {}
    for job in a.jobs:
        start = time.monotonic()
        try:
            run(a.config, job)
            report = process(job)
            validate(job)
            error_path = ROOT / "outputs" / job / "error.txt"
            if error_path.exists():
                error_path.replace(error_path.with_name("resolved-error.txt"))
            records[job] = {"status": "generated_and_exported", "art_status": "unapproved",
                "seconds": time.monotonic() - start, "generation_seconds": report["generation"]["seconds"],
                "metrics": report["variants"]["nearest-128"]["full_rate"]}
        except Exception as exc:
            out = ROOT / "outputs" / job
            out.mkdir(parents=True, exist_ok=True)
            (out / "error.txt").write_text(traceback.format_exc())
            records[job] = {"status": "failed", "error": str(exc), "seconds": time.monotonic() - start}
            print(traceback.format_exc(), flush=True)
        result_path = ROOT / "outputs/batch-results.json"
        previous = json.loads(result_path.read_text()) if result_path.exists() else {}
        save_json(result_path, {**previous, **records})
    build_review()
    print(json.dumps(records, indent=2), flush=True)
    raise SystemExit(1 if any(r["status"] == "failed" for r in records.values()) else 0)
