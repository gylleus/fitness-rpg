import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { useGame } from '../game/GameProvider';
import { EntitySprite } from './EntitySprite';

export function CampScene() {
  const { foreground } = useGame();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  return <View style={{ height: 172, backgroundColor: '#15231f', borderRadius: 16, overflow: 'hidden' }}>
    {[12, 36, 67, 85].map((x, i) => <View key={x} style={{ position: 'absolute', left: `${x}%`, bottom: 20, height: 80 + i % 2 * 40, width: 12, backgroundColor: '#243a2f' }}>
      <View style={{ position: 'absolute', bottom: 35, left: -23, width: 0, height: 0, borderLeftWidth: 30, borderRightWidth: 30, borderBottomWidth: 90, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#2a4334' }} />
    </View>)}
    <View style={{ position: 'absolute', top: 16, right: 32, width: 24, height: 24, backgroundColor: '#e9d799', borderRadius: 12 }} />
    <View style={{ position: 'absolute', bottom: 0, height: 22, width: '100%', backgroundColor: '#304635' }} />
    <View style={{ position: 'absolute', left: '50%', bottom: 22 }}>
      <EntitySprite entityId="barbarian_player" heroHeight={116} playing={focused && foreground} />
    </View>
  </View>;
}
