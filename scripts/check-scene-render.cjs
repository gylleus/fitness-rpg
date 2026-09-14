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
const productionModules = new Map();

function loadProduction(file, skia) {
  const absolute = path.join(root, file);
  if (productionModules.has(absolute)) return productionModules.get(absolute).exports;
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  productionModules.set(absolute, module);
  new Function('require', 'module', 'exports', code)(id => {
    if (id === '@shopify/react-native-skia') return skia;
    if (!id.startsWith('.')) return require(id);
    const resolved = path.resolve(path.dirname(absolute), id);
    for (const suffix of ['.ts', '.tsx']) if (fs.existsSync(resolved + suffix)) {
      return loadProduction(path.relative(root, resolved + suffix), skia);
    }
    return require(resolved);
  }, module, module.exports);
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
  const { hollowDelveLayout } = loadProduction('src/scenes/hollowDelve.ts', exports);
  const { InteriorArtwork } = loadProduction('src/scenes/InteriorArtwork.tsx', exports);
  const { interiorLayout } = loadProduction('src/scenes/interior.ts', exports);
  const { INTERIOR_LOCATIONS } = loadProduction('src/scenes/interiorLocations.ts', exports);
  const { sceneryOffset, wetlandsLayout } = loadProduction('src/scenes/wetlands.ts', exports);
  const { visibleScenery } = loadProduction('src/scenes/sceneryAtlas.ts', exports);
  const { SceneryAtlasArtwork } = loadProduction('src/scenes/SceneryAtlasArtwork.tsx', exports);
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
  const newInteriors = Object.keys(INTERIOR_LOCATIONS).filter(id => id !== 'hollow_delve');
  const interiorImages = Object.fromEntries(newInteriors.map(id => {
    const source = require(`../assets/biomes/${id}/sources.json`);
    const images = Object.fromEntries(Object.entries(source).map(([key, spec]) => {
      const file = `assets/biomes/${id}/${key}.png`;
      assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), spec.sha256);
      assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, spec.source))).digest('hex'), spec.source_sha256);
      const image = decode(file);
      assert.deepEqual([image.width(), image.height()], spec.size);
      return [key, image];
    }));
    return [id, images];
  }));
  const actors = Object.fromEntries(['barbarian_player', 'bog_toad', 'root_hulk', ...delveEnemies].map(id =>
    [id, decode(`assets/sprites/${id}--idle.png`)]));
  fs.mkdirSync(output, { recursive: true });
  let renders = 0;
  function atlasDrawing(layout, camera) {
    const visible = visibleScenery(layout.scenery, camera);
    return { propSprites: visible.sprites,
      propTransforms: visible.transforms.map(t => Skia.RSXform(t.scos, t.ssin, t.tx, t.ty)) };
  }
  async function render(layout, camera, selected = images, withActors = false, boss = false) {
    const surface = makeOffscreenSurface(layout.width, layout.height);
    const props = { images: selected, layout,
      distant: { ...layout.distant, x: sceneryOffset(camera, 0.15, layout.distant.width) },
      banks: { ...layout.banks, x: sceneryOffset(camera, 0.35, layout.banks.width) },
      ground: { ...layout.ground, x: sceneryOffset(camera, 1, layout.ground.width) },
      ...atlasDrawing(layout, camera) };
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
  async function renderDelve(layout, position, selected = delveImages, enemy, artwork = HollowDelveArtwork, withHero = Boolean(enemy)) {
    const camera = layout.width * 0.22 - position;
    const surface = makeOffscreenSurface(layout.width, layout.height);
    const nodes = [React.createElement(artwork, { key: 'scenery', images: selected, layout,
      camera,
      ground: { ...layout.ground, x: sceneryOffset(camera, 1, layout.ground.width) },
      ...atlasDrawing(layout, camera) })];
    const placedActors = withHero ? [['barbarian_player', layout.width * 0.22, 'right']] : [];
    if (enemy) placedActors.push([enemy, layout.width * 0.22 + 80, 'left']);
    for (const [id, x, facing] of placedActors) {
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
      for (const id of newInteriors) {
        const layout = interiorLayout(INTERIOR_LOCATIONS[id], width, height, groundY, heroHeight);
        const image = await renderDelve(layout, 280, interiorImages[id], undefined, InteriorArtwork, true);
        const rgba = pixels(image, width, height);
        for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 255, `${id}/${name}: uncovered pixel`);
        fs.writeFileSync(path.join(output, `${id}-${name}.png`), image.encodeToBytes());
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
    // mirrored strip repeats after two source widths; the prop library repeats
    // after its full spatial period and keeps the same culling at both ends.
    const layout = wetlandsLayout(640, 360, 288, 64);
    for (const [key, period] of [['distant', 1280 / 0.15], ['banks', 1280 / 0.35], ['ground', 512], ['props', layout.scenery.period]]) {
      const selected = { sky: null, distant: null, banks: null, ground: null, props: null, [key]: images[key] };
      const first = await render(layout, 0, selected);
      const repeat = await render(layout, -period, selected);
      assert.deepEqual(pixels(first, 640, 360), pixels(repeat, 640, 360), `${key}: repeat changed the rendered pixels`);
      first.dispose(); repeat.dispose();
    }
    const delveLayout = hollowDelveLayout(640, 360, 288, 64);
    const highestCeilingY = Math.max(delveLayout.ceilingY, ...newInteriors.map(id =>
      interiorLayout(INTERIOR_LOCATIONS[id], 640, 360, 288, 64).ceilingY));
    // The lowest roof pixel is the strictest bound at every travel position.
    // Check visible alpha in every shipped pose, including raised weapons.
    let clearedPoses = 0;
    const playerIds = Object.keys(catalog.entities).filter(id => id === 'barbarian_player' || id.startsWith('knight_'));
    for (const id of [...playerIds, ...delveEnemies]) {
      const entity = catalog.entities[id], geometry = spriteGeometry(entity, 64);
      for (const [action, clip] of Object.entries(entity.actions)) {
        const atlas = decode(`assets/sprites/${id}--${action}.png`);
        const rgba = pixels(atlas, atlas.width(), atlas.height());
        for (const frame of clip.frames) {
          let top = entity.frameSize[1];
          for (let y = 0; y < entity.frameSize[1] && top === entity.frameSize[1]; y++) {
            for (let x = 0; x < entity.frameSize[0]; x++) {
              if (rgba[((frame.y + y) * atlas.width() + frame.x + x) * 4 + 3]) { top = y; break; }
            }
          }
          assert(delveLayout.groundY + geometry.top + top * geometry.scale >= highestCeilingY,
            `${id}/${action}: visible pose touches the lowest ceiling edge`);
          clearedPoses++;
        }
      }
    }
    for (const [keys, period] of [[['slate_path'], 512],
      [['props'], delveLayout.scenery.period],
      ...delveLayout.layers.map(layer => [[layer.image], layer.rect.width * 2 / layer.parallax])]) {
      const selected = Object.fromEntries(Object.keys(delveImages).map(key => [key, keys.includes(key) ? delveImages[key] : null]));
      const origin = delveLayout.width * .22;
      const first = await renderDelve(delveLayout, origin, selected);
      const repeat = await renderDelve(delveLayout, origin + period, selected);
      const moved = await renderDelve(delveLayout, origin + 173, selected);
      assert.deepEqual(pixels(first, 640, 360), pixels(repeat, 640, 360), `${keys}: repeat changed pixels`);
      assert.notDeepEqual(pixels(first, 640, 360), pixels(moved, 640, 360), `${keys}: travel does not move visible art`);
      first.dispose(); repeat.dispose(); moved.dispose();
    }
    let propCrops = 0;
    for (const id of newInteriors) {
      const layout = interiorLayout(INTERIOR_LOCATIONS[id], 640, 360, 288, 64);
      for (const [key, period] of [['ground', 512], ['props', layout.scenery.period],
        ...layout.layers.map(layer => [layer.image, layer.rect.width * 2 / layer.parallax])]) {
        const selected = Object.fromEntries(Object.keys(interiorImages[id]).map(k => [k, k === key ? interiorImages[id][k] : null]));
        const origin = layout.width * .22;
        const first = await renderDelve(layout, origin, selected, undefined, InteriorArtwork);
        const repeated = await renderDelve(layout, origin + period, selected, undefined, InteriorArtwork);
        const moved = await renderDelve(layout, origin + 173, selected, undefined, InteriorArtwork);
        assert.deepEqual(pixels(first, 640, 360), pixels(repeated, 640, 360), `${id}/${key}: mirror repetition changed pixels`);
        assert.notDeepEqual(pixels(first, 640, 360), pixels(moved, 640, 360), `${id}/${key}: travel did not move visible art`);
        first.dispose(); repeated.dispose(); moved.dispose();
      }
    }
    for (const [biome, image] of [['wetlands', images.props], ['hollow_delve', delveImages.props],
      ...newInteriors.map(id => [id, interiorImages[id].props])]) {
      const atlas = require(`../assets/biomes/${biome}/props.json`);
      assert(Object.keys(atlas.props).length >= (newInteriors.includes(biome) ? 8 : 32));
      assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, `assets/biomes/${biome}/props.png`))).digest('hex'), atlas.sha256);
      for (const [key, prop] of Object.entries(atlas.props)) {
        const { width, height } = prop.frame;
        assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, prop.source.image))).digest('hex'), prop.source.sha256);
        assert.equal(prop.anchor[1], height, `${key}: anchor includes transparent bottom padding`);
        const surface = makeOffscreenSurface(width, height);
        const crop = await drawOffscreen(surface, React.createElement(SceneryAtlasArtwork, {
          image, sprites: [prop.frame], transforms: [Skia.RSXform(1, 0, 0, 0)] }));
        const rgba = pixels(crop, width, height);
        assert.equal(createHash('sha256').update(rgba).digest('hex'), prop.pixels_sha256, `${key}: rendered atlas crop differs from prepared pixels`);
        assert(Array.from({ length: width }, (_, x) => rgba[((height-1)*width+x)*4+3]).some(a => a === 255), `${key}: empty bottom row creates a floating prop`);
        assert(Array.from({ length: width }, (_, x) => rgba[x*4+3]).some(a => a === 255), `${key}: untrimmed top edge`);
        crop.dispose(); surface.dispose(); propCrops++; renders++;
      }
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ renderer: 'real Skia / CanvasKit', renders, propCrops, clearedPoses,
      checks: ['30 runtime texture hashes and dimensions; original generated prop source hashes', 'opaque viewport at four sizes, Wetlands, Hollow Delve and all four new interiors',
        '96 exact prop atlas crops with nonempty contact rows', 'production sprites on the shared ground baseline',
        'all player/enemy poses below the lowest roof edge',
        'independent visible interior layer motion; pixel-exact mirrored background/ground and culled atlas repetition'] }, null, 2) + '\n');
    console.log(`Scene rendering passed: ${renders} real-Skia renders. Artifacts: ${output}`);
  } finally { decoded.forEach(image => image.dispose()); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
