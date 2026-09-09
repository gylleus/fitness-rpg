# Dark fantasy 01

Twelve selected game assets generated locally with SDXL base 1.0 + Pixel Art XL
on an RTX 3090. The initial twelve images and two targeted refinements are
retained. Prompts, seeds and model revisions are in [config.json](config.json)
and [refinements.json](refinements.json).
The selected palette is [ENDESGA 32 by ENDESGA](https://lospec.com/palette-list/endesga-32),
copied exactly into [palette.json](palette.json).

Generated subjects:

- Characters: ashen knight, grave warden, ember witch.
- Monsters: bone hound, crypt wraith, thorn horror.
- Items: cursed greatsword, soul lantern, reliquary chest.
- Environments: ruined chapel, forsaken keep, witchwood shrine.

Run from the repository root in a terminal with CUDA device access:

```bash
bash image-generation/dark-fantasy-01/run.sh
```

The script reuses `../pyxelate-study/.venv`, its downloaded model weights and
its pinned processing helpers. It does not download models or use a hosted API.
Dependency versions and installation instructions remain in the sibling study's
`requirements.lock.txt` and `COMMANDS.md`. This directory alone does not include
those dependencies. Every generated original is retained and skipped on reruns;
use another directory for different prompts/settings after starting generation.

Generation uses 1024x1024, 30 steps, CFG 7, LoRA weight 1, FP16 and DPM++ 2M
Karras, matching the original study. Seeds 52001–52012 use a CPU random-number
generator; inference runs on CUDA. Per-image JSON and embedded PNG metadata
record prompts/settings/seeds, timings and hashes. Hardware and dependency
versions are recorded at runtime.

The run creates:

- `originals/`: twelve first-seed 1024x1024 RGB originals and generation records.
- `variants/refinements/`: the single-character knight and simpler blue-flame
  lantern, with their own generation metadata. [selection.json](selection.json)
  identifies these two choices for the final galleries and processed assets.
- `processed/64/` and `processed/128/`: nearest-neighbor and conservative
  Pyxelate-wrapper variants, mapped to ENDESGA 32 with no dithering.
- `sheets/`: labeled originals, nearest and conservative galleries. The 128px
  outputs display at exactly 3x nearest-neighbor scaling.
- `metadata/`: hardware, processing settings, dimensions, palette checks and hashes.
- `dark-fantasy-01.zip`: assets, scripts, configuration, docs and metadata.

The first knight was a multi-view sheet. A targeted prompt and seed 53001
produced the selected single knight. The first lantern had an orange flame and
a lightly textured gray background that became noisy under palette mapping.
A simpler lantern prompt, white background and seed 53008 produced the selected
blue-flame version. The first-seed originals are preserved, so this batch is
explicitly a selected art batch rather than an uncurated model evaluation.

The conservative wrapper is custom code that reuses pinned Pyxelate median/Sobel
resizing and skips its SVD and automatic color enhancements. It maps colors by
nearest CIELAB distance. It is not a stock Pyxelate preset. The original study's
`fixed_palette.py` and `process.py` hashes are saved with the batch results.

Sprites use simple light-gray backgrounds. These remain opaque; foreground
masking, transparency and manual pixel cleanup are separate work. A shared
palette alone does not ensure consistent anatomy, scale or character design.

Individual commands, from this directory:

```bash
../pyxelate-study/.venv/bin/python batch.py check
../pyxelate-study/.venv/bin/python batch.py generate
../pyxelate-study/.venv/bin/python batch.py refine
../pyxelate-study/.venv/bin/python batch.py process
../pyxelate-study/.venv/bin/python batch.py package
```

Generation requires CUDA. `check` records the hardware visible to the current
process and exits with an explicit error if no GPU is available. Processing
needs only the existing CPU dependencies and completed originals.

Visual review: the 128px versions preserve silhouettes and details better than
64px. Nearest-neighbor retains sharper small texture; the conservative wrapper
reduces some speckling and makes broader color clusters. At 64px the conservative
knight's sword becomes faint and fragmented; prefer the 128px asset. ENDESGA mapping changes
neutral-gray backgrounds to blue-gray and compresses dark scene values. The
keep's bridge and interior stonework lose contrast; the greatsword lacks the
requested red fissure. These are useful concept/prototype assets, with outline,
detail and foreground-mask cleanup still needed for production sprites.

Validation passed for all 14 source PNGs (dimensions, hashes, prompts, seeds and
embedded metadata) and all 48 selected processed PNGs (64/128 dimensions, exact
ENDESGA palette membership and hashes). See `metadata/validation.json`.
