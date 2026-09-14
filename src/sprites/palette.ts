import palette from '../../assets/palette.json';

const rgb = (hex: string) => [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
const swatches = palette.colors.map(hex => ({ hex, rgb: rgb(hex) }));

/** Resolve code-drawn sprite colours and arbitrary theme tints to the game palette.
 * Raster exports use the offline perceptual mapper; native tint selection needs
 * only a small RGB lookup and always returns an exact master-palette colour.
 */
export function spriteColor(intent: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(intent)) throw new Error('Sprite colour intent must be #RRGGBB');
  const target = rgb(intent);
  let best = swatches[0], distance = Infinity;
  for (const swatch of swatches) {
    const candidate = swatch.rgb.reduce((sum, channel, index) => sum + (channel - target[index]) ** 2, 0);
    if (candidate < distance) { best = swatch; distance = candidate; }
  }
  return best.hex;
}
