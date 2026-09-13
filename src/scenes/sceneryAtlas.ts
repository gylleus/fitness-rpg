export type SceneryFrame = { x: number; y: number; width: number; height: number };
export type SceneryAtlasData = {
  props: Record<string, { frame: SceneryFrame; anchor: number[]; height_scale: number }>;
};
export type SceneryTransform = { scos: number; ssin: number; tx: number; ty: number };

/** Local visual randomness never reads or advances combat's RNG state. */
function visualHash(seed: number, id: string) {
  let value = (seed | 0) ^ 0x811c9dc5;
  for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  return (value ^ value >>> 16) >>> 0;
}

/** A stable library order is shuffled once per expedition, then spatially culled.
 * Trimmed texture dimensions describe the art; measured anchors describe feet.
 */
export function sceneryAtlasLayout(atlas: SceneryAtlasData, width: number, groundY: number, heroHeight: number, seed = 0) {
  const order = Object.entries(atlas.props).sort(([a], [b]) => visualHash(seed, a) - visualHash(seed, b) || a.localeCompare(b));
  const spacing = 144;
  const period = Math.max(spacing, order.length * spacing);
  const props = order.map(([key, prop], index) => {
    const scale = heroHeight * prop.height_scale / prop.frame.height;
    return { key, frame: prop.frame, scale, width: prop.frame.width * scale,
      x: index * spacing + spacing / 2 - prop.anchor[0] * scale,
      y: groundY - prop.anchor[1] * scale, height: prop.frame.height * scale };
  });
  // Larger structures sit behind small dressing when silhouettes overlap.
  props.sort((a, b) => b.height - a.height || a.x - b.x);
  return { width, groundY, period, props };
}

export type SceneryAtlasLayout = ReturnType<typeof sceneryAtlasLayout>;

/** Plain geometry is shared by the UI worklet and the headless render audit.
 * The drawing boundary turns transforms into native Skia.RSXform instances.
 */
export function visibleScenery(layout: SceneryAtlasLayout, camera: number) {
  'worklet';
  const sprites: SceneryFrame[] = [];
  const transforms: SceneryTransform[] = [];
  const keys: string[] = [];
  const offset = ((camera % layout.period) + layout.period) % layout.period;
  for (const prop of layout.props) {
    const first = Math.ceil((-prop.width - prop.x - offset) / layout.period);
    const last = Math.floor((layout.width - prop.x - offset) / layout.period);
    for (let copy = first; copy <= last; copy++) {
      const x = prop.x + offset + copy * layout.period;
      if (x >= layout.width || x + prop.width <= 0) continue;
      sprites.push(prop.frame);
      transforms.push({ scos: prop.scale, ssin: 0, tx: x, ty: prop.y });
      keys.push(prop.key);
    }
  }
  return { sprites, transforms, keys };
}
