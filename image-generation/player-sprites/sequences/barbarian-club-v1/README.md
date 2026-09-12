# Barbarian animation set

Eight authored poses each for idle, walk, attack and death, generated from
`../../guides/barbarian-club-profile-v1.png` with the built-in imagegen tool.
Each source PNG has a JSON sidecar containing the exact prompt and source hash.
This is **imagegen sheet generation**, not a Wan video run. The local CUDA
device was unavailable in the agent environment.

The character faces right, has long blond hair, a bare chin, covered eyes,
a happy toothy grin and one wooden club. The attack has a large overhead
windup, smash and recovery. It rises higher during the windup than the low
guard. The source poses have some shading and body-shape variation; these are
eight-pose pixel animations, not interpolated video.

`import.json` records the source rectangles and ground anchors. The generated
grid was uneven: two attack clubs crossed their nominal cells and the death
row's ground was higher. These explicit rectangles keep the complete poses;
ground anchors correct layout drift without scaling individual poses. A color
key removes the blue-gray background, then the existing nearest/ENDESGA32
converter applies one crop and scale across all 32 frames.

Rebuild the transparent 128px sheets on CPU:

```bash
uv run sprite-python image-generation/sprite-pipeline/sheet_import.py \
  --recipe image-generation/player-sprites/sequences/barbarian-club-v1/import.json \
  --out image-generation/player-sprites/sequences/barbarian-club-v1/export
uv run sprites bundle
```

`export/comparison.png` shows every final pose. Per-action `preview.gif` files
repeat for review; the game uses the atlas loop flag and holds death's final
frame. Idle lasts 1200ms, walk 800ms, attack 800ms and death 800ms at source
timing. Combat fits attack playback into its 720ms action window.

The source images and exports are retained alongside the game bundle so these
steps need neither an image service nor a GPU.
