# Authored enemy sheets

Use one importer for every biome, including externally generated imagegen sheets:

```sh
uv run sprites import-sheets \
  --recipe image-generation/enemy-sprites/sequences/wetlands-128-v1/sheet-recipe.json \
  --out /tmp/wetlands-import
uv run enemy-sprites import-sheets \
  --recipe image-generation/enemy-sprites/sequences/hollow-delve-v2/sheet-recipe.json \
  --out /tmp/delve-import
```

Each recipe declares assets, immutable source paths/hashes, grid rows/columns,
alpha or color-key extraction, component area threshold, and ordered pose indices
for each action. Paths resolve relative to the recipe, independent of the shell's
working directory. Action data supplies positive durations, loop intent, and optional
reviewed source `ground_contacts_y` or upward `lift` distances. For example, the
toad's airborne frame and the dwarf's axe-below-boots poses are data corrections.
No enemy name receives special treatment in Python.

`scale_mode = source` preserves source dimensions across a multi-action sheet.
`ready_pose` applies one documented factor per action for independently generated
sheets, matching the first ready pose's height. Both retain horizontal motion
relative to grid columns and use one final union crop/scale/pivot across all actions.
Individual poses are never fitted independently. Death is always one-shot.

All sources and layouts are validated before any output is written. Output includes
aligned layouts, `import.json`, extraction provenance with the recipe hash, and
the existing shared importer exports. Connected extraction requires separated
subjects; an unexpected component count fails instead of guessing which limbs
belong together. Review source boxes, ground contact, anatomy and timing before
selecting a manifest in `image-generation/game-sprites.json`, then run
`uv run sprites bundle` and `npm run test:sprites`.

Wetlands v1 and Hollow Delve v1/v2 now use these recipes. Their old `prepare.py`
commands are compatibility wrappers. Their original prompts and source PNGs remain
historical evidence; adding a biome requires a recipe, not a new extraction script.
The SDXL/Wan route remains available through `enemy-sprites plan/reference/animate`.
Both routes end in the same runtime manifests and atlas bundler.
