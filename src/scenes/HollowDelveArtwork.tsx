import type { SkImage } from '@shopify/react-native-skia';
import type { ComponentProps } from 'react';
import { InteriorArtwork } from './InteriorArtwork';

export type HollowDelveImages = Record<'props' | 'depth' | 'wall' | 'roof' | 'slate_path', SkImage | null>;

/** Runtime and CPU Skia audits use the same shared interior composition. */
export function HollowDelveArtwork({ images, ...props }: Omit<ComponentProps<typeof InteriorArtwork>, 'images'> & {
  images: HollowDelveImages;
}) {
  return <InteriorArtwork {...props} images={{ ...images, ground: images.slate_path }} />;
}
