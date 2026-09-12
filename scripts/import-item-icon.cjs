#!/usr/bin/env node
/** Preserve a built-in generation, then export the requested 64px game icon. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const [id, source, ...options] = process.argv.slice(2);
const fitContent = options.includes('--fit-content');
const revisionOptions = options.filter(option => option !== '--fit-content');
if (revisionOptions.length && (revisionOptions.length !== 2 || revisionOptions[0] !== '--replace-with-prompt')) {
  throw new Error('Optional revision: --replace-with-prompt <exact-generation-prompt.txt>');
}
const replacementPrompt = revisionOptions.length ? fs.readFileSync(revisionOptions[1], 'utf8') : null;
if (replacementPrompt !== null && !replacementPrompt.trim()) throw new Error('A revision requires its exact generation prompt.');
const prompts = require('../image-generation/items/v1/prompts.json');
const prompt = prompts.find(entry => entry.id === id);
if (!prompt || !source) throw new Error('Usage: import-item-icon.cjs <catalog-item-id> <generated-source.png>');
const original = path.join(root, 'image-generation/items/v1/sources', `${id}.png`);
const destination = path.join(root, 'assets/items', `${id}.png`);
const metadata = path.join(root, 'image-generation/items/v1/provenance', `${id}.json`);
const files = [original, destination, metadata];
if (replacementPrompt !== null && !files.every(file => fs.existsSync(file))) {
  throw new Error('A revision requires a complete existing source, icon and provenance record.');
}
for (const file of files) {
  if (replacementPrompt === null && fs.existsSync(file)) throw new Error(`Refusing to replace existing image: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
}
let supersedes;
if (replacementPrompt !== null) {
  const previous = JSON.parse(fs.readFileSync(metadata));
  const archive = path.join(root, 'image-generation/items/v1/sources/rejected', `${id}-${previous.icon_sha256.slice(0, 12)}`);
  if (fs.existsSync(archive)) throw new Error(`Revision archive already exists: ${archive}`);
  fs.mkdirSync(archive, { recursive: true });
  for (const [file, name] of [[original, 'source.png'], [destination, 'icon.png'], [metadata, 'provenance.json']]) {
    fs.copyFileSync(file, path.join(archive, name), fs.constants.COPYFILE_EXCL);
  }
  supersedes = { archive: path.relative(root, archive), source_sha256: previous.source_sha256,
    icon_sha256: previous.icon_sha256, reason: 'Replaced after visual and pixel-boundary review' };
}
fs.copyFileSync(source, original);
// Export sizing only: preserve source colors/alpha and use nearest-neighbor
// sampling. No matting, painted backgrounds, palette invention or art edits.
execFileSync('convert', [original, ...(fitContent ? ['-trim', '+repage'] : []), '-filter', 'Point', '-resize', fitContent ? '56x56' : '64x64', '-background', 'none',
  '-gravity', 'center', '-extent', '64x64', `PNG32:${destination}`]);
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(metadata, JSON.stringify({ id, backend: 'built-in imagegen', definition_sha256: prompt.definition_sha256,
  original: path.relative(root, original), source_sha256: hash(original), icon: path.relative(root, destination),
  icon_sha256: hash(destination), target: [64, 64], export: fitContent
    ? 'ImageMagick transparent-border trim and Point fit within 56x56; original alpha; centered 64x64 canvas'
    : 'ImageMagick Point resize with original alpha; centered 64x64 canvas',
  prompt: replacementPrompt ?? prompt.prompt, ...(supersedes ? { supersedes } : {}) }, null, 2) + '\n');
console.log(`Imported ${id}: ${destination}`);
