/** Validate the committed menu images and their prompt/runtime references. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const manifest = JSON.parse(read('assets/ui/manifest.json'));
const prompts = JSON.parse(read('content/ui/generation-prompts.json')).prompts;
const contract = read('content/ui/UI.toml').toString();
const runtime = read('src/ui/art.ts').toString();
assert.equal(manifest.version, 1);
assert.equal(manifest.method, 'built-in image_gen');
assert.deepEqual(manifest.assets.map(asset => asset.id).sort(), Object.keys(prompts).sort());
let bytes = 0;
for (const asset of manifest.assets) {
  assert.ok(prompts[asset.id]?.length > 100, `${asset.id}: missing generation prompt`);
  assert.ok(contract.includes(`id = "${asset.id}"`), `${asset.id}: missing description`);
  assert.ok(runtime.includes(`../../${asset.path}`), `${asset.id}: not registered for bundling`);
  const png = read(asset.path);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${asset.id}: PNG signature`);
  assert.equal(png.readUInt32BE(16), asset.width, `${asset.id}: width`);
  assert.equal(png.readUInt32BE(20), asset.height, `${asset.id}: height`);
  assert.equal(crypto.createHash('sha256').update(png).digest('hex'), asset.sha256, `${asset.id}: hash`);
  assert.ok(png.length < 3 * 1024 * 1024, `${asset.id}: image exceeds 3 MiB budget`);
  assert.ok(contract.includes(`canvas = [${asset.width}, ${asset.height}]`), `${asset.id}: dimensions differ from contract`);
  bytes += png.length;
}
assert.ok(bytes < 10 * 1024 * 1024, 'Menu art exceeds 10 MiB total budget');
console.log(`Verified ${manifest.assets.length} menu PNGs, prompts, dimensions, hashes and bundle references (${(bytes / 1024 / 1024).toFixed(2)} MiB).`);
