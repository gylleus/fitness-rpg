import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useGame } from '../game/GameProvider';
import { equippedWeaponType } from '../game/equipment';
import { playerSpriteId } from '../sprites/player';
import { EntitySprite } from './EntitySprite';
import { menuArt } from './art';
import { colors, ui } from './theme';
import { PanelFrame } from './PanelFrame';

export function CampScene() {
  const { data, foreground } = useGame();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  return <View style={{ aspectRatio: 1.65, maxHeight: 350, backgroundColor: colors.bg, borderRadius: 3, overflow: 'hidden' }}>
    <Image source={menuArt.camp} resizeMode="cover" accessible={false} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />
    <View style={{ position: 'absolute', top: 14, left: 14, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: '#151620dd', borderWidth: 1, borderColor: '#565044' }}>
      <Text style={[ui.label, { color: colors.gold, fontSize: 9 }]}>The Wayfarer&apos;s Rest</Text>
    </View>
    <View style={{ position: 'absolute', left: '50%', bottom: '15%' }}>
      <EntitySprite entityId={playerSpriteId(equippedWeaponType(data.inventory))} heroHeight={100} playing={focused && foreground} />
    </View>
    <PanelFrame />
  </View>;
}
