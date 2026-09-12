import { FilterMode, Group, Image, ImageShader, MipmapMode, Rect, type SkImage } from '@shopify/react-native-skia';
import type { ComponentProps } from 'react';
import type { WetlandsLayout } from './wetlands';

export type WetlandsImages = Record<'sky' | 'distant' | 'banks' | 'ground' | 'willow', SkImage | null>;
type ShaderRect = ComponentProps<typeof ImageShader>['rect'];
type Transform = ComponentProps<typeof Group>['transform'];
const sampling = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };

/** Production drawing nodes, also rendered by the real-Skia scene audit. */
export function WetlandsArtwork({ images, layout, distant, banks, ground, willows }: {
  images: WetlandsImages; layout: WetlandsLayout;
  distant: ShaderRect; banks: ShaderRect; ground: ShaderRect; willows: Transform;
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
    {images.willow && <Group transform={willows}>
      {Array.from({ length: layout.willowCount }, (_, i) => <Image key={i} image={images.willow}
        {...layout.willow} x={layout.willow.x + i * layout.willowSpacing} fit="fill" sampling={sampling} />)}
    </Group>}
    <Rect x={0} y={layout.groundY} width={width} height={height - layout.groundY} color="#302c29" />
    {images.ground && <Rect x={0} y={0} width={width} height={height}>
      <ImageShader image={images.ground} rect={ground} fit="fill" tx="mirror" ty="clamp" sampling={sampling} />
    </Rect>}
  </Group>;
}
