# End-to-end validation — 2026-09-08

The local pipeline now runs end to end. Four actual Wan clips were generated,
automatically masked/tracked and exported. The selected assets are in
[delivery](outputs/delivery/README.md), with an
[offline player](outputs/delivery/review.html),
[comparison sheet](outputs/delivery/comparison.png) and
[52 MB ZIP](outputs/dark-fantasy-animation-pilot.zip).

## Measured generation

All clips use the pinned Wan 2.2 TI2V-5B repack, scaled-FP8 T5 and Wan VAE through
native ComfyUI 0.3.50. Settings are 512×512, 24 fps, 20 steps, CFG 5, shift 8,
`uni_pc`/`simple`, with seeds and exact prompts saved per clip. This is a lower
resolution pilot than the model's published 720p target. No hosted inference,
hand-drawn frames, manual masks or human tracking prompts were used.

| Subject | Seed | Generated frames | Generation | Initial attempt | Sampled GPU peak |
|---|---:|---:|---:|---:|---:|
| Short knight control | 61001 | 33 | 108.3 s | 191.5 s | 17.53 GiB |
| Lantern flame | 61008 | 33 | 94.0 s | 176.3 s | 17.53 GiB |
| Wraith | 61005 | 33 | 101.3 s | 183.4 s | 17.68 GiB |
| Longer knight | 62001 | 65 | 115.4 s | 271.9 s | 18.14 GiB |

The initial attempt includes generation, tracking and its first export, but
excludes source preparation and subsequent re-exports. GPU figures are sampled
whole-device totals including other applications, not allocator maxima. Process
RSS peaked at 24.05 GiB; swap use grew during loading on this 32 GiB RAM machine.
The tested jobs completed without an out-of-memory failure. Most denoising steps
took about one second for 33 frames and about 1.9 seconds for 65 frames.

BiRefNet/SAM2 mask agreement at the sampled checkpoints ranged from 0.978 to
0.995 IoU across the real clips. Agreement between two models is not independent
ground-truth accuracy, but visual inspection did not show gross loss of the
knight's sword, lantern housing or wraith limbs.

## Findings and implemented corrections

Background removal helps. Original floor shadows/backdrops are removed before
pixel conversion. On white, black and green backgrounds, the static pilots keep
the knight's silhouette and sword, lantern handle/flame, and wraith ribs/limbs.
See the [background inspection sheet](outputs/mask-pilot/background-check.png).
The final palette/alpha contract holds for the real animations too. Binary alpha
simplifies glow and translucent glass; it is not physical matting.

The initial short knight passed the old photometric motion check, despite showing
mostly changing fine shading. Character loops now need at least 2% silhouette
change within the selected interval, in addition to appearance change. The
short knight is **rejected** under these checks. A regression specifically verifies
that changing only colors cannot count as character motion.

The longer knight test changes both the clip length to 65 frames and the prompt
to request visible breathing/cape movement, so their effects are not isolated.
Its selected loop is 1.542 seconds, with modest cape/body change. It passes the
revised checks but still has fine shading flicker and restrained motion.

The initial anchor estimator also produced a false rejection when the lowest
scanline switched from one planted boot to the other. The revised estimator
uses both boots in a lower band and ignores components that do not reach the
ground. Regression cases cover alternating boot heights, cape tips and real
whole-body translation. This is a measurement correction; it never recenters
frames or deletes mask pixels.

Wan changed the lantern's cyan/white flame into strongly saturated blue. The
original CIE76 palette matcher then assigned much of this blue to ENDESGA purple.
CIEDE2000 maps pure blue to `#124e89` instead. The revised comparison visibly
keeps the flame blue. Both nearest and conservative paths use the same metric
and the same 32 colors. This does not restore cyan that the generator changed.
Tests verify the blue assignment and exact preservation of supplied palette colors.

## Visual assessment

**128px nearest + ENDESGA 32 is the strongest default for these sources.** It
preserves sword edges, armor, lantern metal detail and the wraith's ribs better
than conservative Pyxelate reduction. At 64px, fine equipment and facial details
are fragile. Conservative reduction visibly softens details and does not remove
source deformation or temporal shading noise.

The selected knight remains recognizable with its sword, helmet, cape and boots.
Its movement is restrained; cape edges move and armor highlights still change.
The lantern has active flame motion and mostly stable housing, but flame size,
shape and brightness vary strongly and the housing is not perfectly rigid at
pixel level. The wraith shows a small arm/robe gesture with little vertical hover,
so it does not strictly satisfy the requested action even though it passes the
current checks. These are motion drafts, not guaranteed production assets.
Some generated wraith frames also contain stray cyan/white streaks in the
background; the tracked foreground mask removes those from the exported sprites.

The selected loop durations are 1.542 s for the knight, 1.042 s for the lantern
and 0.5 s for the wraith. Endpoint/velocity scores choose a cycle without a
duplicated final frame, ping-pong reversal or silhouette crossfade. They cannot
certify a physically correct cycle or intended action. The labeled contact sheets
were visually inspected; browser UI automation was unavailable, so no browser
playback inspection is claimed. The offline player's JS syntax and local serving
were checked. APNG timing/layout is separately covered by regression tests.

Palette matching does not establish consistent character design, anatomy,
perspective or proportions. Fine outline cleanup, stable highlights, rigid metal
details and motion compliance remain the main art-quality work. Automation covers
the entire process and bounded retries; it can return a rejected candidate.

## Validation evidence and files

- Ten focused regression tests pass; all 96 locked dependency pins match runtime.
- Actual ComfyUI upload/queue/history/PNG retrieval passed before model inference.
- All model files passed their recorded checksums.
- Four clips contain **164 original generated PNG frames**.
- Final comparisons validate **784 target PNGs**, including the rejected control:
  492 in `wan-pilot-final` and 292 in `knight-longer-final`.
- The selected delivery contains **620 target PNGs**, plus source images,
  generated frames, masks/cutouts, 12 atlases, timing JSON and previews.
- Validation checks target sizes, binary alpha, visible ENDESGA membership,
  identical masks between methods, atlas tile equality, fixed pivots, selected
  indices and total loop timing.
- The original CIE76 conversion was reproduced exactly for the retained first
  knight frame at both sizes and both methods.

Records: `metadata/pilot-summary.json`, `metadata/models-all-verified.json`,
`metadata/runtime-versions.json`, each run's `provenance.json`, `config.json`,
`results.json`, `validation.json`, and per-attempt generation/tracking/resource
reports. Original control files remain in `outputs/wan-pilot-01`; the longer
source clip is in `outputs/knight-longer-01`. Intermediate revisions are retained.
Final exports live in `outputs/wan-pilot-final`, `outputs/knight-longer-final` and
the selected `outputs/delivery` bundle. See the [README](README.md) for exact commands.

Recommendation: use this pipeline for unattended motion drafts and asset
experiments. Start at 128px, no dithering, binary alpha and CIEDE2000 mapping;
compare Pyxelate to the nearest baseline. Use the longer knight preset for its
more visible movement. For strict hover/walk/attack behavior and stable pixel
details, the next experiment should use controlled motion/rigging or motion
templates rather than relying only on text-conditioned video generation.
