# Detailed Hollow Delve backgrounds

Archived comparison sources. Current runtime art uses the quieter
[v5 panels](../hollow-delve-backgrounds-v5/README.md) and shared `biome-assets`
commands. The historical command below restores superseded detailed art.

Three built-in imagegen panoramas replace the earlier low-detail SDXL samples:
natural limestone, the timber gallery and the sunken cavern. Each is 1672×941.
Fine mineral ribs, chisel marks, damp stone and damaged timber remain visible
at phone scale. The game keeps its 640×360 logical layout while sampling the
full-resolution texture; the source is not reduced to a coarse pixel grid.

The original PNGs, exact prompts and hashes are preserved here. Runtime files
are byte-identical copies, including their complete colors and texture detail.
Props and the walking floor are separate assets. The background panels clamp
their slow pan and crossfade along the route; they are not seamless tiles.

```sh
uv run sprite-python image-generation/scene-samples/hollow-delve-backgrounds-v4/prepare.py
npm run test:scenery
```
