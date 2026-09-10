# Wetlands first environment sample

Open [review.html](review.html) for a scrolling composition, layer toggles,
source images and exact prompts. It works locally without a server or network.
The existing player reference is copied alongside the sample for scale only.

Five source candidates were generated with the **built-in imagegen tool** from
the Wetlands TOML definitions. This is an art trial, not a run of local SDXL/Wan
and not a completed scene export adapter. No runtime assets were replaced.
The PNGs retain their original bytes, sizes, colors and alpha. Browser previews
display them at the intended logical size without writing converted images.

| Source | Delivered PNG | Intended final size | Result |
| --- | --- | --- | --- |
| [Sky](wetlands_overcast_sky.png) | 1672×941 RGB | 640×360 | Subdued stepped cloud bands; opaque as requested. |
| [Distant silhouettes](wetlands_distant_silhouettes.png) | 1672×941 RGBA | 640×360 | True transparent sky; horizon too low and too much lower-bank detail. |
| [Reed banks](wetlands_reed_banks.png) | 1672×941 RGBA | 640×360 | Recognizable pools, reeds and peat; busy behind characters. |
| [Peat ground](wetlands_raised_peat_path.png) | 2048×768 RGBA | 256×96 | True transparency but a soft upper halo and incorrect surface height. |
| [Willow](wetlands_leaning_willow.png) | 1086×1448 RGBA | 192×256 | Readable leaning willow; soft/fringed edges need pixel cleanup. |

The ground's first row with at least 98% near-opaque pixels is source row 338,
about 42.25 logical pixels down; the requested surface was row 24. This is a
measurement heuristic, not a collision line. The preview keeps the ground strip
at its planned location and aligns the player/tree to this visible turf so their
scale can be reviewed. Enable ground guides to see the discrepancy. Exact contact
pivots must be measured again after final pixel preparation.

The transparent outputs contain intermediate alpha, primarily near-opaque
interior pixels plus softer edges; they are not yet binary-alpha pixel exports.
No source has been mapped to ENDESGA32. Neighboring horizontal edges do not match
exactly on any repeating candidate. These are useful art sources, not certified
seamless tiles. Matching opposite edge pixels alone would not prove a good seam;
inspect the repeated composition as well.

Two ground edits attempted to correct the surface and remove the halo. The
[second version](wetlands_raised_peat_path-v2.png) corrected the layout but painted
a checkerboard into an opaque RGB PNG. A subsequent [extraction attempt](wetlands_raised_peat_path-v3.png)
also returned opaque RGB with a checkerboard and changed the contrast. Both are
rejected for composition; the transparent original is retained. Their exact
prompts and inputs are recorded so the failures remain reviewable.

[plan.json](plan.json) snapshots both TOML sources with hashes, selected records,
shared art targets and the five generation prompts. [sources.json](sources.json)
records source hashes, original output paths, dimensions, alpha measurements,
edge mismatch fractions, edit provenance and the player reference. Each prompt
also has an adjacent `.prompt.txt` file. Generation settings that the built-in
tool does not expose, such as model revision or seed, are not invented here.

Validation checked all eight PNG hashes/readability (five candidates, two rejected
edits and the copied player reference), exact generation prompts, local preview
links and JavaScript syntax. Source images were visually inspected. The assembled
browser preview has not been visually tested because no CUA browser was available.

Continue scene adapter and runtime work in `frpg-2zu`: prepare crisp native-size
art, correct layer placement and the ground baseline, make/review tile seams,
measure anchors, and integrate a static scene registry. The bounded generation
trial is `frpg-472`.
