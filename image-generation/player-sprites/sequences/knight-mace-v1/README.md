# Mace knight

The current player is a weathered knight in closed steel plate with a spiked
iron mace, burgundy waist cloth and heavy armored boots. The internal
`barbarian_player` ID stays stable; the content and HUD call the character
Knight. Combat values and saved progress are unaffected.

The built-in imagegen tool authored the sources. `sheet-source.png` contains
six poses for each of idle, walk, attack and death. Its exact prompt and hash
are in `prompt.txt` and `source.json`. The original walking row kept the same
leg in front too often, so the runtime uses a separate six-pose walking sheet
with contact, passing and lifted-boot poses (`walk-source.png`). Its generation
and background-edit prompts are `walk-prompt.txt` and `walk-key-prompt.txt`.
`walk-source.json` records the selected source hash and registration settings.

The first walk generation and a transparency-only edit returned opaque painted
checkerboards. A further built-in edit supplied a flat magenta color key.
The deterministic importer removes that key using channel differences, keeping
gray armor opaque, then extracts the six connected subjects. Source images
remain unchanged. The walking sheet is registered at one fixed 217/448 scale
for all six poses; it is not fitted independently per frame. Its column
origins correct the generated sheet's irregular spacing while preserving the
body movement within each column.

`prepare.py` extracts the connected figures, applies reviewed physical contacts,
and creates common 640px layout frames. `ground-contacts.json` records the
original sheet's contacts; walking contacts are in `walk-source.json`.
Boots, knees and the fallen armored body define ground contact. In the final
death poses the mace spikes extend slightly below the body, so the weapon
does not lift the corpse above the floor. One shared union crop and scale
across every action produces 128×128 ENDESGA-32 frames with binary alpha and
zero RGB in transparent pixels. No detached background components are shipped.

The four action atlases contain 24 authored poses:

| Action | Duration | Playback |
| --- | --- | --- |
| Idle | 1,200 ms | Loop |
| Walk | 800 ms | Loop |
| Attack | 800 ms authored; 360 ms in combat | Returns to idle |
| Death | 900 ms | Holds the final pose |

Attack pose 3 starts halfway through the source clip. Fitting the clip to the
game's 360ms attack places the downward mace strike at the existing 180ms hit.
The timing tests verify this boundary as well as pause/resume and terminal
death playback. `export/comparison.png` shows every imported pose at 2× nearest
sampling; each action also has a preview GIF. The separate walking generation
has slightly brighter armor highlights than the idle and attack source.

Rebuild from repository root:

```bash
uv run sprite-python image-generation/player-sprites/sequences/knight-mace-v1/prepare.py
uv run sprites bundle
npm run test:sprites
npm run test:scenery
```

The bundle recipe selects `export/manifest.json`. Runtime PNGs are under
`assets/sprites/barbarian_player--*.png`, with geometry and hashes in the
runtime catalog and provenance. The real Skia audit compares every shipped
tile to its source and checks scaled/mirrored drawing; scenery review images
include the new knight in the actual biome compositions.
