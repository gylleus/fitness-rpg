export type SpriteFrame = { x: number; y: number; duration: number; sourceFrame: number };
export type SpriteClip = { image: string; loop: boolean; duration: number; frames: SpriteFrame[] };
export type SpriteEntity = {
  name: string;
  facing: 'left' | 'right';
  frameSize: [number, number];
  pivot: [number, number];
  idleHeight: number;
  heightScale: number;
  actions: Record<string, SpriteClip>;
};
export type SpriteCatalog = { schema_version: 1; entities: Record<string, SpriteEntity> };
