import { FilterMode, Group, ImageShader, MipmapMode, Rect, type SkImage } from '@shopify/react-native-skia';
import type { ComponentProps, ReactNode } from 'react';
import { interiorLayerRect, type InteriorLayout } from './interior';
import { SceneryAtlasArtwork, type ScenerySprites, type SceneryTransforms } from './SceneryAtlasArtwork';

type ShaderRect = ComponentProps<typeof ImageShader>['rect'];
const sampling = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };

/** The same drawing primitive serves static audits and animated native layers. */
export function InteriorLayerArtwork({ image, rect, width, height }: {
  image: SkImage | null; rect: ShaderRect; width: number; height: number;
}) {
  return image && <Rect x={0} y={0} width={width} height={height}>
    <ImageShader image={image} rect={rect} fit="fill" tx="mirror" ty="clamp" sampling={sampling} />
  </Rect>;
}

export function InteriorArtwork({ images, layout, camera = 0, ground, propSprites, propTransforms, rear, ceiling }: {
  images: Record<string, SkImage | null>; layout: InteriorLayout; camera?: number; ground: ShaderRect;
  propSprites: ScenerySprites; propTransforms: SceneryTransforms; rear?: ReactNode; ceiling?: ReactNode;
}) {
  const layers = (role: 'rear' | 'ceiling') => layout.layers.filter(layer => layer.role === role).map(layer =>
    <InteriorLayerArtwork key={layer.id} image={images[layer.image]} rect={interiorLayerRect(layer, camera)}
      width={layout.width} height={layout.height} />);
  return <Group>
    <Rect x={0} y={0} width={layout.width} height={layout.height} color={layout.fill} />
    {rear ?? layers('rear')}
    <SceneryAtlasArtwork image={images.props} sprites={propSprites} transforms={propTransforms} />
    {ceiling ?? layers('ceiling')}
    <Rect x={0} y={layout.groundY} width={layout.width} height={layout.height - layout.groundY} color={layout.fill} />
    <InteriorLayerArtwork image={images.ground} rect={ground} width={layout.width} height={layout.height} />
  </Group>;
}
