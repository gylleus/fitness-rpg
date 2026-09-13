import { Canvas, useImage } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { type Animated, StyleSheet } from 'react-native';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { HollowDelveArtwork } from './HollowDelveArtwork';
import { delveBackgroundX, delvePropOffset, delveTransition, hollowDelveLayout } from './hollowDelve';
import { sceneryOffset } from './wetlands';

export function HollowDelveBackdrop({ width, height, groundY, heroHeight, position, initialPosition }: {
  width: number; height: number; groundY: number; heroHeight: number;
  position: Animated.Value; initialPosition: number;
}) {
  const worldPosition = useSharedValue(initialPosition);
  useEffect(() => {
    const listener = position.addListener(({ value }) => { worldPosition.value = value; });
    return () => position.removeListener(listener);
  }, [position, worldPosition]);
  const layout = hollowDelveLayout(width, height, groundY, heroHeight);
  const camera = useDerivedValue(() => width * 0.22 - worldPosition.value);
  const background = useDerivedValue(() => ({ ...layout.background,
    x: delveBackgroundX(camera.value, layout.background.width, width) }));
  const ground = useDerivedValue(() => ({ ...layout.ground, x: sceneryOffset(camera.value, 1, layout.ground.width) }));
  const props = useDerivedValue(() => [{ translateX: delvePropOffset(camera.value, layout.propPeriod) }]);
  const galleryOpacity = useDerivedValue(() => delveTransition(worldPosition.value, 500));
  const cavernOpacity = useDerivedValue(() => delveTransition(worldPosition.value, 1100));
  const landscape = useImage(require('../../assets/biomes/hollow_delve/landscape.png'));
  const timber_gallery = useImage(require('../../assets/biomes/hollow_delve/timber_gallery.png'));
  const sunken_cavern = useImage(require('../../assets/biomes/hollow_delve/sunken_cavern.png'));
  const slate_path = useImage(require('../../assets/biomes/hollow_delve/slate_path.png'));
  const mine_support = useImage(require('../../assets/biomes/hollow_delve/mine_support.png'));
  const webbed_arch = useImage(require('../../assets/biomes/hollow_delve/webbed_arch.png'));
  const ore_cart = useImage(require('../../assets/biomes/hollow_delve/ore_cart.png'));
  const quartz_cluster = useImage(require('../../assets/biomes/hollow_delve/quartz_cluster.png'));
  const fungus_stump = useImage(require('../../assets/biomes/hollow_delve/fungus_stump.png'));
  const bone_heap = useImage(require('../../assets/biomes/hollow_delve/bone_heap.png'));
  const stalagmites = useImage(require('../../assets/biomes/hollow_delve/stalagmites.png'));
  const tool_cache = useImage(require('../../assets/biomes/hollow_delve/tool_cache.png'));
  return <Canvas testID="hollow-delve-scenery" pointerEvents="none" style={StyleSheet.absoluteFill}>
    <HollowDelveArtwork layout={layout} images={{ landscape, timber_gallery, sunken_cavern, slate_path,
      mine_support, webbed_arch, ore_cart, quartz_cluster, fungus_stump, bone_heap, stalagmites, tool_cache }}
      background={background} ground={ground} props={props} galleryOpacity={galleryOpacity} cavernOpacity={cavernOpacity} />
  </Canvas>;
}
