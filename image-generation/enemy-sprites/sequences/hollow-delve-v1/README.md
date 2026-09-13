# Hollow Delve enemy sprites

Five enemies, 20 animations, 120 authored poses. Each enemy has six poses for
idle, walk, attack and death, exported as transparent 128×128 ENDESGA32 frames.

| Enemy | Appearance | Attack |
| --- | --- | --- |
| Troglodyte | Blind, bald cave humanoid with slick skin and long arms | Shoulder-led claw rake |
| Giant cave spider | Broad dark spider with jointed legs and heavy fangs | Forward downward bite |
| Bone slime | Green jelly containing a humanoid skull, ribs and long bones | Flattening forward surge |
| Delve dwarf | Short, barrel-bodied, bald and beardless miner with an iron maul | Overhead maul strike |
| Delve gnoll | Spotted hyena scavenger with black mane and rusty cleaver | Descending cleaver chop |

The complete descriptions are in the canonical
[ENEMIES.toml](../../../../content/biomes/hollow_delve/ENEMIES.toml).
The runtime encounters follow this order, ending with the gnoll boss.

Each immutable `sheet-source.png` was generated with built-in imagegen using
the adjacent exact `prompt.txt`. `sources.json` records source and prompt
checksums. The four source rows are idle, walk, attack and death; six columns
hold the authored poses. `roster.json` retains the generation-time design
snapshot; subsequent chapter-four balancing lives in canonical content.

`prepare.py` extracts 24 connected alpha masks from each sheet, retaining limbs
and weapons that cross nominal cell boundaries. It uses a fixed horizontal
grid anchor and aligns the lowest attached pixel to the floor. All poses share
one final crop, scale and pivot; there is no per-pose resizing or synthesized
motion. `extraction.json` records every source box. `import.json` and the
intermediate layouts feed the existing CPU sprite importer.

Rebuild from the repository root:

```bash
uv run sprite-python image-generation/enemy-sprites/sequences/hollow-delve-v1/prepare.py
uv run sprites bundle
npm run test:sprites
```

The game bundle includes all six poses. Idle/walk loop; attacks recover to idle;
death holds the final collapsed pose. Open
[the sprite preview](../../../game-sprites.html) through the repository's local
HTTP server to review the actual game atlases and playback controls.

All 120 final poses were visually reviewed and checked for nonempty silhouettes,
border clearance, binary alpha, zero hidden RGB, palette membership and positive
timing; results are in `audit.json`. The complete game catalog passed 312 exact
Skia atlas crops and 264 scaled/mirrored samples. Some shading and body-volume
variation remains between generated poses, and the spider uses a slight
three-quarter view. The palette warms some gray-green source colors.
