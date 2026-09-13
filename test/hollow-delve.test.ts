import { expect, it } from 'vitest';
import { DUNGEONS, battleDungeon, battleTurn, beginBattle } from '../src/game/combat';
import { fitnessDay, heroStats } from '../src/game/rules';
import catalog from '../assets/sprites/catalog.json';
import type { SpriteCatalog } from '../src/sprites/types';
import { sampleSprite } from '../src/sprites/playback';
import { delveBackgroundX, delvePropOffset, delveTransition, hollowDelveLayout } from '../src/scenes/hollowDelve';
import sources from '../assets/biomes/hollow_delve/sources.json';
import roster from '../src/game/rosters/hollow_delve.json';

const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 3 }, fitnessDay('2026-09-13'));
const spriteCatalog = catalog as unknown as SpriteCatalog;

it('adds the complete Hollow Delve expedition after the existing chapters and snapshots it', () => {
  expect(DUNGEONS.map(d => [d.id, d.name])).toEqual([[0, 'Wetlands'], [1, 'Embercrypt'], [2, 'Frostbound Keep'], [3, 'Hollow Delve']]);
  const dungeon = DUNGEONS[3];
  expect(dungeon.enemies.map(e => e.id)).toEqual(['troglodyte', 'giant_cave_spider', 'bone_slime', 'delve_dwarf', 'delve_gnoll']);
  expect(dungeon.enemies).toEqual(Object.values(roster.enemies));
  const battle = beginBattle(3, '2026-09-13', stats);
  expect(battleDungeon(JSON.parse(JSON.stringify(battle)))).toEqual(dungeon);
  expect(battle.dungeon).not.toBe(dungeon);
  expect(battle.dungeon?.enemies[0]).not.toBe(dungeon.enemies[0]);
  expect(battleDungeon({ ...beginBattle(1, '2026-09-13', stats), dungeon: undefined }).name).toBe('Embercrypt');
});

it('can clear all five encounters and pays the complete roster bounty', () => {
  let battle = beginBattle(3, '2026-09-13', { ...stats, health: 10000, baseAttack: 2000, attack: 2000 });
  for (let i = 0; i < 200 && battle.status === 'active'; i++) battle = battleTurn(battle);
  expect(battle.status).toBe('victory');
  expect(battle.defeated).toBe(5);
  expect(battle.gold).toBe(DUNGEONS[3].enemies.reduce((total, e) => total + e.gold, 0));
  expect(battle.xp).toBe(DUNGEONS[3].enemies.reduce((total, e) => total + e.xp, 0));
});

it('resolves every enemy animation and holds death while attack recovers to idle', () => {
  for (const enemy of DUNGEONS[3].enemies) {
    const entity = spriteCatalog.entities[enemy.id!];
    expect(entity).toBeDefined();
    for (const action of ['idle', 'walk', 'attack', 'death']) {
      expect(entity.actions[action].frames).toHaveLength(6);
      expect(entity.actions[action].loop).toBe(action === 'idle' || action === 'walk');
    }
    expect(sampleSprite(entity, 'death', 99999).index).toBe(5);
    expect(sampleSprite(entity, 'attack', 99999).clip).toBe(entity.actions.idle);
  }
});

it.each([[300, 240, 198, 92], [390, 844, 754, 140], [844, 390, 300, 126.5], [320, 480, 390, 140]])(
  'keeps cave surfaces grounded and pans inside painted edges at %ix%i', (width, height, groundY, heroHeight) => {
    const layout = hollowDelveLayout(width, height, groundY, heroHeight);
    expect(layout.ground.y + sources.slate_path.surface_y / sources.slate_path.size[1] * layout.ground.height).toBeCloseTo(groundY);
    for (const prop of layout.props) {
      expect(prop.y + sources[prop.key].bounds[3] / sources[prop.key].size[1] * prop.height).toBeCloseTo(groundY);
    }
    for (const camera of [100, -254, -1560, -10_000_000]) {
      const x = delveBackgroundX(camera, layout.background.width, width);
      expect(x).toBeLessThanOrEqual(0);
      expect(x + layout.background.width).toBeGreaterThanOrEqual(width - 1e-6);
      const offset = delvePropOffset(camera, layout.propPeriod);
      expect(offset).toBeGreaterThanOrEqual(-layout.propPeriod);
      expect(offset + (layout.propCopies - 1) * layout.propPeriod).toBeGreaterThanOrEqual(width);
    }
    expect(delveTransition(0, 500)).toBe(0);
    expect(delveTransition(610, 500)).toBe(0.5);
    expect(delveTransition(1560, 1100)).toBe(1);
  });
