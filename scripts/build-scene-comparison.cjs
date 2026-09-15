/** Embed matching production render audits in a portable before/after review.
 * node scripts/build-scene-comparison.cjs BEFORE_DIR AFTER_DIR OUT.html
 */
const fs = require('node:fs');
const path = require('node:path');
const [beforeArg, afterArg, outputArg, mode = "pixels"] = process.argv.slice(2);
if (![beforeArg, afterArg, outputArg].every(Boolean)) throw Error("Expected before directory, after directory and output HTML");
const [before, after, output] = [beforeArg, afterArg, outputArg].map(p => path.resolve(p));
const palette = require("../assets/palette.json");
const title = mode === "palette" ? "One palette across the game" : "Scenery at the characters’ pixel scale";
const caption = mode === "palette" ? palette.name : "Actor pixel scale";
const description = mode === "palette" ? `All six biomes now use exact colors from ${palette.name}, shared with player and authored enemy sprites. These are actual game-renderer captures at matching positions. Geometry, pixel density and authored actor sprites are unchanged.` : "All six biomes use the same 1.5 pixels per game unit for scenery. Props are sized from their in-game height, with grouped color palettes. These are actual game-renderer captures at matching positions; player and enemy sprites are unchanged.";
const scenes = JSON.parse(fs.readFileSync(path.join(__dirname, '../image-generation/biome-assets/review-scenes.json'), 'utf8'));
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const embedded = (folder, file) => `data:image/png;base64,${fs.readFileSync(path.join(folder, file)).toString('base64')}`;
const cards = scenes.map(({ title, image }) => `<section><h2>${escape(title)}</h2><div class="pair"><figure><figcaption>Before</figcaption><img alt="${escape(title)} before" src="${embedded(before, image)}"></figure><figure><figcaption>${escape(caption)}</figcaption><img alt="${escape(title)} updated" src="${embedded(after, image)}"></figure></div></section>`).join('\n');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<style>:root{color-scheme:dark;font-family:system-ui;background:#191c1e;color:#e8e3d8}body{max-width:1740px;margin:auto;padding:24px}h1{margin-bottom:8px}p{color:#bdb9af;line-height:1.5;max-width:800px}section{margin:32px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}figcaption{margin-bottom:8px;color:#c7b48d}img{display:block;width:100%;image-rendering:pixelated}label{display:inline-flex;align-items:center;gap:8px}body.large .pair{grid-template-columns:1fr}body.large img{max-width:none;width:100%}@media(max-width:850px){body{padding:16px}.pair{grid-template-columns:1fr}}</style>
<h1>${escape(title)}</h1><p>${escape(description)}</p><label><input type="checkbox" onchange="document.body.classList.toggle('large',this.checked)"> Larger stacked views</label>${cards}</html>`);
console.log(`Scene comparison: ${output}`);
