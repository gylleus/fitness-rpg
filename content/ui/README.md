# Menu artwork

The UI content library lives here, alongside the game's other authored content.
`UI.toml` describes the camp, backgrounds, frames, buttons, inventory art and
small native symbols. Each asset has a stable ID, appearance description,
generation composition and runtime contract.

## Regeneration

1. Read `../design_guidelines.toml` and `UI.toml` for the shared direction.
2. Use the corresponding **complete prompt** in `generation-prompts.json` with
   the built-in `image_gen` tool, once per asset. For the button, apply
   `button-refinement.txt` as an edit to the first generation.
3. Inspect the result for baked-in text, artifacts, alpha holes, and safe areas.
   Keep the camp's middle foreground empty for the real equipped player sprite.
4. Copy the selected PNG into `assets/ui/` using a new versioned filename. Update
   `src/ui/art.ts`, the runtime contract here, and `assets/ui/manifest.json`.
5. Run `node scripts/check-ui-assets.cjs`, the UI tests, and an Android export.
   Review narrow and wide layouts, enlarged text, disabled controls and scrolling.

`assets/ui/manifest.json` records exact image dimensions, hashes, original
filenames and generation method. All five PNGs were generated with the built-in
tool, then copied unchanged into the project. No API key or local ML environment
was used. Output dimensions are measured, not assumed from requested ratios.
The palette is visual guidance; these sources are not quantized to ENDESGA 32.

## Rendering contracts

- Text, hit targets, selection, values and progress meters remain native.
- `PanelFrame` splits the square source into eight border slices. Corners remain
  18 logical pixels across cards of different sizes on Android and iOS.
- Primary buttons crop the source's unused lower margin during rendering.
  Their full native touch target is at least 48 logical pixels high.
- Backgrounds and decorative images are hidden from accessibility traversal.
- Only the already-authored player sprite animates in camp, while the tab is
  focused and the app is foregrounded. The menu artwork adds no animation loop.
- All art uses local static `require()` calls and works offline.

These UI definitions are an art library, separate from the enemy/biome gameplay
catalog. They do not add gameplay rules or require a catalog schema migration.

## Visual review

Open [review.html](review.html) locally for the asset gallery and menu screenshots
at 320, 390 and 720 pixels, plus an enlarged-text sample. The page works offline.
Screenshots render the actual screen components through React Native Web with
fixture game data, mocked native services and a static player frame. The review
footer records those limits; it is not evidence of a device installation.
