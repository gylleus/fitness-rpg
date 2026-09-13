import { Canvas, Skia, useImage } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { type Animated, StyleSheet } from 'react-native';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { HollowDelveArtwork } from './HollowDelveArtwork';
import { delveBackgroundX, delveTransition, hollowDelveLayout } from './hollowDelve';
import { sceneryOffset } from './wetlands';
import { visibleScenery } from './sceneryAtlas';

export function HollowDelveBackdrop({ width, height, groundY, heroHeight, position, initialPosition, seed = 0 }: {
  width: number; height: number; groundY: number; heroHeight: number;
  position: Animated.Value; initialPosition: number; seed?: number;
}) {
  const worldPosition = useSharedValue(initialPosition);
  useEffect(() => {
    const listener = position.addListener(({ value }) => { worldPosition.value = value; });
    return () => position.removeListener(listener);
  }, [position, worldPosition]);
  const layout = hollowDelveLayout(width, height, groundY, heroHeight, seed);
  const camera = useDerivedValue(() => width * 0.22 - worldPosition.value);
  const background = useDerivedValue(() => ({ ...layout.background,
    x: delveBackgroundX(camera.value, layout.background.width, width) }));
  const ground = useDerivedValue(() => ({ ...layout.ground, x: sceneryOffset(camera.value, 1, layout.ground.width) }));
  const visible = useDerivedValue(() => visibleScenery(layout.scenery, camera.value));
  const propSprites = useDerivedValue(() => visible.value.sprites);
  const propTransforms = useDerivedValue(() => visible.value.transforms.map(t => Skia.RSXform(t.scos, t.ssin, t.tx, t.ty)));
  const galleryOpacity = useDerivedValue(() => delveTransition(worldPosition.value, 500));
  const cavernOpacity = useDerivedValue(() => delveTransition(worldPosition.value, 1100));
  const landscape = useImage(require('../../assets/biomes/hollow_delve/landscape.png'));
  const timber_gallery = useImage(require('../../assets/biomes/hollow_delve/timber_gallery.png'));
  const sunken_cavern = useImage(require('../../assets/biomes/hollow_delve/sunken_cavern.png'));
  const slate_path = useImage(require('../../assets/biomes/hollow_delve/slate_path.png'));
  const props = useImage(require('../../assets/biomes/hollow_delve/props.png'));
  return <Canvas testID="hollow-delve-scenery" pointerEvents="none" style={StyleSheet.absoluteFill}>
    <HollowDelveArtwork layout={layout} images={{ landscape, timber_gallery, sunken_cavern, slate_path, props }}
      background={background} ground={ground} propSprites={propSprites} propTransforms={propTransforms}
      galleryOpacity={galleryOpacity} cavernOpacity={cavernOpacity} />
  </Canvas>;
}
