import lavaScene from '../../assets/biomes/lava_caves/interior.json';
import lavaSources from '../../assets/biomes/lava_caves/sources.json';
import lavaProps from '../../assets/biomes/lava_caves/props.json';
import frostScene from '../../assets/biomes/frost_caves/interior.json';
import frostSources from '../../assets/biomes/frost_caves/sources.json';
import frostProps from '../../assets/biomes/frost_caves/props.json';
import cryptScene from '../../assets/biomes/crypts/interior.json';
import cryptSources from '../../assets/biomes/crypts/sources.json';
import cryptProps from '../../assets/biomes/crypts/props.json';
import fortressScene from '../../assets/biomes/fortress/interior.json';
import fortressSources from '../../assets/biomes/fortress/sources.json';
import fortressProps from '../../assets/biomes/fortress/props.json';
import { HOLLOW_DELVE_ASSETS } from './hollowDelve';
import type { InteriorAssets, InteriorScene } from './interior';

function location(scene: unknown, sources: { ground: { canvas: number[]; surface_y: number } }, props: InteriorAssets['props']): InteriorAssets {
  return { scene: scene as InteriorScene, ground: sources.ground, props };
}

/** Generated geometry and measured prop/floor anchors are the runtime source of truth. */
export const INTERIOR_LOCATIONS = {
  hollow_delve: HOLLOW_DELVE_ASSETS,
  lava_caves: location(lavaScene, lavaSources, lavaProps),
  frost_caves: location(frostScene, frostSources, frostProps),
  crypts: location(cryptScene, cryptSources, cryptProps),
  fortress: location(fortressScene, fortressSources, fortressProps),
} satisfies Record<string, InteriorAssets>;

export type InteriorLocationId = keyof typeof INTERIOR_LOCATIONS;
