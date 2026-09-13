import sources from '../../assets/biomes/hollow_delve/sources.json';
import propAtlas from '../../assets/biomes/hollow_delve/props.json';
import { sceneryAtlasLayout } from './sceneryAtlas';

export const DELVE_PROPS = Object.keys(propAtlas.props);

export function hollowDelveLayout(width: number, height: number, groundY: number, heroHeight: number, seed = 0) {
  const scale = heroHeight / 64;
  const backgroundScale = Math.max(scale, groundY / 288, width / 640);
  return {
    width, height, groundY,
    background: { x: 0, y: groundY - 288 * backgroundScale, width: 640 * backgroundScale, height: 360 * backgroundScale },
    ground: { x: 0, y: groundY - sources.slate_path.surface_y * scale, width: 256 * scale, height: 96 * scale },
    scenery: sceneryAtlasLayout(propAtlas, width, groundY, heroHeight, seed),
  };
}
export type HollowDelveLayout = ReturnType<typeof hollowDelveLayout>;

/** These painted scenes are not tiles. Clamp the slow pan inside their edges. */
export function delveBackgroundX(camera: number, imageWidth: number, viewportWidth: number) {
  'worklet';
  return Math.max(viewportWidth - imageWidth, Math.min(0, camera * 0.18));
}

export function delveTransition(position: number, start: number) {
  'worklet';
  return Math.max(0, Math.min(1, (position - start) / 220));
}
