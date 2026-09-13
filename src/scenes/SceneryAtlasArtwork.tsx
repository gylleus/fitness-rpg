import { Atlas, FilterMode, MipmapMode, type SkImage } from '@shopify/react-native-skia';
import type { ComponentProps } from 'react';

export type ScenerySprites = ComponentProps<typeof Atlas>['sprites'];
export type SceneryTransforms = ComponentProps<typeof Atlas>['transforms'];

/** One atlas draw and one decoded texture for every visible biome prop. */
export function SceneryAtlasArtwork({ image, sprites, transforms }: {
  image: SkImage | null; sprites: ScenerySprites; transforms: SceneryTransforms;
}) {
  return image ? <Atlas image={image} sprites={sprites} transforms={transforms}
    sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }} /> : null;
}
