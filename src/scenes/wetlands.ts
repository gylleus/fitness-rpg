import type { Dungeon } from '../game/combat';
import roster from '../game/rosters/wetlands.json';
import propAtlas from '../../assets/biomes/wetlands/props.json';
import sources from '../../assets/biomes/wetlands/sources.json';
import { sceneryAtlasLayout } from './sceneryAtlas';

/** Recognize Wetlands snapshots saved before biomeId was added, without
 * repainting pre-snapshot Mossfall runs that also used dungeon ID zero. */
export function hasWetlandsScenery(dungeon: Dungeon): boolean {
  if (dungeon.biomeId !== undefined) return dungeon.biomeId === 'wetlands';
  return dungeon.id === 0 && dungeon.enemies.length > 0 &&
    dungeon.enemies.every(enemy => enemy.id !== undefined && Object.hasOwn(roster.enemies, enemy.id));
}

export type SceneRect = { x: number; y: number; width: number; height: number };

export function wetlandsLayout(width: number, height: number, groundY: number, heroHeight: number, seed = 0) {
  const scale = heroHeight / 64;
  const background: SceneRect = { x: 0, y: groundY - 288 * scale, width: 640 * scale, height: 360 * scale };
  // Re-exporting at a different pixel density can move the sampled support row.
  const ground: SceneRect = { x: 0, y: groundY - sources.ground.surface_y * scale,
    width: sources.ground.canvas[0] * scale, height: sources.ground.canvas[1] * scale };
  return {
    width, height, groundY,
    // Lift the distant horizon slightly so it clears the generated reed bank.
    distant: { ...background, y: background.y - 32 * scale },
    banks: background, ground,
    scenery: sceneryAtlasLayout(propAtlas, width, groundY, heroHeight, seed),
  };
}

export type WetlandsLayout = ReturnType<typeof wetlandsLayout>;

/** Keep shader translations bounded to a mirrored pair of tiles. */
export function sceneryOffset(camera: number, parallax: number, tileWidth: number): number {
  'worklet';
  return camera * parallax % (tileWidth * 2);
}
