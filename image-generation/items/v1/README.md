# Generated item icons, version 1

The source of truth is `content/items`: 24 items each in maces, swords, axes,
body armor, helmets, gloves, rings and amulets. `prompts.json` contains one
individual prompt for every definition, with a source-definition hash.

Generation uses the built-in imagegen tool, one transparent image per item.
No local SDXL/Wan model or OpenAI CLI/API fallback is used. Source images are
saved locally in `sources/`; each original retains the returned bytes. They
are ignored by Git to keep the game repository compact. The 64×64 PNG exports
in `assets/items` and the individual records in `provenance/` are versioned.
Each record includes the exact prompt, source hash, exported icon hash and
resizing method. The UI scales those exports with nearest-neighbor sampling.

After generating a particular prompt with the built-in tool:

```sh
node scripts/import-item-icon.cjs ITEM_ID /path/to/returned-image.png
node scripts/bundle-item-icons.cjs
node scripts/bundle-item-icons.cjs --check
node scripts/review-item-icons.cjs
```

Import preserves the original and uses ImageMagick's Point filter solely to
export the requested 64×64 size with original alpha, followed by the shared
[master palette mapper](../../PALETTE.md). It does not remove backgrounds or
add painted transparency. All visible RGB values use the global game palette.
An existing icon is never silently overwritten. ImageMagick (`convert` and
`montage`) is required for these asset preparation/review commands.

After a fresh imagegen generation or edit fixes a rejected image, use
`node scripts/import-item-icon.cjs ITEM_ID GENERATED.png --replace-with-prompt PROMPT.txt`.
The prompt file must contain the exact generation request. This explicit revision
archives the old source, 64px export and provenance together under
`sources/rejected/`, then records the replacement prompt and superseded hashes.
Four initial amulet images needed this step because their chains left the frame.
Their first edits returned opaque checkerboards, so the accepted replacements
were generated from the authored descriptions with stricter necklace framing.
Add `--fit-content` when a complete cutout has excessive transparent padding:
this removes only empty outer borders and fits the art within 56×56, centered on
the 64×64 export. The four amulet replacements use this sizing option.

Bundling verifies all 192 files exist, their sizes, visible content, real alpha,
unclipped borders and provenance hashes, then writes Metro's static lookup.
`--partial` is only for development while a batch is running; the final bundle
and its check require the complete catalog. `review.html` displays the actual
game PNGs at 64px, 128px or 256px, with search and category filters. The review
script also produces labeled category contact sheets under `/tmp/frpg-item-review`.

These icons illustrate the named base item. Rolled modifiers retain that same
icon and add their names and stats in the item detail view. They do not alter
the player's battle animation or the shape of the held club sprite.

Rebuild all icons with `uv run sprite-python scripts/export_static_asset.py --reexport-items`.
`palette_export` records the exact palette and input hash. When original local-only
masters are unavailable, `palette-inputs/` preserves the accepted pre-palette exports.
