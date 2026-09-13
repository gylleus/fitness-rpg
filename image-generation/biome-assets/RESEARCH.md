# Asset pipeline audit — 2026-09-14

The renderer was already shared: `enemy-sprites/batch.py` delegates to
`sprite-pipeline/sprites.py`, while `enemy_adapter.py` converts canonical enemies
into art inputs. SDXL references, Wan motion, masks, pixel conversion, atlas
export and runtime bundling did not need another implementation.

The selected runtime assets followed a newer route: built-in imagegen sheets
plus CPU extraction. Wetlands v1 had four separate eight-pose action sheets and
a design reference per enemy; Hollow Delve v1/v2 had one 24-pose sheet
per enemy. Their `prepare.py` scripts duplicated source verification, connected
component extraction, row sorting, grid anchors, layout construction and calls
to `sheet_import.py`. Differences were data: grid sizes, alpha versus color key,
one scale per action versus source scale, animation timing, the airborne toad
contact, and the revised dwarf's boots above its axe tip.

These scripts now delegate to `authored_sheets.py` and versioned recipes. A replay
of all three sets reproduced 424 sprite PNGs with identical decoded RGBA pixels.
224 also matched compressed bytes; cross-platform PNG encoding and comparison-page
font rendering differ. Existing selected runtime sprite files were preserved.

The scenery mismatch was explicit art direction, not a renderer defect.
Wetlands' canonical scene guidance called for broad shapes and reduced distant
detail. Hollow Delve's canonical guidance and v4 generation prompts requested
fine mineral ribs, pitted stone, chisel marks and rich local texture. Its bespoke
preparer required at least 1500×840 and copied 1672×941 originals directly into
runtime. A 640×360 logical layout therefore did not reduce the shipped texture
detail. The original low-detail SDXL samples were also a different backend from
both the current Wetlands and cave sources. A shared palette or the label
“pixel art” could not establish a common detail level.

Valve's production rendering paper describes omitting high-frequency detail,
avoiding overly complex environments, and using broad, low-noise texture marks
to support fast character recognition. The applicable principle here is to
allocate detail and contrast by gameplay role, not to copy its 3D shading model.
Our project-specific interpretation is quiet background space along the entire
combat route, medium detail in nearby props, and stronger actor silhouettes.
[Illustrative Rendering in Team Fortress 2, sections 3–4](https://cdn.steamstatic.com/apps/valve/2007/NPAR07_IllustrativeRenderingInTeamFortress2.pdf).

Diffusers documents why a seed alone does not guarantee identical images across
devices and platforms, and recommends controlling generators for repeatability.
The shared local renderer already records seeds and device/model provenance;
the supplied-image route should record actual image bytes, prompts and references.
It must not invent seeds for a tool that does not expose them.
[Diffusers reproducibility guidance](https://huggingface.co/docs/diffusers/main/using-diffusers/reusing_seeds).

The resulting interface is `biome-assets plan/definition/prepare/bundle/bundle-props`
plus `sprites import-sheets`. Canonical content supplies subject matter; one
style profile supplies role-specific detail constraints; recipes supply variants,
extraction corrections and selected runtime slots. Original generation sources
remain immutable. Plans and imports are reproducible; image generation and visual
approval still require inspecting the result in context.

## Tunnel revision

The first shared scenery export overcorrected: it resized the cave to 640×360
while Wetlands retained larger source textures. Logical layout size had become
an accidental texture-resolution limit. The cave also crossfaded whole opaque
panels, so it could not reproduce Wetlands' independently moving depth layers.

Background plans now retain full source textures while keeping independent
logical geometry. Shared interior recipes produce recess, wall and ceiling
assets with separate parallax speeds. The ceiling uses its measured alpha
underside as an anchor relative to the floor and reference actor height, rather
than stretching with the viewport. This makes a low tunnel possible in both
orientations. Materials and optional geometry overrides provide frost caves,
volcanic tunnels, crypts and castle passages through the same commands and
renderer. Only the limestone theme has generated production art in this revision;
the other presets are planning inputs, not new playable locations.
