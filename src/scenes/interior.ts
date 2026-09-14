import { sceneryAtlasLayout } from './sceneryAtlas';

export type InteriorLayer = {
  id: string; image: string; role: 'rear' | 'ceiling'; canvas: number[];
  parallax: number; origin_y: number; cap_y?: number; repeat: 'mirror';
};
export type InteriorScene = {
  schema_version: number; canvas: number[]; reference_height: number;
  ground_y: number; ceiling_clearance: number; fill: string; layers: InteriorLayer[];
};
export type InteriorAssets = {
  scene: InteriorScene;
  ground: { canvas: number[]; surface_y: number };
  props: Parameters<typeof sceneryAtlasLayout>[0];
};

/** Texture resolution never changes world scale or tunnel clearance. */
export function interiorLayout(assets: InteriorAssets, width: number, height: number, groundY: number, heroHeight: number, seed = 0) {
  const { scene } = assets;
  const scale = heroHeight / scene.reference_height;
  const ceilingY = groundY - scene.ceiling_clearance * scale;
  return {
    width, height, groundY, ceilingY, scale, fill: scene.fill,
    layers: scene.layers.map(layer => ({ ...layer,
      rect: { x: 0, y: (layer.role === 'ceiling' ? ceilingY : groundY) - layer.origin_y * scale,
        width: layer.canvas[0] * scale, height: layer.canvas[1] * scale } })),
    ground: { x: 0, y: groundY - assets.ground.surface_y * scale,
      width: assets.ground.canvas[0] * scale, height: assets.ground.canvas[1] * scale },
    scenery: sceneryAtlasLayout(assets.props, width, groundY, heroHeight, seed),
  };
}
export type InteriorLayout = ReturnType<typeof interiorLayout>;

export function interiorLayerRect(layer: InteriorLayout['layers'][number], camera: number) {
  'worklet';
  return { ...layer.rect, x: camera * layer.parallax % (layer.rect.width * 2) };
}
