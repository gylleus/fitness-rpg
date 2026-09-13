import { expect, it } from 'vitest';
import { sceneryAtlasLayout, visibleScenery } from '../src/scenes/sceneryAtlas';
import delve from '../assets/biomes/hollow_delve/props.json';
import wetlands from '../assets/biomes/wetlands/props.json';

it.each([delve, wetlands])('covers all $biome_id props while culling distant art', atlas => {
  expect(Object.keys(atlas.props).length).toBeGreaterThanOrEqual(32);
  const layout = sceneryAtlasLayout(atlas, 390, 500, 96, 72);
  const seen = new Set<string>();
  for (let camera = 0; camera > -layout.period; camera -= 60) {
    const visible = visibleScenery(layout, camera);
    visible.keys.forEach(key => seen.add(key));
    expect(visible.keys.length).toBeLessThan(12);
    expect(visible.sprites).toHaveLength(visible.transforms.length);
    visible.transforms.forEach((t, i) => {
      expect(t.tx).toBeLessThan(layout.width);
      expect(t.tx + visible.sprites[i].width * t.scos).toBeGreaterThan(0);
      expect(t.ty + visible.sprites[i].height * t.scos).toBeCloseTo(500);
    });
  }
  expect(seen).toEqual(new Set(Object.keys(atlas.props)));
});

it('uses stable visual variation without changing source data or combat randomness', () => {
  const before = JSON.stringify(delve);
  const first = sceneryAtlasLayout(delve, 390, 500, 96, 47);
  expect(sceneryAtlasLayout(JSON.parse(before), 390, 500, 96, 47)).toEqual(first);
  expect(sceneryAtlasLayout(delve, 390, 500, 96, 48).props.map(p => [p.key, p.x]))
    .not.toEqual(first.props.map(p => [p.key, p.x]));
  expect(JSON.stringify(delve)).toBe(before);
});

it('includes wide structures crossing either viewport edge without duplicating them', () => {
  const atlas = { props: { arch: { frame: { x: 2, y: 2, width: 200, height: 100 }, anchor: [100, 100], height_scale: 1 } } };
  const layout = sceneryAtlasLayout(atlas, 390, 100, 100);
  const visible = visibleScenery(layout, -160);
  expect(visible.transforms.some(t => t.tx < 0)).toBe(true);
  expect(visible.transforms.some(t => t.tx + 200 > 390)).toBe(true);
  expect(new Set(visible.transforms.map(t => t.tx)).size).toBe(visible.transforms.length);
  expect(visibleScenery(layout, -160 - layout.period * 10000)).toEqual(visible);
});
