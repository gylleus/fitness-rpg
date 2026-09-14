# Knight weapon classes

Open [review.html](review.html) directly in a browser to play, pause, slow down
or step through all four sets. It uses local PNGs and requires no server.
[weapon-previews.png](weapon-previews.png) shows the four ready poses.

The built-in **imagegen** tool generated `references/mace.png` using the
previous knight as its identity reference. The axe, sword and fist previews
were weapon edits of that same master image, preserving the closed helmet,
weathered steel plate, burgundy cloth and planted stance. Each class uses a
standard weapon silhouette for every item in its family. Fist weapons use
reinforced iron knuckles and a straight punch.

Exact prompts are saved beside each source as `*-prompt.txt`. `sources.json`
records source hashes, shared scales, column origins and physical ground
contacts. The mace preview has true alpha; the other selected sources use a
magenta color key. The axe initially returned a painted checkerboard, so a
background-only imagegen edit supplied a clean key. The rejected intermediate
is retained as `references/axe-checkerboard.png` for edit provenance.

`mace-source.png` contains six authored poses per walk, attack and death.
The axe and sword sheets edit its weapon in each pose. The fist sheet keeps
the player identity and replaces the weapon swing with a punch. All sources
are preserved unchanged; export removes the background, registers connected
figures at reviewed body contacts, and maps to the game's ENDESGA-32 palette.
The source sheet uses a single scale across all actions and classes. Corpse
height and weapon reach never determine an individual frame's scale.

### Hand and cloth corrections

The original attack row incorrectly changed from the far weapon arm in idle
to the near arm during windup. The historical `corrections/*-attack.png` sources
first replaced its four interior poses for mace, axe and sword. These were
built-in imagegen edits of the master reference, then weapon edits of the
corrected mace sequence. The nearer pauldron, elbow and empty fist remain
folded across the chest; the farther hand retains the weapon from windup
through impact and recovery. Hand ownership was reviewed visually in all
four source poses and the final [attack comparison](corrections/attack-review.png).
The subsequent motion pass below replaces walk and attack. Death still uses
the original sheet; all original and correction sources remain available.

`corrections/axe-reference.png` corrects the warmer cloth highlights introduced
by the axe edit. Palette conversion had amplified small source hue differences
into orange and saturated red. The exporter now constrains these cloth colors
to the shared muted burgundy `#733e39` within reviewed garment bounds for all
classes. Metal, leather and silhouettes keep their original palette treatment.
The pixel tests cover the exported cloth, rigid idle, clean alpha, ground
contact and timing; they do not infer anatomical correctness from image data.

Exact correction prompts are stored beside their selected PNGs. `sources.json`
records their hashes, physical origins and the fixed scale shared by the
four attack poses. Original sources remain available for comparison.

### Body motion and attack timing

The active `motion-v3/*-attack.png` sources add whole-body anticipation and
follow-through. Knees compress and the shoulders turn back to load the strike;
the torso then drives forward over a bent front knee with the rear leg extended.
A separate low finish lets the body absorb the blow. Mace, axe and sword retain
the far weapon hand; fists use a far-arm cross with the same weight transfer.
The built-in imagegen tool edited the accepted knight poses, then produced
weapon variants. Exact prompts, including corrective hand edits, are saved
beside each selected source. The poses and hand continuity were reviewed
visually in the [attack comparison](motion-v3/attack-review.png).

The six attack holds are **40 / 160 / 200 / 60 / 240 / 100 ms**: guard, load,
peak windup, impact, follow-through, guard. At the game's 360ms attack speed,
the peak windup holds for 90ms, impact for 27ms, and follow-through for 108ms.
The large pose change into impact gives the strike its speed; the longer holds
before and after give it weight. Impact still begins at 180ms. Playback tests
exercise these phase boundaries for all four classes.

`motion-v3/*-walk.png` replaces the six walking poses with contact, down and
rising passing poses on each step. Knees and hips drive an 8–9px helmet bob at
the final 128px grid. Each frame uses the same physical scale and is registered
at its supporting boot; the exporter does not normalize the moving head height.
Pixel checks verify the down/up ordering and ground contact. See the
[walk comparison](motion-v3/walk-review.png), or enable repeating attacks and
half speed in [the interactive preview](review.html).

Idle and death PNGs are unchanged by this motion pass. The shared burgundy
palette is retained, with garment bounds covering the wider action poses.

## The quiet idle

Each idle is built from its fixed master ready pose at the final 128px grid.
The head, torso, arms and weapon move together by at most one vertical pixel.
A narrow band at the knees absorbs this shift; boots never move. Horizontal
coordinates never change. The eight-frame cycle takes **2,400 ms** and returns
to the exact initial pixels. This prevents generative weapon morphing and
side-to-side swinging. Tests compare the upper-body pixels under translation,
require identical boots, and verify every exported tile has clean alpha.

Every set has four atlases: idle (8 frames), walk (6), attack (6), death (6),
for **16 atlases / 104 frames**. They share 128×128 cells, a (62,112) ground
pivot, and a 78px body-height reference. Attack begins and ends on the exact
idle ready pose. Its fourth frame starts halfway through the authored 800ms
sequence, matching the game's existing 180ms impact during a 360ms attack.
Death lasts 900ms and holds the final frame.

## Rebuild and verify

From the repository root:

```sh
uv run sprite-python image-generation/player-sprites/sequences/knight-weapons-v2/prepare.py
uv run sprites bundle
uv run sprite-python -m unittest discover -s image-generation/player-sprites/sequences/knight-weapons-v2 -p test_prepare.py
npm run test:sprites
```

`mace/export/manifest.json` retains the legacy `barbarian_player` ID. Other
IDs are `knight_player_axe`, `knight_player_sword`, and `knight_player_fist`.
The runtime selector lives in `src/sprites/player.ts`. Camp uses equipped gear;
expeditions use the weapon class saved on entry. Empty weapon slots use fists.
Old expeditions without a class retain their mace appearance. Item metadata
supports all four classes; this art change adds no new item definitions.

`uv run sprites bundle` preserves the encoding of existing PNGs whose pixels
are unchanged, so regenerating player art does not churn unrelated enemy files.
