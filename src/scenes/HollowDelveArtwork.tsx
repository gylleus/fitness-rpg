import { FilterMode, Group, Image, ImageShader, MipmapMode, Rect, type SkImage } from '@shopify/react-native-skia';
import type { ComponentProps } from 'react';
import type { DelveProp, HollowDelveLayout } from './hollowDelve';

export type HollowDelveImages = Record<DelveProp | 'landscape' | 'timber_gallery' | 'sunken_cavern' | 'slate_path', SkImage | null>;
type ShaderRect = ComponentProps<typeof ImageShader>['rect'];
type Transform = ComponentProps<typeof Group>['transform'];
type Opacity = ComponentProps<typeof Group>['opacity'];
const sampling = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };

/** Shared by the native game and the CPU Skia rendering audit. */
export function HollowDelveArtwork({ images, layout, background, ground, props, galleryOpacity, cavernOpacity }: {
  images: HollowDelveImages; layout: HollowDelveLayout; background: ShaderRect; ground: ShaderRect;
  props: Transform; galleryOpacity: Opacity; cavernOpacity: Opacity;
}) {
  return <Group>
    <Rect x={0} y={0} width={layout.width} height={layout.height} color="#181c25" />
    {(['landscape', 'timber_gallery', 'sunken_cavern'] as const).map((key, i) => images[key] &&
      <Group key={key} opacity={i === 0 ? 1 : i === 1 ? galleryOpacity : cavernOpacity}>
        <Rect x={0} y={0} width={layout.width} height={layout.height}>
          <ImageShader image={images[key]} rect={background} fit="fill" tx="clamp" ty="clamp" sampling={sampling} />
        </Rect>
      </Group>)}
    <Group transform={props}>
      {Array.from({ length: layout.propCopies }, (_, i) => layout.props.map(({ key, ...rect }) => images[key] &&
        <Image key={`${key}-${i}`} image={images[key]} {...rect} x={rect.x + i * layout.propPeriod}
          fit="fill" sampling={sampling} />))}
    </Group>
    <Rect x={0} y={layout.groundY} width={layout.width} height={layout.height - layout.groundY} color="#262b35" />
    {images.slate_path && <Rect x={0} y={0} width={layout.width} height={layout.height}>
      <ImageShader image={images.slate_path} rect={ground} fit="fill" tx="mirror" ty="clamp" sampling={sampling} />
    </Rect>}
  </Group>;
}
