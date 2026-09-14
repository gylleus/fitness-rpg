/** Portable palette review from matching production scene captures and runtime assets.
 * node scripts/build-palette-review.cjs BEFORE_DIR AFTER_DIR [OUTPUT_DIR]
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const [before, after, destination = 'image-generation/scene-samples/global-palette-v1'] = process.argv.slice(2);
if (!before || !after) throw Error('Supply matching before/after scene capture directories');
const out = path.resolve(destination), palette = require('../assets/palette.json');
fs.mkdirSync(out, { recursive: true });
const run = (script, ...args) => execFileSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: root, stdio: 'inherit' });
run('build-scene-comparison.cjs', before, after, path.join(out, 'comparison.html'), 'palette');
const biomes = fs.readdirSync(path.join(root, 'assets/biomes'));
const pngCount = folder => fs.readdirSync(folder, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? pngCount(path.join(folder, entry.name)) : Number(entry.name.endsWith('.png'))), 0);
const counts = Object.fromEntries(['sprites', 'biomes', 'items', 'maps'].map(kind => [kind, pngCount(path.join(root, 'assets', kind))]));
const propCount = biomes.reduce((sum, id) => sum + Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'assets/biomes', id, 'props.json'))).props).length, 0);
const interiors = biomes.filter(id =>
  fs.existsSync(path.join(root, 'assets/biomes', id, 'interior.json')));
for (const id of interiors) {
  const folder = path.join(root, 'assets/biomes', id), review = path.join(out, id);
  run('build-interior-review.cjs', folder, path.join(review, 'review.html'));
  fs.copyFileSync(path.join(folder, 'props.json'), path.join(review, 'props.json'));
}
run('review-item-icons.cjs', path.join(out, 'items.html'));
const embed = file => 'data:image/png;base64,' + fs.readFileSync(path.join(root, file)).toString('base64');
const style = '<style>:root{color-scheme:dark;font:16px/1.5 system-ui;background:#181425;color:#c0cbdc}body{max-width:1200px;padding:24px;margin:auto}a{color:#e4a672}img{max-width:100%;image-rendering:pixelated}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.swatches{display:flex;flex-wrap:wrap}.swatches span{width:32px;height:32px}figure{margin:0}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style>';
const header = title => '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title>' + style;
fs.writeFileSync(path.join(out, 'map.html'), header('World map palette comparison') +
  '<h1>World map</h1><p>The same source, dimensions and landmarks. Only the exported colours change.</p><div class="pair"><figure><figcaption>Before</figcaption><img alt="Original map" src="' +
  embed('image-generation/maps/world-map-v1/source.png') + '"></figure><figure><figcaption>' + palette.name + '</figcaption><img alt="Map using the global palette" src="' +
  embed('assets/maps/world-map.png') + '"></figure></div></html>');
fs.writeFileSync(path.join(out, 'index.html'), header('Global game palette review') +
  `<h1>${palette.name} throughout the game</h1><p>${Object.values(counts).reduce((a, b) => a + b, 0)} runtime textures share one palette: ${counts.sprites} actor sheets, ${counts.biomes} biome textures including ${propCount} decorations, ${counts.items} item icons and ${counts.maps} map. Authored actor sprite files are unchanged. Code-drawn fallback sprites also use this palette.</p>` +
  '<div class="swatches" aria-label="Global palette">' + palette.colors.map(color => `<span title="${color}" style="background:${color}"></span>`).join('') + '</div>' +
  '<p><a href="comparison.html">Compare all six biomes before and after</a></p><ul>' + interiors.map(id =>
    `<li><a href="${id}/review.html">${id.replaceAll('_', ' ')} — parallax, roof and decorations</a></li>`).join('') +
  '</ul><p><a href="items.html">All item icons</a> · <a href="map.html">World map before and after</a></p><p>Each linked HTML is self-contained and works offline. Palette mapping changes the colours; the underlying source drawing is preserved.</p></html>');
console.log(`Palette review: ${path.join(out, 'index.html')}`);
