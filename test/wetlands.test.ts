import { expect, it } from 'vitest';
import { DUNGEONS, battleDungeon, beginBattle } from '../src/game/combat';
import { fitnessDay, heroStats } from '../src/game/rules';
import { hasWetlandsScenery, wetlandsLayout } from '../src/scenes/wetlands';
import { visibleScenery } from '../src/scenes/sceneryAtlas';

it('selects Wetlands for new and older snapshots without changing other saved dungeons', () => {
  expect(hasWetlandsScenery(DUNGEONS[0])).toBe(true);
  expect(hasWetlandsScenery({ ...DUNGEONS[0], biomeId: undefined, name: 'Saved name' })).toBe(true);
  expect(hasWetlandsScenery({ ...DUNGEONS[0], biomeId: 'another-biome' })).toBe(false);
  expect(hasWetlandsScenery(DUNGEONS[1])).toBe(false);
  expect(hasWetlandsScenery(DUNGEONS[2])).toBe(false);
  const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 0 }, fitnessDay('2026-09-11'));
  const battle = beginBattle(0, '2026-09-11', stats);
  expect(battle.dungeon?.biomeId).toBe('wetlands');
  expect(hasWetlandsScenery(battleDungeon({ ...battle, dungeon: undefined }))).toBe(false);
});

it.each([[300, 240, 198, 92], [390, 844, 754, 140], [844, 390, 300, 126.5], [320, 480, 390, 140]])(
  'plants the turf and prop atlas on the character baseline at %ix%i', (width, height, baseline, hero) => {
    const layout = wetlandsLayout(width, height, baseline, hero);
    expect(layout.ground.y + layout.ground.height * 338 / 768).toBeCloseTo(baseline);
    for (const prop of layout.scenery.props) expect(prop.y + prop.height).toBeCloseTo(baseline);
    expect(layout.scenery.props.find(p => p.key === 'wetlands_leaning_willow')?.height).toBeCloseTo(hero * 3.4);
    for (const camera of [26, -254, -1734, -10_000_000]) {
      const visible = visibleScenery(layout.scenery, camera);
      expect(visible.keys.length).toBeGreaterThan(0);
      expect(visibleScenery(layout.scenery, camera - layout.scenery.period)).toEqual(visible);
    }
  });
