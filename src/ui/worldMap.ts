/** Coordinates are in the illustrated map's 720×900 design space. */
export const MAP_SIZE = { width: 720, height: 900 };
export const MAP_CAMP = { x: 115, y: 810 };
export const MAP_LOCATIONS = [
  { dungeonId: 0, x: 194, y: 610, controls: [125, 760, 200, 710] },
  { dungeonId: 1, x: 554, y: 555, controls: [305, 672, 444, 624] },
  { dungeonId: 2, x: 547, y: 194, controls: [654, 474, 658, 312] },
  { dungeonId: 3, x: 194, y: 242, controls: [460, 335, 311, 362] },
] as const;

export function mapRoutes(unlockedDungeon: number) {
  return MAP_LOCATIONS.map((location, i) => {
    const previous = i ? MAP_LOCATIONS[i - 1] : MAP_CAMP;
    return { dungeonId: location.dungeonId, unlocked: location.dungeonId <= unlockedDungeon,
      path: `M ${previous.x} ${previous.y} C ${location.controls.join(' ')} ${location.x} ${location.y}` };
  });
}

/** Native touch targets stay legible as the image and route coordinates scale. */
export function mapNodeLayout(width: number, point: { x: number; y: number }) {
  const scale = width / MAP_SIZE.width;
  const labelWidth = Math.min(142, width * 0.44);
  return { left: point.x * scale - labelWidth / 2, top: point.y * scale - 22,
    width: labelWidth, minHeight: 76 };
}
