"""Check real generated atlas dimensions, palette, alpha, timing and frame layout."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from common import save_json
from pixels import palette_colors


def validate(root):
    root = Path(root)
    results = json.loads((root / "results.json").read_text())
    allowed = set(map(tuple, palette_colors()))
    records, png_count = [], 0
    for name, subject in results.items():
        for attempt in subject.get("attempts", []):
            job = Path(attempt["path"])
            report_path = job / "export/report.json"
            if not report_path.exists():
                continue
            report = json.loads(report_path.read_text())
            fps = json.loads((root / "config.json").read_text())["generation"]["fps"]
            loop = report["loop"]
            assert sum(loop["durations_ms"]) == round((loop["end_exclusive"] - loop["start"]) * 1000 / fps)
            assert len(loop["indices"]) == len(set(loop["indices"])) == 8
            assert loop["indices"][-1] < loop["end_exclusive"]
            for size in (64, 128):
                alpha = {}
                for method in ("nearest", "conservative"):
                    out = job / "export" / f"{method}-{size}"
                    data = json.loads((out / "spritesheet.json").read_text())
                    atlas = Image.open(out / "spritesheet.png").convert("RGBA")
                    assert atlas.size == (size * 8, size)
                    all_paths = sorted((out / "all-frames").glob("*.png"))
                    assert len(all_paths) == report["input_frames"]
                    alpha[method] = []
                    for p in [*all_paths, *sorted(out.glob("frame-*.png"))]:
                        a = np.array(Image.open(p).convert("RGBA"))
                        assert a.shape == (size, size, 4), p
                        assert set(np.unique(a[..., 3])) <= {0, 255}, p
                        assert set(map(tuple, a[a[..., 3] > 0, :3])) <= allowed, p
                        if p.parent.name == "all-frames":
                            alpha[method].append(a[..., 3])
                        png_count += 1
                    for i, frame in enumerate(data["frames"]):
                        a = np.array(Image.open(out / frame["filename"]).convert("RGBA"))
                        b = np.array(atlas.crop((i * size, 0, (i + 1) * size, size)))
                        np.testing.assert_array_equal(a, b)
                    assert data["meta"]["pivot"]["x"] == report["pivot"][0]
                    assert data["meta"]["pivot"]["y"] == report["pivot"][1]
                np.testing.assert_array_equal(np.stack(alpha["nearest"]), np.stack(alpha["conservative"]))
            records.append({"name": name, "seed": attempt["seed"], "frames": report["input_frames"],
                "qc_passed": report["quality"]["passed"], "reasons": report["quality"]["reasons"],
                "loop_seconds": sum(loop["durations_ms"]) / 1000})
    if not records:
        raise ValueError("No completed candidate exports to validate")
    result = {"contracts_passed": True, "target_pngs_checked": png_count, "candidates": records,
              "note": "Export validity does not imply visual quality or motion compliance."}
    save_json(root / "validation.json", result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("run", type=Path)
    validate(p.parse_args().run)
