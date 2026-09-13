import { FilterMode, Group, Image, ImageShader, MipmapMode, Rect, type SkImage } from '@shopify/react-native-skia';
import type { ComponentProps } from 'react';
import type { WetlandsLayout } from './wetlands';
import { SceneryAtlasArtwork, type ScenerySprites, type SceneryTransforms } from './SceneryAtlasArtwork';

export type WetlandsImages = Record<'sky' | 'distant' | 'banks' | 'ground' | 'props', SkImage | null>;
type ShaderRect = ComponentProps<typeof ImageShader>['rect'];
const sampling = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };

/** Production drawing nodes, also rendered by the real-Skia scene audit. */
export function WetlandsArtwork({ images, layout, distant, banks, ground, propSprites, propTransforms }: {
  images: WetlandsImages; layout: WetlandsLayout;
  distant: ShaderRect; banks: ShaderRect; ground: ShaderRect;
  propSprites: ScenerySprites; propTransforms: SceneryTransforms;
}) {
  const { width, height } = layout;
  return <Group>
    <Rect x={0} y={0} width={width} height={height} color="#748786" />
    {images.sky && <Image image={images.sky} x={0} y={0} width={width} height={height} fit="cover" sampling={sampling} />}
    {images.distant && <Rect x={0} y={0} width={width} height={height}>
      <ImageShader image={images.distant} rect={distant} fit="fill" tx="mirror" ty="clamp" sampling={sampling} />
    </Rect>}
    {images.banks && <Rect x={0} y={0} width={width} height={height}>
      <ImageShader image={images.banks} rect={banks} fit="fill" tx="mirror" ty="clamp" sampling={sampling} />
    </Rect>}
    <SceneryAtlasArtwork image={images.props} sprites={propSprites} transforms={propTransforms} />
    <Rect x={0} y={layout.groundY} width={width} height={height - layout.groundY} color="#302c29" />
    {images.ground && <Rect x={0} y={0} width={width} height={height}>
      <ImageShader image={images.ground} rect={ground} fit="fill" tx="mirror" ty="clamp" sampling={sampling} />
    </Rect>}
  </Group>;
}
