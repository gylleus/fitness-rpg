"""Download pinned assets with curl; verify wheels and record model checksums.

The first run used the same URLs via individual approved curl tool calls because
package-manager networking was restricted. Subsequent runs can use this helper.
"""
import argparse
import hashlib
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def fetch(item):
    path = ROOT / item["relative_path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and item.get("sha256") and sha256(path) == item["sha256"]:
        return
    # Resume downloads instead of duplicating multi-GB weights.
    subprocess.run(["curl", "-L", "--fail", "--retry", "3", "--continue-at", "-",
                    "--max-time", "1800", "-sS", item["url"], "-o", str(path)], check=True)
    if item.get("sha256"):
        assert sha256(path) == item["sha256"], f"Checksum mismatch: {path}"
    if item.get("size"):
        assert path.stat().st_size == item["size"], f"Size mismatch: {path}"
    print("Downloaded", path.relative_to(ROOT), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    wheels = json.loads((ROOT / "metadata/wheels.json").read_text())
    models = json.loads((ROOT / "metadata/model-downloads.json").read_text())
    files = [{**w, "relative_path": "vendor/wheels/" + w["filename"]} for w in wheels]
    # Stored initial paths start at the repo root. Paths here are relocatable.
    files += [{**m, "relative_path": "models/" + m["path"].split("/models/", 1)[1]} for m in models]
    manifest_path = ROOT / "metadata/model-checksums.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for f in files:
        if f["relative_path"] in previous:
            f["sha256"] = previous[f["relative_path"]]
    if not args.verify_only:
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(fetch, files))
    for f in files:
        p = ROOT / f["relative_path"]
        assert p.is_file(), f"Missing {p}"
        if f.get("size"):
            assert p.stat().st_size == f["size"], f"Size mismatch: {p}"
        if f.get("sha256"):
            assert sha256(p) == f["sha256"], f"Checksum mismatch: {p}"
    checksums = {f["relative_path"]: sha256(ROOT / f["relative_path"]) for f in files if f["relative_path"].startswith("models/")}
    manifest_path.write_text(json.dumps(checksums, indent=2) + "\n")
    print("Verified", len(wheels), "wheel hashes and", len(models), "model files.")


if __name__ == "__main__":
    main()
