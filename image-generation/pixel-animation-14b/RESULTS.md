# Local Wan 14B pixel-animation results

The free pixel-animation adapter improves the tested knight's breathing cycle
and loop boundary over the same 14B base without that adapter. The strongest
current knight option is **128×128, nearest-neighbor + ENDESGA 32, full 16fps
cadence, pixel adapter strength 1**. This is a useful prototype candidate; it is
not a guarantee of finished animation without cleanup.

Open the [comparison player](outputs/review.html) or the
[labeled comparison sheet](outputs/comparison.png). Every raw 512px frame and
every actual-size processed PNG is retained under `outputs/<job>/`.

## Controlled knight comparison

Same reference, prompt, seed 72001, 512×512, 45 generated frames, 4 DDIM/simple
steps split 2+2, shift 5, CFG 1 and the same LightX2V acceleration adapters.
Only the pixel adapter and optional last-frame conditioning change.

| Run | Pixel adapter | End reference | Visible pixels changed at wrap | Wrap / median internal change | Generation time |
|---|---:|---|---:|---:|---:|
| Control | 0 | No | 15.05% | 1.615× | 296.9s |
| Pixel adapter | 1 | No | 5.60% | 0.295× | 292.2s |
| Pixel + end reference | 1 | Same as start | 5.37% | 0.283× | 242.0s |

These measurements use the actual **43 → 0** transition of the full-rate,
128px nearest/palette export. Frame 44 is the unused boundary frame. Distances
are premultiplied RGBA differences over the foreground union, not a perceptual
quality score. The timing includes separate expert processes, loading and
conditioning, but excludes background removal/export; other work was running
on the machine. The time difference does not establish a speed benefit from
ending-frame conditioning.

The adapter creates visibly clearer raised and settled shoulder/sword poses.
The feet remain planted in these samples. Armor highlights, gauntlet details and
cape edges still vary. The similar start/end result is encouraging, but the
incremental benefit of an ending reference is small in this one seed.

## Additional motion tests

With the same pixel-adapter settings and seed 72005, the wraith rises and falls
and its robe tails sway. Its hands, ribs and cyan highlights change noticeably.
This is a readable hover prototype with more cleanup needed than the knight.
Nearest 128px preserves the skull and bones better than Pyxelate.

The full-rate wrap changes 28.25% of visible pixels and has a wrap/internal
distance ratio of 0.688×. The ratio is below one partly because ordinary frames
also change substantially: it does not mean this is cleaner than the knight.
The tracked vertical anchor range is 8px on the fixed 512px canvas, equivalent
to 2px at 128px. No clipping or detached tiny mask components were detected.

The lantern, seed 72008, keeps a blue flame whose shape changes inside a mostly
steady housing. Its metal highlights still vary, so this is not perfectly rigid
at the pixel level. Automatic masking preserves the open spaces between flame
and frame. The 128px nearest export is the clearest; 64px stays recognizable as
an icon but loses flame detail. Its wrap changes 17.24% of visible pixels, with
a wrap/internal ratio of 1.496×. The boundary needs more attention than the
knight's. Both extra tests use ordinary first-frame conditioning.

This gives five clips and **225 raw frames**, with four processed variants per
clip, full-rate 44-frame atlases and compact 12-frame alternatives. The
[selected preview sheet](outputs/selected.png) shows the knight, wraith and
lantern; it is an overview, not an approval that every asset is production ready.

## Conversion and transparency

128px nearest + the fixed ENDESGA palette retains the most useful helmet, sword
and armor detail. Conservative Pyxelate simplifies highlights and outline
clusters; at 64px it turns the helmet and breastplate into broader blobs. It
does not solve temporal design or shading changes. Both methods use identical
automatic masks and the same palette; color membership does not establish
consistent character design.

References reuse automatic BiRefNet cutouts before generation. Generated frames
then receive an automatic BiRefNet-initialized SAM2 mask **before** conversion.
PNG exports have binary alpha. The knight masks contain no tiny detached
components and do not touch the canvas border, but internal color speckling can
remain. SAM2/BiRefNet agreement is a diagnostic, not ground-truth accuracy. Fine
glow, antialiasing and translucent material require separate treatment when
binary alpha is inappropriate.

The first export validation caught Pillow rounding scalar 62.5ms APNG durations
to 62ms. The final code uses an explicit 62/63ms schedule totaling 2750ms, and
the full-rate APNG reuses that exact scheduled export. Original failure logs are
retained as resolved diagnostics. GIF previews additionally round cumulative
boundaries to GIF's 10ms units, preserving the cycle duration instead of rounding
every frame down. Compact 12-frame atlases are optional: over
the same cycle they play at only about 4.4fps, so the viewer defaults to all
44 displayed frames at 16fps.

## Scope of the evidence

Visual assessment uses sampled raw frames, processed cycles and wrap strips.
The agent did not observe browser animation playback. The offline viewer offers
full-rate and compact playback, speed controls and frame stepping for review.
One knight seed is an ablation, not a success-rate estimate for arbitrary sprites
or actions. No frames were redrawn, pose-rigged, ping-ponged, crossfaded or chosen
from a search for a conveniently short loop interval.

All ten expert stages completed locally on the RTX 3090. Sampled peak whole-GPU
use was about 20.9 GiB and peak owned-process RSS about 26.6 GiB. The 32 GiB RAM
machine used substantial swap, which was already occupied by other work. New
model downloads occupy 31.43 GiB; the existing encoder and masking models are
reused. These measurements are sampled, include shared-machine effects, and are
not minimum hardware requirements.

The remaining cleanup is frame-to-frame armor/bone highlights, small hand and
outline changes, rigid lantern details and the lantern's loop transition.
Pyxelate alone cannot correct those motion/design problems. For this experiment,
the free local adapter is useful for basic cycle prototypes. Reliable finished
assets across arbitrary actions remain unproven.

This uses native Wan conditioning, scaled-FP8 base weights and a pinned public
LightX2V adapter pair. It does not exactly reproduce the author's custom
PainterI2V workflow. Details, source links, dependencies and exact commands are
in [README.md](README.md). The older 5B pilot also used different input
preparation/settings and serves only as a historical comparison.
