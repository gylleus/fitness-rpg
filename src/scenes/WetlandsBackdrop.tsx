import { Canvas, Skia, useImage } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { type Animated, StyleSheet } from 'react-native';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { WetlandsArtwork } from './WetlandsArtwork';
import { sceneryOffset, wetlandsLayout } from './wetlands';
import { visibleScenery } from './sceneryAtlas';

/** Subscribe to the existing travel animation; scenery has no separate clock.
 * Shared values update the viewport-sized Skia canvas without React renders. */
export function WetlandsBackdrop({ width, height, groundY, heroHeight, position, initialPosition, seed = 0 }: {
  width: number; height: number; groundY: number; heroHeight: number;
  position: Animated.Value; initialPosition: number; seed?: number;
}) {
  const worldPosition = useSharedValue(initialPosition);
  useEffect(() => {
    const listener = position.addListener(({ value }) => { worldPosition.value = value; });
    return () => position.removeListener(listener);
  }, [position, worldPosition]);
  const camera = useDerivedValue(() => width * 0.22 - worldPosition.value);
  const layout = wetlandsLayout(width, height, groundY, heroHeight, seed);
  const distant = useDerivedValue(() => ({ ...layout.distant, x: sceneryOffset(camera.value, 0.15, layout.distant.width) }));
  const banks = useDerivedValue(() => ({ ...layout.banks, x: sceneryOffset(camera.value, 0.35, layout.banks.width) }));
  const ground = useDerivedValue(() => ({ ...layout.ground, x: sceneryOffset(camera.value, 1, layout.ground.width) }));
  const visible = useDerivedValue(() => visibleScenery(layout.scenery, camera.value));
  const propSprites = useDerivedValue(() => visible.value.sprites);
  const propTransforms = useDerivedValue(() => visible.value.transforms.map(t => Skia.RSXform(t.scos, t.ssin, t.tx, t.ty)));
  const sky = useImage(require('../../assets/biomes/wetlands/sky.png'));
  const distantImage = useImage(require('../../assets/biomes/wetlands/distant.png'));
  const banksImage = useImage(require('../../assets/biomes/wetlands/banks.png'));
  const groundImage = useImage(require('../../assets/biomes/wetlands/ground.png'));
  const props = useImage(require('../../assets/biomes/wetlands/props.png'));
  return <Canvas testID="wetlands-scenery" pointerEvents="none" style={StyleSheet.absoluteFill}>
    <WetlandsArtwork layout={layout} images={{ sky, distant: distantImage, banks: banksImage, ground: groundImage, props }}
      distant={distant} banks={banks} ground={ground} propSprites={propSprites} propTransforms={propTransforms} />
  </Canvas>;
}
