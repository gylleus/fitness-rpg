import { expect, it } from 'vitest';
import { DUNGEONS } from '../src/game/combat';
import { MAP_CAMP, MAP_LOCATIONS, MAP_SIZE, mapNodeLayout, mapRoutes } from '../src/ui/worldMap';

it('places every playable dungeon exactly once along one connected route from camp', () => {
  expect(MAP_LOCATIONS.map(p => p.dungeonId)).toEqual(DUNGEONS.map(d => d.id));
  for (let unlocked = 0; unlocked < DUNGEONS.length; unlocked++) {
    const routes = mapRoutes(unlocked);
    expect(routes.filter(r => r.unlocked).map(r => r.dungeonId)).toEqual(DUNGEONS.slice(0, unlocked + 1).map(d => d.id));
    routes.forEach((route, i) => {
      const from = i ? MAP_LOCATIONS[i - 1] : MAP_CAMP;
      const to = MAP_LOCATIONS[i];
      expect(route.path.startsWith(`M ${from.x} ${from.y} C `)).toBe(true);
      expect(route.path.endsWith(` ${to.x} ${to.y}`)).toBe(true);
    });
  }
});

it.each([276, 320, 390, 520])('keeps touch targets aligned to paths and inside a %ipx map', width => {
  const targets = MAP_LOCATIONS.map(point => mapNodeLayout(width, point));
  targets.forEach((target, i) => {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.minHeight).toBeGreaterThanOrEqual(44);
    expect(target.left).toBeGreaterThanOrEqual(0);
    expect(target.top).toBeGreaterThanOrEqual(0);
    expect(target.left + target.width).toBeLessThanOrEqual(width);
    expect(target.top + target.minHeight).toBeLessThanOrEqual(width * MAP_SIZE.height / MAP_SIZE.width);
    expect(target.left + target.width / 2).toBeCloseTo(MAP_LOCATIONS[i].x * width / MAP_SIZE.width);
    expect(target.top + 22).toBeCloseTo(MAP_LOCATIONS[i].y * width / MAP_SIZE.width);
    targets.forEach((other, j) => {
      if (i === j) return;
      expect(target.left + target.width <= other.left || other.left + other.width <= target.left ||
        target.top + target.minHeight <= other.top || other.top + other.minHeight <= target.top).toBe(true);
    });
  });
});
