import { Canvas, useImage } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { type Animated, StyleSheet } from 'react-native';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { WetlandsArtwork } from './WetlandsArtwork';
import { sceneryOffset, wetlandsLayout, willowOffset } from './wetlands';

/** Subscribe to the existing travel animation; scenery has no separate clock.
 * Shared values update the viewport-sized Skia canvas without React renders. */
export function WetlandsBackdrop({ width, height, groundY, heroHeight, position, initialPosition }: {
  width: number; height: number; groundY: number; heroHeight: number;
  position: Animated.Value; initialPosition: number;
}) {
  const worldPosition = useSharedValue(initialPosition);
  useEffect(() => {
    const listener = position.addListener(({ value }) => { worldPosition.value = value; });
    return () => position.removeListener(listener);
  }, [position, worldPosition]);
  const camera = useDerivedValue(() => width * 0.22 - worldPosition.value);
  const layout = wetlandsLayout(width, height, groundY, heroHeight);
  const distant = useDerivedValue(() => ({ ...layout.distant, x: sceneryOffset(camera.value, 0.15, layout.distant.width) }));
  const banks = useDerivedValue(() => ({ ...layout.banks, x: sceneryOffset(camera.value, 0.35, layout.banks.width) }));
  const ground = useDerivedValue(() => ({ ...layout.ground, x: sceneryOffset(camera.value, 1, layout.ground.width) }));
  const willows = useDerivedValue(() => [{ translateX: willowOffset(camera.value, layout.willowSpacing) }]);
  const sky = useImage(require('../../assets/biomes/wetlands/sky.png'));
  const distantImage = useImage(require('../../assets/biomes/wetlands/distant.png'));
  const banksImage = useImage(require('../../assets/biomes/wetlands/banks.png'));
  const groundImage = useImage(require('../../assets/biomes/wetlands/ground.png'));
  const willow = useImage(require('../../assets/biomes/wetlands/willow.png'));
  return <Canvas testID="wetlands-scenery" pointerEvents="none" style={StyleSheet.absoluteFill}>
    <WetlandsArtwork layout={layout} images={{ sky, distant: distantImage, banks: banksImage, ground: groundImage, willow }}
      distant={distant} banks={banks} ground={ground} willows={willows} />
  </Canvas>;
}
