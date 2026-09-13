# Quieter Hollow Delve backgrounds

Open [the before-and-after viewer](review.html) for actual production Skia phone
renders with identical actors and foreground scenery. The three replacements use
large rock shapes, sparse timber marks and subdued recesses behind combatants.
All are exported at the shared 640×360 logical canvas. Original full-resolution
generation results remain unchanged in `originals/`.

The built-in imagegen tool generated each panel separately using the exact
`prompt` in [plan.json](plan.json). No reference images, seed or model revision
were supplied or exposed. Adjacent `.prompt.txt` files contain the verbatim text;
[sources.json](sources.json) records source/prompt hashes and original tool paths.
The plan comes from canonical Hollow Delve content, the shared biome style
profile and three data-only panel variants. No bespoke biome preparer is needed.

```sh
uv run biome-assets prepare --plan image-generation/scene-samples/hollow-delve-backgrounds-v5/plan.json --sources image-generation/scene-samples/hollow-delve-backgrounds-v5/sources.json --out image-generation/scene-samples/hollow-delve-backgrounds-v5/prepared
uv run biome-assets bundle --manifest image-generation/scene-samples/hollow-delve-backgrounds-v5/prepared/manifest.json --mapping image-generation/scene-samples/hollow-delve-backgrounds-v5/runtime.json
npm run test:scenery
```

The plan can be reproduced with `biome-assets plan --biome hollow_delve --kind
background --out PLAN.json`. Use new paths when changing content or prompts.
The preparation step uses nearest sampling and retains source colors, opaque
alpha, aspect ratio and the complete composition. It does not blur, paint or
otherwise generate the replacement art. Runtime PNGs match prepared exports.

Validation passed 104 production Skia scene renders across four viewport sizes
and all cave enemies, plus the sprite audit (304 exact atlas crops and 264
scaled/mirrored samples). Source images and three phone comparisons were visually
inspected. The comparison viewer's local links and JavaScript were checked; this
does not establish a live-device playtest. [validation.json](validation.json)
records texture memory and neighboring-luminance activity in the combat band.
Those measurements describe the change; visual inspection establishes whether the
gameplay hierarchy works. These panels remain bounded panoramas, not seamless tiles.
