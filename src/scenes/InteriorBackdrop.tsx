import { Canvas, Skia, useImage } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { type Animated, StyleSheet } from 'react-native';
import { type SharedValue, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { InteriorArtwork, InteriorLayerArtwork } from './InteriorArtwork';
import { interiorLayerRect, interiorLayout, type InteriorAssets, type InteriorLayout } from './interior';
import { sceneryOffset } from './wetlands';
import { visibleScenery } from './sceneryAtlas';

type ImageSource = Parameters<typeof useImage>[0];
export type InteriorBackdropProps = {
  width: number; height: number; groundY: number; heroHeight: number;
  position: Animated.Value; initialPosition: number; seed?: number;
};

function MovingLayer({ layer, source, camera, width, height }: {
  layer: InteriorLayout['layers'][number]; source: ImageSource; camera: SharedValue<number>; width: number; height: number;
}) {
  const image = useImage(source);
  const rect = useDerivedValue(() => interiorLayerRect(layer, camera.value));
  return <InteriorLayerArtwork image={image} rect={rect} width={width} height={height} />;
}

/** Every interior follows the existing travel clock; arbitrary layer counts are data. */
export function InteriorBackdrop({ assets, textures, testID = 'interior-scenery', width, height, groundY, heroHeight,
  position, initialPosition, seed = 0 }: InteriorBackdropProps & {
  assets: InteriorAssets; textures: Record<string, ImageSource>; testID?: string;
}) {
  const worldPosition = useSharedValue(initialPosition);
  useEffect(() => {
    const listener = position.addListener(({ value }) => { worldPosition.value = value; });
    return () => position.removeListener(listener);
  }, [position, worldPosition]);
  const layout = interiorLayout(assets, width, height, groundY, heroHeight, seed);
  const camera = useDerivedValue(() => width * 0.22 - worldPosition.value);
  const ground = useDerivedValue(() => ({ ...layout.ground, x: sceneryOffset(camera.value, 1, layout.ground.width) }));
  const visible = useDerivedValue(() => visibleScenery(layout.scenery, camera.value));
  const propSprites = useDerivedValue(() => visible.value.sprites);
  const propTransforms = useDerivedValue(() => visible.value.transforms.map(t => Skia.RSXform(t.scos, t.ssin, t.tx, t.ty)));
  const propsImage = useImage(textures.props);
  const groundImage = useImage(textures.ground);
  const layers = (role: 'rear' | 'ceiling') => layout.layers.filter(layer => layer.role === role).map(layer =>
    <MovingLayer key={layer.id} layer={layer} source={textures[layer.image]} camera={camera} width={width} height={height} />);
  return <Canvas testID={testID} pointerEvents="none" style={StyleSheet.absoluteFill}>
    <InteriorArtwork layout={layout} images={{ props: propsImage, ground: groundImage }} ground={ground}
      propSprites={propSprites} propTransforms={propTransforms} rear={layers('rear')} ceiling={layers('ceiling')} />
  </Canvas>;
}
