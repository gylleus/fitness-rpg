import { Atlas, FilterMode, Group, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';
import type { SpriteFrame } from './types';

/** The actual drawing node, shared by the app and the headless render audit. */
export function SpriteTile({ image, frame, frameSize, scale, flipped = false }: {
  image: SkImage;
  frame: SpriteFrame;
  frameSize: [number, number];
  scale: number;
  flipped?: boolean;
}) {
  return <Group transform={flipped ? [{ translateX: frameSize[0] * scale }, { scaleX: -1 }] : []}>
    <Atlas image={image}
      sprites={[{ x: frame.x, y: frame.y, width: frameSize[0], height: frameSize[1] }]}
      transforms={[Skia.RSXform(scale, 0, 0, 0)]}
      sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }} />
  </Group>;
}
