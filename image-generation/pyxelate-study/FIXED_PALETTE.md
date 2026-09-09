# Choosing a palette and controlling artifacts

**Yes, the output palette can be specified exactly.** Edit the hex colors in
[fantasy-palette.json](fantasy-palette.json). The current selection is
[ENDESGA 32 by ENDESGA](https://lospec.com/palette-list/endesga-32), using all
32 user-supplied hex values in their original order. The script accepts
2–256 distinct colors.
Stock Pyxelate takes these through `Pal.from_hex` (or `Pal.from_rgb`):

```python
from pyxelate import Pal, Pyx

palette = Pal.from_hex(colors)  # your list of "#RRGGBB" strings
pyx = Pyx(width=128, palette=palette, svd=False, dither="none", depth=1)
result = pyx.fit_transform(rgb_image_array)
```

Specifying only width preserves aspect ratio. The example fits one image;
for the saved comparison, one classifier was fitted on equal 128px thumbnails
of all five originals and reused everywhere. Its color table is fixed even
though the classifier learns how to assign input colors. A fixed table alone
does not guarantee sensible assignments.

[View the comparison with palette swatches](sheets/fixed-palette-svd.png).
All 20 native [output PNGs](fixed-palette/) are 128x128 RGB and passed exact
membership checks against the supplied hex colors. The three stock-processing
methods and custom mode all use the same table. This supplements the original
experiment; the original matrix was not changed. Unlike its learned sprite
palette, ENDESGA 32 was explicitly chosen, and the classifier training includes
the environment too.

Visual inspection after rerunning with ENDESGA 32:

- **SVD off** removes the obvious knight specks and reduces spurious texture
  inside the scene's arch. It also removes the large pale-blue/white patches
  introduced across the potion background with SVD on. It does not fix wrong
  colors by itself: stock Pyxelate turns the green slime cyan, pushes the
  shield/chest toward bright orange, and greatly brightens the scene with cyan
  ground patches.
- **Nearest neighbor + fixed palette** keeps the most detail and is a good
  default for these already pixel-like sources. This palette maps the potion's
  beige background to pale blue-gray and shifts the scene toward cooler greens
  and a reddish-brown path; exact palette membership does not ensure identical
  source colors.
- **The conservative wrapper** in `fixed_palette.py` avoids the obvious specks
  and extreme color shifts in this set. It retains the pinned Pyxelate version's
  HSV median and Sobel-weighted resizing, skips SVD and automatic local
  contrast/saturation enhancement, and uses nearest CIELAB palette matching
  instead of the adaptive BGM classifier. It keeps the slime green, the shield
  brown/gold and the scene subdued. Like nearest-palette mapping, it changes
  the potion background to pale blue-gray. Some small details become softer
  than nearest neighbor, including the potion texture and chest lines.

The wrapper is **custom code, not an exposed stock Pyxelate preset**. It uses
private methods from the pinned source revision. The installed library was not
modified. All modes leave original framing, backgrounds, shadows and design
errors in place. They do not guarantee perfect outlines at smaller resolutions.
Separate foreground masks/background removal and pixel cleanup are still needed.
The conservative helper deliberately expects RGB; alpha/mask handling is separate.

Run from `image-generation/pyxelate-study`:

```bash
.venv/bin/python fixed_palette.py > logs/fixed-palette.log 2>&1
.venv/bin/python package_results.py
```

No GPU or new dependencies are required. Settings, warnings, timings and output
hashes are in `metadata/fixed-palette.json`. The [upstream palette API](https://github.com/sedthh/pyxelate#assigning-existing-palette)
documents built-in and custom palettes; our pinned source confirms the current
public constructor has no switch disabling automatic local contrast enhancement.
