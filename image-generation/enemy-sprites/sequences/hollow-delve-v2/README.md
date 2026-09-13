# Hollow Delve creature revisions

The selected troglodyte has a deep hunch, low head and long fleshy tail. The
beardless dwarf has red eyes and a crescent-bladed axe. Their canonical designs
are in [ENEMIES.toml](../../../../content/biomes/hollow_delve/ENEMIES.toml).

Each `sheet-source.png` is an immutable built-in imagegen result containing
six columns and four action rows: idle, walk, attack and death. The exact
generation inputs are preserved in `sources.json` and each `prompt.txt`.
The other three cave enemies retain their v1 art.

Rebuild the selected 48 poses, then package the game:

```sh
uv run sprite-python image-generation/enemy-sprites/sequences/hollow-delve-v2/prepare.py
uv run sprites bundle
```

The importer isolates the 24 alpha-connected poses, preserves their horizontal
motion within the authored columns, and applies one scale and union crop to all
actions. It does not synthesize motion or resize poses independently. Exports
are 128-pixel ENDESGA32 sprites with binary alpha and nearest sampling.

`ground-contacts.json` records the reviewed support line in source-image pixels.
In the dwarf's fourth and fifth attack poses, the blade extends six and twelve
pixels below the boots. Those poses use the boot line at source y=751, allowing
the axe to strike into the floor without lifting the feet. Settled corpses use
their actual resting contact. Transparent frame padding is retained to preserve
motion and pivots; it does not contribute to the visible height or placement.

Idle and walk loop. Attack lasts 720 ms and returns to idle; death lasts 900 ms
and holds the last pose. Generated poses have minor surface-shading variation,
so source and exported comparisons are retained for inspection.
