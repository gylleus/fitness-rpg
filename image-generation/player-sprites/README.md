# Player sprites

The current game uses the [knight weapon sets](sequences/knight-weapons-v2/README.md)
with a restrained breathing idle and separate mace, axe, sword and fist
animations. Open the [interactive preview](sequences/knight-weapons-v2/review.html)
to compare them. The experiments below are historical.

## Barbarian player experiment

This player uses the same local rendering pipeline as the enemy experiment,
through an art-only [definition](barbarian.toml). No enemy statistics or biome
membership are required. The experiment adds no player entry to the curated
content catalog and does not change the running game.

The candidate is an adult, bare-chested barbarian with shaggy brown hair and
beard, fur shorts, leather wrist wraps, boots and a hand axe. Right-facing
side-scroller framing complements the left-facing enemies. These specific
appearance and weapon choices are experimental elaborations of the requested
lightly clothed barbarian, not a finalized character specification.

- [Animation and reducer comparison](runs/barbarian-v6/review.html)
- [128px animation comparison](runs/barbarian-v6/review-128-step-2.html)
- [64px versus 128px](runs/barbarian-v6/resolution-comparison.png)
- [Comparison sheet](runs/barbarian-v6/comparison.png)
- [Seven reference trials](runs/barbarian-v6/reference-trials.png)
- [PNG assets and provenance bundle](runs/barbarian-v6/sprites.zip)
- [Shared pipeline interface and limitations](../sprite-pipeline/README.md)
- [Visual findings and validation](runs/barbarian-v6/RESULTS.md)

The v6 source was selected for a single right-facing side silhouette. It still
places the axe behind the hips with an ambiguous grip, adds bright boot cuffs,
and lengthens the beard. See the run's review notes for animation observations.
Matching palette and correct file dimensions do not establish production quality.

## Replay the saved run

Generated runs and ZIP bundles are local artifacts and are excluded from Git.
The small pose guide and saved v2/v6 configurations under `recipes/` are versioned.
In a fresh checkout, restore a configuration without overwriting an existing run:

```bash
mkdir -p image-generation/player-sprites/runs/barbarian-v6
cp -n image-generation/player-sprites/recipes/barbarian-v6.json image-generation/player-sprites/runs/barbarian-v6/config.json
```

The authoritative recipe is [the saved configuration](runs/barbarian-v6/config.json).
It contains the exact prompts used, even if the general prompt builder evolves.
All commands run from the repository root with the existing local environment:

```bash
uv run sprites references --run image-generation/player-sprites/runs/barbarian-v6
uv run sprites prepare --run image-generation/player-sprites/runs/barbarian-v6
uv run sprites animate --run image-generation/player-sprites/runs/barbarian-v6 --mask-check-every 22
uv run sprites export --run image-generation/player-sprites/runs/barbarian-v6
uv run sprites review --run image-generation/player-sprites/runs/barbarian-v6
uv run sprites package --run image-generation/player-sprites/runs/barbarian-v6
```

`all --run image-generation/player-sprites/runs/barbarian-v6 --mask-check-every 22`
runs those stages in sequence. Completed inference is hash-checked and reused.
To experiment with a new definition or seed, use a new run directory and the
current planner instead of replanning an old recipe:

```bash
uv run sprites plan --definition image-generation/player-sprites/barbarian.toml --run image-generation/player-sprites/runs/NEW_RUN --seed 91006 --reference-lora 0.35 --guide-image image-generation/player-sprites/guides/barbarian-profile.png --guide-strength 0.72 --size 64 --frame-step 2
uv run sprites all --run image-generation/player-sprites/runs/NEW_RUN --mask-check-every 22
```

The pose guide is a recorded crop of the left subject in trial v2, resized with
aspect-preserving nearest neighbor and gray padding. It is not hand-painted.
To rebuild it from the saved trial:

```bash
mkdir -p image-generation/player-sprites/runs/barbarian-v2
cp -n image-generation/player-sprites/recipes/barbarian-v2.json image-generation/player-sprites/runs/barbarian-v2/config.json
uv run sprites references --run image-generation/player-sprites/runs/barbarian-v2
uv run sprite-python image-generation/player-sprites/rebuild_guide.py
```

The crop recipe includes both source-file and decoded-pixel hashes. Rebuilding
rejects changed pixels instead of silently accepting a different guide. Model
inference is not guaranteed bit-identical across different hardware/software;
the saved originals and guide preserve this experiment's actual inputs.

## Outputs and settings

The reference uses SDXL + Pixel Art XL at LoRA 0.35, img2img strength 0.72, nominal
30 steps (21 effective), CFG 7, 1024×1024, DPM++ 2M Karras and base seed 91006.
The stable character ID and action derive individual recorded seeds. Trials v1–v4
used text-to-image; v5–v7 used the saved profile guide. These are iterative art
trials with changing prompts, seeds and strengths, not a controlled ablation.

Wan2.2 I2V A14B FP8, LightX2V 4-step acceleration, and the existing pixel animation
adapter produce 45 frames per motion at 512×512 and 16 fps. Models remain local
and no new weights were downloaded. Loops use experimental matching start/end
conditioning; attacks use the starting reference. All raw frames remain saved.

BiRefNet removes the reference background before input pixel conversion and
initializes SAM2 tracking for animation frames. Independent BiRefNet mask checks
run at 0, 22, 44; SAM tracks every frame. Final exports are binary-alpha 64×64
PNGs using exactly ENDESGA32, with nearest and conservative Pyxelate variants.
One crop and pivot cover the reference and both actions. Frame step 2 gives
22 idle poses over 2.75 seconds and 23 attack poses over 2.812 seconds. The attack
is one-shot; repeating its preview does not make it a game loop. A separate
static reference PNG uses the same frame size, crop and pivot.

`originals/`, `references/`, animation contracts/workflows, dependency/model locks,
and the saved source definitions document the recipe. Actual-size frames and
eight-column PNG spritesheets live under `exports/barbarian_player/`. The offline
viewer enlarges 64-pixel frames 4× without filtering. Use the frame metadata for
durations, source frame indices, pivot, and scale when integrating into the game.

To change pixel resolution or cadence without regenerating the video:

```bash
uv run sprites export --run image-generation/player-sprites/runs/barbarian-v6 --size 128 --frame-step 4
```

The new export goes to a separate directory. A walk/run cycle, hurt, death,
equipment variants and game integration can use this foundation, but were not
generated in this initial idle/attack experiment.
