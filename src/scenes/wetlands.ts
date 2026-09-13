import type { Dungeon } from '../game/combat';
import roster from '../game/rosters/wetlands.json';
import propAtlas from '../../assets/biomes/wetlands/props.json';
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
  // The v1 image's solid turf begins at source row 338 / 768. Align that
  // measured surface, rather than the requested (but unfulfilled) row 24.
  const ground: SceneRect = { x: 0, y: groundY - 42.25 * scale, width: 256 * scale, height: 96 * scale };
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
