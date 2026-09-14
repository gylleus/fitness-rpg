/** Build a portable HTML review using production layout and sprite geometry. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const folder = path.resolve(process.argv[2] || '.');
const read = file => JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const dataURL = file => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

async function main() {
  const scene = read('interior.json'), props = read('props.json'), sources = read('sources.json');
  const textures = {};
  for (const [key, spec] of Object.entries(sources)) {
    const file = path.join(folder, `${key}.png`), bytes = fs.readFileSync(file);
    if (sha(bytes) !== spec.sha256) throw Error(`Changed texture: ${key}`);
    textures[key] = { url: dataURL(file), size: spec.size };
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/sprites/catalog.json'), 'utf8'));
  const hero = catalog.entities.barbarian_player;
  const data = { title: props.biome_id.split('_').map(s => s[0].toUpperCase()+s.slice(1)).join(' '),
    assets: { scene, ground: { canvas: sources.ground.canvas, surface_y: sources.ground.surface_y }, props },
    textures, hero, heroImage: dataURL(path.join(root, 'assets/sprites/barbarian_player--idle.png')) };
  if (!data.assets.ground.canvas || !Number.isFinite(data.assets.ground.surface_y)) throw Error('Ground geometry is missing');
  const geometry = await esbuild.build({ stdin: {
    contents: "export * from './src/scenes/interior'; export { visibleScenery } from './src/scenes/sceneryAtlas'; export { spriteGeometry } from './src/sprites/playback';",
    resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'InteriorGeometry', minify: true });
  const template = fs.readFileSync(path.join(root, 'image-generation/biome-assets/interior-review.html'), 'utf8');
  const html = template.replace('/* GEOMETRY */', () => geometry.outputFiles[0].text)
    .replace('/* SCENE_DATA */', () => JSON.stringify(data).replace(/</g, '\\u003c'));
  fs.writeFileSync(path.join(folder, 'review.html'), html);
  console.log(`Standalone review: ${path.join(folder, 'review.html')}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
