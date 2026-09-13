#!/usr/bin/env node
/** Exercise production scenery and sprites with real Skia, including tile wraps. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const ts = require('typescript');
const { LoadSkiaWeb } = require('@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] ?? '/tmp/frpg-scene-render-audit');

function loadProduction(file, skia) {
  const absolute = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => id === '@shopify/react-native-skia' ? skia :
    require(id.startsWith('.') ? path.resolve(path.dirname(absolute), id) : id), module, module.exports);
  return module.exports;
}

async function main() {
  await LoadSkiaWeb();
  const headless = require('@shopify/react-native-skia/lib/commonjs/headless');
  const { Skia } = headless.getSkiaExports();
  const { drawOffscreen, makeOffscreenSurface, Group, ColorType, AlphaType } = headless;
  const exports = { ...headless, Skia };
  const { WetlandsArtwork } = loadProduction('src/scenes/WetlandsArtwork.tsx', exports);
  const { HollowDelveArtwork } = loadProduction('src/scenes/HollowDelveArtwork.tsx', exports);
  const { delveBackgroundX, delvePropOffset, delveTransition, hollowDelveLayout } = loadProduction('src/scenes/hollowDelve.ts', exports);
  const { sceneryOffset, wetlandsLayout, willowOffset } = loadProduction('src/scenes/wetlands.ts', exports);
  const { SpriteTile } = loadProduction('src/sprites/SpriteTile.tsx', exports);
  const { spriteGeometry } = loadProduction('src/sprites/playback.ts', exports);
  const catalog = require('../assets/sprites/catalog.json');
  const sources = require('../assets/biomes/wetlands/sources.json');
  const decoded = [];
  function decode(file) {
    const data = Skia.Data.fromBytes(new Uint8Array(fs.readFileSync(path.join(root, file))));
    const image = Skia.Image.MakeImageFromEncoded(data);
    data.dispose();
    assert(image, `Decode failed: ${file}`);
    decoded.push(image);
    return image;
  }
  function pixels(image, width, height) {
    const data = image.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    assert(data instanceof Uint8Array);
    return data;
  }
  const images = Object.fromEntries(Object.keys(sources).map(key => {
    const file = `assets/biomes/wetlands/${key}.png`;
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), sources[key].sha256);
    const image = decode(file);
    assert.deepEqual([image.width(), image.height()], sources[key].size);
    return [key, image];
  }));
  const delveSources = require('../assets/biomes/hollow_delve/sources.json');
  const delveImages = Object.fromEntries(Object.entries(delveSources).map(([key, spec]) => {
    const file = `assets/biomes/hollow_delve/${key}.png`;
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), spec.sha256);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, spec.source))).digest('hex'), spec.source_sha256);
    const image = decode(file);
    assert.deepEqual([image.width(), image.height()], spec.size);
    return [key, image];
  }));
  const delveEnemies = ['troglodyte', 'giant_cave_spider', 'bone_slime', 'delve_dwarf', 'delve_gnoll'];
  const actors = Object.fromEntries(['barbarian_player', 'bog_toad', 'root_hulk', ...delveEnemies].map(id =>
    [id, decode(`assets/sprites/${id}--idle.png`)]));
  fs.mkdirSync(output, { recursive: true });
  let renders = 0;
  async function render(layout, camera, selected = images, withActors = false, boss = false) {
    const surface = makeOffscreenSurface(layout.width, layout.height);
    const props = { images: selected, layout,
      distant: { ...layout.distant, x: sceneryOffset(camera, 0.15, layout.distant.width) },
      banks: { ...layout.banks, x: sceneryOffset(camera, 0.35, layout.banks.width) },
      ground: { ...layout.ground, x: sceneryOffset(camera, 1, layout.ground.width) },
      willows: [{ translateX: willowOffset(camera, layout.willowSpacing) }] };
    const nodes = [React.createElement(WetlandsArtwork, { ...props, key: 'scenery' })];
    if (withActors) {
      const heroHeight = layout.ground.width / 256 * 64;
      for (const [id, x, facing] of [['barbarian_player', layout.width * 0.22, 'right'],
        [boss ? 'root_hulk' : 'bog_toad', layout.width * 0.22 + 80, 'left']]) {
        const entity = catalog.entities[id];
        const geometry = spriteGeometry(entity, heroHeight, facing);
        nodes.push(React.createElement(Group, { key: id,
          transform: [{ translateX: x + geometry.left }, { translateY: layout.groundY + geometry.top }] },
        React.createElement(SpriteTile, { image: actors[id], frame: entity.actions.idle.frames[0],
          frameSize: entity.frameSize, scale: geometry.scale, flipped: geometry.flipped })));
      }
    }
    try { renders++; return await drawOffscreen(surface, React.createElement(Group, null, ...nodes)); }
    finally { surface.dispose(); }
  }
  async function renderDelve(layout, position, selected = delveImages, enemy) {
    const camera = layout.width * 0.22 - position;
    const surface = makeOffscreenSurface(layout.width, layout.height);
    const nodes = [React.createElement(HollowDelveArtwork, { key: 'scenery', images: selected, layout,
      background: { ...layout.background, x: delveBackgroundX(camera, layout.background.width, layout.width) },
      ground: { ...layout.ground, x: sceneryOffset(camera, 1, layout.ground.width) },
      props: [{ translateX: delvePropOffset(camera, layout.propPeriod) }],
      galleryOpacity: delveTransition(position, 500), cavernOpacity: delveTransition(position, 1100) })];
    if (enemy) for (const [id, x, facing] of [['barbarian_player', layout.width * 0.22, 'right'],
      [enemy, layout.width * 0.22 + 80, 'left']]) {
      const entity = catalog.entities[id];
      const geometry = spriteGeometry(entity, layout.ground.width / 256 * 64, facing);
      nodes.push(React.createElement(Group, { key: id,
        transform: [{ translateX: x + geometry.left }, { translateY: layout.groundY + geometry.top }] },
      React.createElement(SpriteTile, { image: actors[id], frame: entity.actions.idle.frames[0],
        frameSize: entity.frameSize, scale: geometry.scale, flipped: geometry.flipped })));
    }
    try { renders++; return await drawOffscreen(surface, React.createElement(Group, null, ...nodes)); }
    finally { surface.dispose(); }
  }
  try {
    for (const [name, width, height, groundY, heroHeight] of [
      ['compact', 300, 240, 198, 92], ['portrait', 390, 844, 754, 140],
      ['landscape', 844, 390, 300, 126.5], ['small-phone', 320, 480, 390, 140],
    ]) {
      const layout = wetlandsLayout(width, height, groundY, heroHeight);
      for (const [pose, position] of [['encounter', 280], ['late-run', 1560]]) {
        const image = await render(layout, width * 0.22 - position, images, true, pose === 'late-run');
        const rgba = pixels(image, width, height);
        for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 255, `${name}: uncovered pixel`);
        fs.writeFileSync(path.join(output, `${name}-${pose}.png`), image.encodeToBytes());
        image.dispose();
      }
      for (const [index, enemy] of delveEnemies.entries()) {
        const image = await renderDelve(hollowDelveLayout(width, height, groundY, heroHeight), 280 + index * 320, delveImages, enemy);
        const rgba = pixels(image, width, height);
        for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 255, `Hollow Delve ${name}: uncovered pixel`);
        fs.writeFileSync(path.join(output, `hollow-delve-${name}-${enemy}.png`), image.encodeToBytes());
        image.dispose();
      }
    }
    // Use integer scales/periods so every sampled pixel must match. Each
    // mirrored strip repeats after two source widths; props repeat every 700.
    const layout = wetlandsLayout(640, 360, 288, 64);
    for (const [key, period] of [['distant', 1280 / 0.15], ['banks', 1280 / 0.35], ['ground', 512], ['willow', 700]]) {
      const selected = { sky: null, distant: null, banks: null, ground: null, willow: null, [key]: images[key] };
      const first = await render(layout, 0, selected);
      const repeat = await render(layout, -period, selected);
      assert.deepEqual(pixels(first, 640, 360), pixels(repeat, 640, 360), `${key}: repeat changed the rendered pixels`);
      first.dispose(); repeat.dispose();
    }
    const delveLayout = hollowDelveLayout(640, 360, 288, 64);
    for (const [keys, period] of [[['slate_path'], 512],
      [['mine_support', 'webbed_arch', 'ore_cart', 'quartz_cluster', 'fungus_stump', 'bone_heap', 'stalagmites', 'tool_cache'], 1920]]) {
      const selected = Object.fromEntries(Object.keys(delveImages).map(key => [key, keys.includes(key) ? delveImages[key] : null]));
      const first = await renderDelve(delveLayout, 300, selected);
      const repeat = await renderDelve(delveLayout, 300 + period, selected);
      assert.deepEqual(pixels(first, 640, 360), pixels(repeat, 640, 360), 'Hollow Delve: ground/props repeat changed pixels');
      first.dispose(); repeat.dispose();
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ renderer: 'real Skia / CanvasKit', renders,
      checks: ['17 bundled source hashes and dimensions', 'opaque viewport at four sizes, Wetlands and all five Hollow Delve encounters',
        'production sprites on the shared ground baseline', 'pixel-exact mirrored background/ground and prop repetition'] }, null, 2) + '\n');
    console.log(`Scene rendering passed: ${renders} real-Skia renders. Artifacts: ${output}`);
  } finally { decoded.forEach(image => image.dispose()); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
