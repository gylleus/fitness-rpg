"""Bundle the reproducible results, excluding the multi-GB model/environment."""
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
patterns = ["*.py", "*.sh", "*.md", "*.txt", "*.json", ".gitignore",
            "originals/**/*", "processed/**/*", "sheets/**/*",
            "grid-recovery/**/*", "alpha-probe/**/*", "fixed-palette/**/*", "metadata/**/*", "logs/**/*",
            "vendor/pyxelate.tar.gz"]
paths = sorted({p for pattern in patterns for p in ROOT.glob(pattern) if p.is_file()
                and p.name != "result-checksums.json"})
checksums = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
manifest = ROOT / "metadata/result-checksums.json"
manifest.write_text(json.dumps(checksums, indent=2) + "\n")
paths.append(manifest)
out = ROOT / "pyxelate-study-results.zip"
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in paths:
        archive.write(path, "pyxelate-study/" + str(path.relative_to(ROOT)))
with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
print(f"Saved {out.name}: {len(paths)} files, {out.stat().st_size / 1024**2:.1f} MiB; ZIP integrity passed.")
