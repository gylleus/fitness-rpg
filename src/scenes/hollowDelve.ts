import sources from '../../assets/biomes/hollow_delve/sources.json';
import propAtlas from '../../assets/biomes/hollow_delve/props.json';
import scene from '../../assets/biomes/hollow_delve/interior.json';
import { interiorLayout, type InteriorAssets, type InteriorScene } from './interior';

export const DELVE_PROPS = Object.keys(propAtlas.props);
export const HOLLOW_DELVE_ASSETS: InteriorAssets = {
  scene: scene as InteriorScene,
  ground: { canvas: [256, 96], surface_y: sources.slate_path.surface_y },
  props: propAtlas,
};

export function hollowDelveLayout(width: number, height: number, groundY: number, heroHeight: number, seed = 0) {
  return interiorLayout(HOLLOW_DELVE_ASSETS, width, height, groundY, heroHeight, seed);
}
export type HollowDelveLayout = ReturnType<typeof hollowDelveLayout>;
