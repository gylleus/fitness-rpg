import { expect, it } from 'vitest';
import { DUNGEONS, battleDungeon, battleTurn, beginBattle } from '../src/game/combat';
import { fitnessDay, heroStats } from '../src/game/rules';
import catalog from '../assets/sprites/catalog.json';
import type { SpriteCatalog } from '../src/sprites/types';
import { sampleSprite } from '../src/sprites/playback';
import { hollowDelveLayout } from '../src/scenes/hollowDelve';
import { interiorLayerRect } from '../src/scenes/interior';
import { visibleScenery } from '../src/scenes/sceneryAtlas';
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
  'keeps cave surfaces grounded and the tunnel enclosed at %ix%i', (width, height, groundY, heroHeight) => {
    const layout = hollowDelveLayout(width, height, groundY, heroHeight);
    expect(layout.ground.y + sources.slate_path.surface_y / sources.slate_path.canvas[1] * layout.ground.height).toBeCloseTo(groundY);
    for (const prop of layout.scenery.props) {
      expect(prop.y + prop.height).toBeCloseTo(groundY);
    }
    for (const camera of [100, -254, -1560, -10_000_000]) {
      for (const layer of layout.layers) {
        expect(Math.abs(interiorLayerRect(layer, camera).x)).toBeLessThan(layer.rect.width * 2);
      }
      const visible = visibleScenery(layout.scenery, camera);
      expect(visible.keys.length).toBeGreaterThan(0);
      expect(visibleScenery(layout.scenery, camera - layout.scenery.period)).toEqual(visible);
    }
    expect(groundY - layout.ceilingY).toBeCloseTo(heroHeight * 104 / 64);
    expect(layout.layers.map(layer => layer.parallax)).toEqual([.1, .32, .68]);
    for (const source of [sources.depth, sources.wall, sources.roof]) {
      expect(source.size[0] / source.canvas[0]).toBe(1.5);
    }
  });
