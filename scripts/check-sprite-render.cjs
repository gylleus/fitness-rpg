#!/usr/bin/env node
/** Render the production SpriteTile through real Skia/CanvasKit, without a device. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const ts = require('typescript');
const { LoadSkiaWeb } = require('@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] ?? '/tmp/frpg-sprite-render-audit');
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

// Compile the production modules. Only the platform entry point changes to
// Skia's official headless implementation; the drawing component stays real.
function loadProduction(file, skia) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    id => id === '@shopify/react-native-skia' ? skia : require(id), module, module.exports);
  return module.exports;
}

async function main() {
  await LoadSkiaWeb();
  const headless = require('@shopify/react-native-skia/lib/commonjs/headless');
  const { Skia } = headless.getSkiaExports();
  const { drawOffscreen, makeOffscreenSurface, Group, Rect, ColorType, AlphaType } = headless;
  const { SpriteTile } = loadProduction('src/sprites/SpriteTile.tsx', { ...headless, Skia });
  const { sampleSprite, spriteGeometry } = loadProduction('src/sprites/playback.ts', { ...headless, Skia });
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/sprites/catalog.json')));
  fs.mkdirSync(output, { recursive: true });
  const report = { renderer: 'React Native Skia 2.6.2 / CanvasKit CPU',
    source: Object.fromEntries(['src/sprites/SpriteTile.tsx', 'src/sprites/playback.ts', 'src/ui/EntitySprite.tsx', 'assets/sprites/catalog.json'].map(file => [file, hash(file)])),
    checks: [], frames: 0, scaledMirroredSamples: 0 };

  const read = (image, x, y, width, height) => {
    const pixels = image.readPixels(x, y, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    assert(pixels instanceof Uint8Array, 'Skia must return decoded RGBA bytes');
    return pixels;
  };
  async function render(image, frame, entity, scale, flipped) {
    const surface = makeOffscreenSurface(entity.frameSize[0] * scale, entity.frameSize[1] * scale);
    try {
      return await drawOffscreen(surface, React.createElement(SpriteTile, { image, frame, frameSize: entity.frameSize, scale, flipped }));
    } finally { surface.dispose(); }
  }

  for (const [id, entity] of Object.entries(catalog.entities)) {
    const images = {};
    try {
      for (const [action, clip] of Object.entries(entity.actions)) {
        const file = `assets/sprites/${id}--${action}.png`;
        const data = Skia.Data.fromBytes(new Uint8Array(fs.readFileSync(path.join(root, file))));
        const image = Skia.Image.MakeImageFromEncoded(data);
        data.dispose();
        assert(image, `Decode failed: ${file}`);
        images[clip.image] = image;
        const [width, height] = entity.frameSize;
        const samples = new Set([0, Math.floor(clip.frames.length / 2), clip.frames.length - 1]);
        for (const [index, frame] of clip.frames.entries()) {
          const expected = read(image, frame.x, frame.y, width, height);
          const native = await render(image, frame, entity, 1, false);
          try {
            assert.deepEqual(read(native, 0, 0, width, height), expected, `${id}/${action}/${index}: atlas crop changed pixels`);
          } finally { native.dispose(); }
          report.frames++;
          if (!samples.has(index)) continue;
          for (const flipped of [false, true]) {
            const scaled = await render(image, frame, entity, 2, flipped);
            try {
              const actual = read(scaled, 0, 0, width * 2, height * 2);
              const doubled = new Uint8Array(actual.length);
              for (let y = 0; y < height * 2; y++) {
                for (let x = 0; x < width * 2; x++) {
                  const sourceX = flipped ? width - 1 - Math.floor(x / 2) : Math.floor(x / 2);
                  const from = (Math.floor(y / 2) * width + sourceX) * 4;
                  doubled.set(expected.subarray(from, from + 4), (y * width * 2 + x) * 4);
                }
              }
              assert.deepEqual(actual, doubled, `${id}/${action}/${index}: nearest scaling or mirroring changed pixels`);
            } finally { scaled.dispose(); }
            report.scaledMirroredSamples++;
          }
        }
        report.checks.push({ entity: id, action, frames: clip.frames.length, image_sha256: hash(file), result: 'pixel exact' });
      }
      // Actual Skia contact strips at the game's relative sizing. Columns are
      // idle, walk, mid-smash, and settled death, with a shared ground line.
      const geometry = spriteGeometry(entity, 110);
      const poses = [['idle', 0], ['walk', 350], ['attack', 360, 720], ['death', 1000, 800]];
      const surface = makeOffscreenSurface(1024, 220);
      const nodes = [React.createElement(Rect, { key: 'background', x: 0, y: 0, width: 1024, height: 220, color: '#111e22' }),
        React.createElement(Rect, { key: 'ground', x: 0, y: 180, width: 1024, height: 40, color: '#304635' })];
      for (const [index, [action, elapsed, duration]] of poses.entries()) {
        const pose = sampleSprite(entity, action, elapsed, duration);
        nodes.push(React.createElement(Group, { key: action,
          transform: [{ translateX: index * 256 + 128 + geometry.left }, { translateY: 180 + geometry.top }] },
        React.createElement(SpriteTile, { image: images[pose.clip.image], frame: pose.frame, frameSize: entity.frameSize, scale: geometry.scale })));
      }
      const strip = await drawOffscreen(surface, React.createElement(Group, null, ...nodes));
      fs.writeFileSync(path.join(output, `${id}.png`), strip.encodeToBytes());
      strip.dispose(); surface.dispose();
    } finally { Object.values(images).forEach(image => image.dispose()); }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Real Skia rendering passed: ${report.frames} exact atlas crops and ${report.scaledMirroredSamples} scaled/mirrored samples. Artifacts: ${output}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
