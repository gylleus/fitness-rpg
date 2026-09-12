# Wetlands: four action experiment

This recipe snapshots the five enemies in the Wetlands roster on 2026-09-09.
It requests `idle`, `attack`, `walk`, and `death`. Canonical idle/attack prose
is preserved; `../../wetlands.motions.json` adds anatomy-specific in-place
walking and one-shot death directions outside approved game content.

Text-only trials (`wetlands-v1` through `v3`) repeatedly generated frontal
humanoids, extra equipment, and incorrect Water Strider anatomy. The selected
`wetlands-v4` recipe uses local SDXL img2img with one guide per enemy. Four
coarse guides are deterministic polygons authored for this experiment; the
toad guide is a mirrored SDXL candidate from v3. These are an extra reference
art step, so this run is not evidence of successful unattended text-only
reference generation. Animation, masking, reduction, and export are automated.

`toad-source.png` and `.json` preserve its exact original prompt, seed, model
settings and checksum. The other guides are reproducible with
`make_strider_guide.py` and `make_guides.py`. Guide images are reference inputs,
not final exported sprites. The img2img strength is 0.30 for the toad and 0.62
for the others; Pixel Art XL strength is 0.70. SDXL retains every token through
explicit CLIP chunking, but the concise reference caption is a condensation of
the full design. Full canonical prose remains in the config and motion prompts.

From the repository root, using the installed environment:

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/make_strider_guide.py
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/make_guides.py
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py plan --roster content/biomes/wetlands/ENEMIES.toml --run image-generation/enemy-sprites/runs/wetlands-v4 --captions image-generation/enemy-sprites/wetlands.captions.json --motions image-generation/enemy-sprites/wetlands.motions.json --actions idle attack walk death --seed 92004 --facing left --reference-lora 0.7 --reference-guides image-generation/enemy-sprites/recipes/wetlands/guides.json --size 64 --frame-step 2
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py references --run image-generation/enemy-sprites/runs/wetlands-v4
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py prepare --run image-generation/enemy-sprites/runs/wetlands-v4
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py animate --run image-generation/enemy-sprites/runs/wetlands-v4 --mask-check-every 22
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py review --run image-generation/enemy-sprites/runs/wetlands-v4
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/pixel_review.py image-generation/enemy-sprites/runs/wetlands-v4
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/audit.py image-generation/enemy-sprites/runs/wetlands-v4
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py package --run image-generation/enemy-sprites/runs/wetlands-v4
```

Use a new run directory to change settings. Existing stages verify provenance
before reuse. If curated content changes, restore this saved `config.json`
instead of replanning: copy it into `image-generation/enemy-sprites/runs/NEW_RUN/`
and run the stages above against NEW_RUN. Its guide paths resolve from sibling
run directories to this recipe folder. The copied config does not load or
modify current game content.

Local dependencies and downloads are documented in
[the shared pipeline](../../../sprite-pipeline/README.md), with pinned model
manifests in `sprite-animation` and `pixel-animation-14b`. The run records
`reference-environment.json` and a full dependency/model/code manifest for
every animation in `animations/ID/ACTION/provenance.json`.

Export keeps every second source frame at the original speed. Idle/walk use 22
poses over 2.750 seconds and loop; attack/death retain the last source frame,
23 poses over 2.812 seconds, and play once. Frame PNGs are 64×64; 8-column
animation atlases are 512×192. Both nearest + ENDESGA32 and conservative
Pyxelate + ENDESGA32 use the same masks and fixed crop across all actions.
The HTML viewer honors one-shot flags; GIF/APNG previews repeat for inspection.

`raw_review.py RUN` can build sampled raw-motion contact sheets from completed
Wan stages before masking finishes. `pixel_review.py RUN` builds sharp 2x
native-pixel sheets from completed exports. `audit.py RUN` checks the full
Wetlands batch: all 20 animations, 5 stills, 900 raw frames, 910 native frame
PNGs, 50 atlases, frame hashes, timing, binary alpha, nonempty foreground,
transparent hidden RGB, the fixed palette, and shared crops.

The bounded Hulk attack prompt experiment reuses three completed clips and
the exact same prepared reference; it changes only the attack wording and
keeps its seed/model settings. Run it only after the base batch completes:

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/retry_root_attack.py
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py prepare --run image-generation/enemy-sprites/runs/wetlands-root-attack-retry
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py animate --run image-generation/enemy-sprites/runs/wetlands-root-attack-retry --mask-check-every 22
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/raw_review.py image-generation/enemy-sprites/runs/wetlands-root-attack-retry
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/pixel_review.py image-generation/enemy-sprites/runs/wetlands-root-attack-retry
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py package --run image-generation/enemy-sprites/runs/wetlands-root-attack-retry
```

Preferred delivery: `runs/wetlands-selected` includes the improved Hulk attack
and the other 19 original motions. All four Hulk states share the retry's
updated crop/pivot; no extra interpolation or pixel edits are applied. The
selection helper verifies the chosen prompt, seed and conditioning-reference
hash before assembling the take. Complete and review the retry before selecting.

```bash
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/select_takes.py
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py prepare --run image-generation/enemy-sprites/runs/wetlands-selected
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/batch.py review --run image-generation/enemy-sprites/runs/wetlands-selected
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/audit.py image-generation/enemy-sprites/runs/wetlands-selected
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/pixel_review.py image-generation/enemy-sprites/runs/wetlands-selected
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/prompt_comparison.py
image-generation/sprite-animation/.venv/bin/python image-generation/enemy-sprites/recipes/wetlands/bundle.py image-generation/enemy-sprites/runs/wetlands-selected
```

The recorded retry was interrupted with exit143 after Comfy saved its high-stage
latent. The sole output was checked for the expected `(1,16,12,64,64)` shape
and finite values before resuming; `recovery.json` records the exceptional
recovery. Normal fresh runs do not need this step. The retry reduced frontal
humanoid drift but still did not deliver a clean simultaneous two-fist ground
slam. This is a useful prompt comparison, not a claim that prompt shortening
fixes every failed motion.

The ZIP is a self-contained asset review, with small recipe inputs under
`reproduction/`. Generation commands run in this repository with its installed
models and dependencies. Model weights, Python environments and raw stage
intermediates remain local and are not included in the ZIP.
