"""Inspect the actual BGM fit inputs in the installed, pinned Pyxelate version.

This intercepts only the estimator's fit call. It tests data routing, not BGM
quality or animation. It does not edit the installed library or any assets.
"""
import hashlib
import importlib.metadata
import inspect
import json
from pathlib import Path

import numpy as np
from pyxelate import Pyx

ROOT = Path(__file__).resolve().parent
records = []
for name, background in [("magenta", [255, 0, 255]), ("cyan", [0, 255, 255])]:
    rgba = np.zeros((64, 64, 4), dtype=np.uint8)
    rgba[:, :, :3] = background
    rgba[16:48, 16:48] = [200, 40, 32, 255]
    pyx = Pyx(width=16, palette=4, svd=False, dither="none")
    captured = []

    def capture_fit(data, *args, **kwargs):
        captured.append(data.copy())
        return pyx.model

    pyx.model.fit = capture_fit
    pyx.fit(rgba)
    # The learn-palette branch applies SCALE_RGB. Account for that transform.
    target = ((np.array(background) / 255.0 - .5) * pyx.SCALE_RGB) + .5
    count = int(np.count_nonzero(np.all(np.isclose(captured[0], target), axis=1)))
    records.append({"transparent_rgb": name, "fitter_samples": len(captured[0]),
                    "samples_matching_fully_transparent_rgb": count})
    assert count > 0, "Pinned behavior changed: re-audit the foreground fit branch."

source = Path(inspect.getsourcefile(Pyx))
report = {
    "pyxelate_version": importlib.metadata.version("pyxelate"),
    "pyx_source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "method": "Intercept the estimator fit input for fixtures with identical opaque red squares and different RGB under alpha=0; account for SCALE_RGB.",
    "records": records,
    "finding": "Fully transparent RGB reaches the palette estimator in this pinned version. Alpha alone does not exclude background from palette fitting.",
    "scope": "Data-routing probe only; actual fringe behavior was tested separately in the existing pyxelate-study alpha probe.",
}
(ROOT / "metadata").mkdir(exist_ok=True)
(ROOT / "metadata/pyxelate-alpha-fit-audit.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
