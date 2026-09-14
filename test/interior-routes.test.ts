import { expect, it } from 'vitest';
import { battleDungeon, beginBattle } from '../src/game/combat';
import { fitnessDay, heroStats } from '../src/game/rules';
import { INTERIOR_LOCATIONS } from '../src/scenes/interiorLocations';
import { interiorLocationFor, INTERIOR_ROUTES, journeyInterior } from '../src/scenes/interiorRoutes';

const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 3 }, fitnessDay('2026-09-14'));

it.each([
  [1, 'embercrypt', ['lava_caves', 'lava_caves', 'crypts', 'crypts']],
  [2, 'frostbound_keep', ['frost_caves', 'frost_caves', 'fortress', 'fortress']],
] as const)('gives chapter %i authored scenery for new and both older save formats', (id, biomeId, expected) => {
  const battle = beginBattle(id, '2026-09-14', stats);
  expect(battle.dungeon?.biomeId).toBe(biomeId);
  const snapshot = structuredClone(battle.dungeon!);
  delete snapshot.biomeId;
  for (const dungeon of [battle.dungeon!, snapshot, battleDungeon({ ...battle, dungeon: undefined })]) {
    const before = JSON.stringify(dungeon);
    expect(dungeon.enemies.map((_, index) => interiorLocationFor(dungeon, index))).toEqual(expected);
    expect(JSON.stringify(dungeon)).toBe(before);
  }
});

it('keeps the outgoing section during a finishing swing and switches as walking begins', () => {
  const battle = { ...beginBattle(1, '2026-09-14', stats), encounter: 2, defeated: 2, lastAction: 'attack' as const };
  expect(journeyInterior(battle)).toBe('lava_caves');
  expect(journeyInterior({ ...battle, lastAction: 'travel' })).toBe('crypts');
  expect(journeyInterior({ ...battle, phase: 'fighting' })).toBe('crypts');
});

it('does not repaint an explicitly different biome or the legacy Mossfall dungeon', () => {
  const dungeon = beginBattle(1, '2026-09-14', stats).dungeon!;
  expect(interiorLocationFor({ ...dungeon, biomeId: 'another_biome' }, 0)).toBeUndefined();
  expect(interiorLocationFor({ ...dungeon, id: 0, biomeId: undefined }, 0)).toBeUndefined();
  expect(interiorLocationFor({ ...dungeon, id: 3, biomeId: undefined }, 0)).toBe('hollow_delve');
});

it('all configured sections have complete generated layers, floors and prop atlases', () => {
  for (const route of INTERIOR_ROUTES) {
    expect(route.sections[0].fromEncounter).toBe(0);
    expect(route.sections.map(s => s.fromEncounter)).toEqual(route.sections.map(s => s.fromEncounter).sort((a, b) => a - b));
    for (const section of route.sections) {
      const assets = INTERIOR_LOCATIONS[section.location];
      expect(assets.scene.layers.map(l => l.role)).toEqual(['rear', 'rear', 'ceiling']);
      expect(assets.ground.canvas).toEqual([256, 96]);
      expect(assets.ground.surface_y).toBeGreaterThan(0);
      expect(Object.keys(assets.props.props).length).toBeGreaterThanOrEqual(8);
    }
  }
});
