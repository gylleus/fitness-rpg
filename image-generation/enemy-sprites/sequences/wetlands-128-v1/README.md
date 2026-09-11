# Wetlands 128px roster trial

Five newly generated enemy designs and all four animation states, matching the
current barbarian's higher-detail pixel-art direction. Each action contains
eight authored poses. The final frames are **128×128**, transparent, and mapped
to the same ENDESGA32 palette as the player.

Open **[review.html](review.html)** for an offline animated lineup, individual
2× frame views, pause, slow motion, restart and manual pose selection. The
[static lineup](lineup.png) compares the actual game-relative sizes.

| Enemy | Idle | Walk | Attack | Death |
| --- | --- | --- | --- | --- |
| Bog Toad | Planted breathing/throat cycle | Low shuffle | Crouch, forward lunge, landing, recovery | Side collapse with closed eyes |
| Drowned Corpse | Planted body sway | Heavy alternating steps | Distinct arm windup and forward strike | Knees buckle, side fall, inert ending |
| Bog Hag | Lifts and releases skirt | Deliberate barefoot steps | Long-arm claw reach/rake and recovery | Sinks, topples, ends lying on side |
| Root Hulk | Heavy compression and vine movement | Broad root-foot steps | Both fists raised, simultaneous ground contact, push-up recovery | Low collapsed root heap |
| Giant Water Strider | Two planted legs, slight balancing | Two-legged gait | Large open jaw, snapping bite, recovery | Two legs fold beneath the body |

These are built-in **imagegen reference and frame-sheet generations**, followed
by deterministic CPU extraction/import. They are not new Wan video runs and do
not reuse the old enemies' animation frames. The player art is unchanged.

## Source and reproduction

Each enemy folder contains its generated `reference-source.png` and four
`ACTION-source.png` images. The adjacent JSON files preserve exact prompts,
source hashes, input-reference hashes and backend identity. The hulk reference
also records its head correction prompt. `roster.json` snapshots the approved
canonical designs and records the source TOML hash; original content is unchanged.

All generation used the barbarian profile as a style reference, then each new
enemy reference as the identity input for its four separate action sheets.
References emphasize grouped pixels, dark outlines, rich controlled shading,
weathered materials, left-facing silhouettes and anatomy-specific constraints.
Action prompts explicitly describe all eight poses and the recovery/death endpoint.

Rebuild from the repository root with the existing pinned sprite environment:

```bash
uv run sprite-python image-generation/enemy-sprites/sequences/wetlands-128-v1/prepare.py
uv run sprites bundle
uv run sprite-python image-generation/enemy-sprites/sequences/wetlands-128-v1/review.py
npm run test:sprites
npm run test:ui -- --runTestsByPath test/ui/sprites.test.tsx
```

`prepare.py` verifies source checksums and extracts exactly eight connected
subjects per sheet. RGB blue-gray backgrounds are color-keyed at `[139,155,180]`
with a maximum channel difference of 26; tiny detached specks are discarded.
Component masks keep a reaching hand or foot separate from the neighboring
pose even when the generated grid is uneven.

One documented scale factor **per action** matches its first ready pose's height
to idle. The same factor applies to all eight poses; individual poses are never
rescaled. Horizontal motion remains relative to source grid columns. Ground
alignment uses attached silhouette contact, with an explicit raised contact for
the airborne toad pose. `extraction.json` records boxes and factors. Intermediate
`ACTION-layout.png` sheets and `import.json` feed the existing shared importer,
which applies one final crop/scale/pivot across all four actions.

The game bundle recipe is `image-generation/game-sprites.json`. Original 64px
sources remain in `enemy-sprites/runs/wetlands-selected`. A replayable
`previous-bundle.json` retains the previous selection; restoring it requires
those local source runs and an explicit bundle command with `--recipe`.

## Review and validation

All 160 enemy poses were visually inspected in source sheets and native 128px
contact sheets. Attacks have visible preparation/strike/recovery, all deaths
reach settled collapsed poses, and the strider retains two legs in the inspected
poses. The hulk remains visibly wooden through its overhead attack.

This is a higher-detail **style trial**, not a claim of frame-perfect animation.
There is residual texture/shading and body-volume variation; some gait phases
and loop transitions could use manual cleanup. Several bodies retain a slight
three-quarter presentation. ENDESGA32 noticeably warms gray-green source colors,
especially on the corpse and hag. These limitations remain relevant to existing
art-cleanup issues `frpg-umv` and `frpg-kfl`.

`audit.json` checks all 160 enemy poses for 128px dimensions, binary alpha,
zero hidden RGB, palette membership, nonempty silhouettes, border clearance,
eight-frame coverage, positive timing and correct loop flags.

The production Skia renderer passed **192 exact atlas crops** (including the
unchanged player) and **144 scaled/mirrored samples**. The focused sprite UI
suite passed **11 tests**. These validate packaging/playback, not artistic quality.
Rebuilding the complete source import and bundle preserved all 24 atlas PNGs
byte-for-byte. The portable review's JavaScript syntax was checked; live browser
inspection was unavailable because this session exposes no browser surface.
