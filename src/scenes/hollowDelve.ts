import sources from '../../assets/biomes/hollow_delve/sources.json';

export const DELVE_PROPS = ['mine_support', 'webbed_arch', 'ore_cart', 'quartz_cluster',
  'fungus_stump', 'bone_heap', 'stalagmites', 'tool_cache'] as const;
export type DelveProp = typeof DELVE_PROPS[number];
const placements: Record<DelveProp, number> = {
  mine_support: 210, webbed_arch: 1080, ore_cart: 460, quartz_cluster: 650,
  fungus_stump: 50, bone_heap: 850, stalagmites: 1380, tool_cache: 1550,
};

export function hollowDelveLayout(width: number, height: number, groundY: number, heroHeight: number) {
  const scale = heroHeight / 64;
  const backgroundScale = Math.max(scale, groundY / 288, width / 640);
  const propPeriod = 1920;
  return {
    width, height, groundY,
    background: { x: 0, y: groundY - 288 * backgroundScale, width: 640 * backgroundScale, height: 360 * backgroundScale },
    ground: { x: 0, y: groundY - sources.slate_path.surface_y * scale, width: 256 * scale, height: 96 * scale },
    propPeriod, propCopies: Math.ceil(width / propPeriod) + 2,
    props: DELVE_PROPS.map(key => {
      const source = sources[key];
      const [x0, y0, x1, y1] = source.bounds;
      const propScale = heroHeight * source.height_scale / (y1 - y0);
      return { key, x: placements[key] - (x0 + x1) / 2 * propScale, y: groundY - y1 * propScale,
        width: source.size[0] * propScale, height: source.size[1] * propScale };
    }),
  };
}
export type HollowDelveLayout = ReturnType<typeof hollowDelveLayout>;

/** These painted scenes are not tiles. Clamp the slow pan inside their edges. */
export function delveBackgroundX(camera: number, imageWidth: number, viewportWidth: number) {
  'worklet';
  return Math.max(viewportWidth - imageWidth, Math.min(0, camera * 0.18));
}

export function delvePropOffset(camera: number, period: number) {
  'worklet';
  return (camera % period + period) % period - period;
}

export function delveTransition(position: number, start: number) {
  'worklet';
  return Math.max(0, Math.min(1, (position - start) / 220));
}
