import { Canvas, FilterMode, Image, MipmapMode, useImage } from '@shopify/react-native-skia';
import { View } from 'react-native';
import type { GearItem } from '../game/equipment';
import { itemImages } from '../items/generated';
import { colors } from './theme';

export const rarityColor = { common: colors.text, uncommon: colors.green, rare: '#91c9ff', epic: colors.purple };
const fallback = { weapon: 'wooden_club', armor: 'travel_wraps', helmet: 'iron_helmet', gloves: 'leather_gloves', ring: 'copper_ring', amulet: 'restraint_amulet' };

export function ItemIcon({ item, size = 64 }: { item: GearItem; size?: number }) {
  const source = itemImages[item.definitionId] ?? itemImages[fallback[item.kind]];
  const image = useImage(source ?? null);
  return <View accessibilityRole="image" accessibilityLabel={`${item.name} icon`}
    style={{ width: size, height: size, borderRadius: 10, backgroundColor: '#101a16', borderWidth: 1, borderColor: rarityColor[item.rarity], overflow: 'hidden' }}>
    <Canvas testID="item-icon" pointerEvents="none" style={{ width: size, height: size }}>
      {image && <Image image={image} x={0} y={0} width={size} height={size} fit="contain"
        sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }} />}
    </Canvas>
  </View>;
}
