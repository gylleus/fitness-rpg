import { expect, it } from 'vitest';
import { interiorLayerRect, interiorLayout, type InteriorAssets } from '../src/scenes/interior';

const assets: InteriorAssets = {
  scene: { schema_version: 1, canvas: [640, 360], reference_height: 64, ground_y: 288,
    ceiling_clearance: 104, fill: '#171e25', layers: [
      { id: 'depth', image: 'depth', role: 'rear', canvas: [640, 360], parallax: .1, origin_y: 288, repeat: 'mirror' },
      { id: 'wall', image: 'wall', role: 'rear', canvas: [640, 360], parallax: .32, origin_y: 288, repeat: 'mirror' },
      { id: 'roof', image: 'roof', role: 'ceiling', canvas: [640, 240], parallax: .68, origin_y: 160, repeat: 'mirror' },
    ] },
  ground: { canvas: [256, 96], surface_y: 36 },
  props: { props: { stone: { frame: { x: 0, y: 0, width: 32, height: 32 }, anchor: [16, 32], height_scale: .5 } } },
};

it.each([[300, 240, 198, 92], [390, 844, 754, 140], [844, 390, 300, 126.5], [320, 480, 390, 140]])(
  'keeps the roof near actors and the floor at contact in a %ix%i viewport', (width, height, groundY, heroHeight) => {
    const layout = interiorLayout(assets, width, height, groundY, heroHeight);
    const roof = layout.layers[2];
    expect(groundY - layout.ceilingY).toBeCloseTo(heroHeight * 104 / 64);
    expect(roof.rect.y + roof.origin_y * layout.scale).toBeCloseTo(layout.ceilingY);
    expect(layout.ground.y + 36 * layout.scale).toBeCloseTo(groundY);
    expect(layout.ceilingY).toBeLessThan(groundY - heroHeight * 1.4);
  });

it('moves depth, wall and roof independently and never exhausts their travel range', () => {
  const layout = interiorLayout(assets, 640, 360, 288, 64);
  expect(layout.layers.map(layer => interiorLayerRect(layer, -100).x)).toEqual([-10, -32, -68]);
  for (const layer of layout.layers) {
    const first = interiorLayerRect(layer, -123);
    const repeated = interiorLayerRect(layer, -123 - layer.rect.width * 2 / layer.parallax);
    expect(first.x).toBeCloseTo(repeated.x);
    const late = interiorLayerRect(layer, -10_000_000);
    expect(Math.abs(late.x)).toBeLessThan(layer.rect.width * 2);
    expect(late.y).toBe(first.y);
  }
});

it('supports additional data-defined layers and per-location ceiling heights', () => {
  const castle = structuredClone(assets);
  castle.scene.ceiling_clearance = 132;
  castle.scene.layers.splice(1, 0, { ...castle.scene.layers[0], id: 'arches', image: 'arches', parallax: .22 });
  const layout = interiorLayout(castle, 640, 360, 288, 64, 123);
  expect(layout.layers).toHaveLength(4);
  expect(layout.ceilingY).toBe(156);
  expect(interiorLayout(castle, 640, 360, 288, 64, 123)).toEqual(layout);
});
