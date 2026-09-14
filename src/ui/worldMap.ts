/** Coordinates are in the illustrated map's 720×900 design space. */
export const MAP_SIZE = { width: 720, height: 900 };
export const MAP_CAMP = { x: 115, y: 810 };
export const MAP_LOCATIONS = [
  { x: 194, y: 610, controls: [125, 760, 200, 710] },
  { x: 554, y: 555, controls: [305, 760, 444, 624] },
  { x: 547, y: 194, controls: [430, 690, 658, 312] },
  { x: 194, y: 242, controls: [75, 560, 125, 362] },
] as const;

/** Every destination is a separate walk from camp. */
export function mapRoutes() {
  return MAP_LOCATIONS.map((location, index) => ({ index,
    path: `M ${MAP_CAMP.x} ${MAP_CAMP.y} C ${location.controls.join(' ')} ${location.x} ${location.y}` }));
}

/** Native touch targets stay legible as the image and route coordinates scale. */
export function mapNodeLayout(width: number, point: { x: number; y: number }) {
  const scale = width / MAP_SIZE.width;
  const labelWidth = Math.min(142, width * 0.44);
  return { left: point.x * scale - labelWidth / 2, top: point.y * scale - 22,
    width: labelWidth, minHeight: 76 };
}
