import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import type { DungeonOffer } from '../game/combat';
import { MAP_CAMP, MAP_LOCATIONS, MAP_SIZE, mapNodeLayout, mapRoutes } from './worldMap';
import { colors } from './theme';

export const difficultyLabel = (difficulty: string) => difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

export function DungeonMap({ offers, selectedId, onSelect, availableSteps, activeOfferId }: {
  offers: readonly DungeonOffer[]; selectedId: string; onSelect: (id: string) => void;
  availableSteps: number; activeOfferId?: string;
}) {
  const [width, setWidth] = useState(320);
  return <View style={styles.container}>
    <View testID="dungeon-map" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.map}>
      <Image source={require('../../assets/maps/world-map.png')} style={StyleSheet.absoluteFill} resizeMode="stretch" accessible={false} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#10191818' }]} />
      <Svg pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox={`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`}>
        {mapRoutes().slice(0, offers.length).map(route => {
          const offer = offers[route.index];
          const affordable = offer.stepCost <= availableSteps;
          return <G key={offer.offerId}>
            <Path d={route.path} stroke="#101918" strokeOpacity={0.7} strokeWidth={10} fill="none" strokeLinecap="round" />
            <Path testID={`map-route-${offer.offerId}`} d={route.path} stroke={affordable ? colors.gold : '#abb4a5'}
              strokeWidth={affordable ? 4 : 3} strokeDasharray={affordable ? undefined : '5 12'}
              strokeOpacity={affordable ? 1 : 0.65} fill="none" strokeLinecap="round" />
          </G>;
        })}
        <Circle cx={MAP_CAMP.x} cy={MAP_CAMP.y} r={10} fill={colors.gold} stroke={colors.bg} strokeWidth={4} />
      </Svg>
      <View pointerEvents="none" style={styles.mapHeading}><Text style={styles.eyebrow}>PATHS FROM CAMP</Text></View>
      <Text pointerEvents="none" style={[styles.camp, { left: width * MAP_CAMP.x / MAP_SIZE.width - 28,
        top: width * MAP_CAMP.y / MAP_SIZE.width + 9 }]}>Camp</Text>
      {offers.map((dungeon, index) => {
        const affordable = dungeon.stepCost <= availableSteps;
        const selected = dungeon.offerId === selectedId;
        const active = dungeon.offerId === activeOfferId;
        const status = active ? 'In progress' : selected ? 'Selected' : affordable ? 'Available' : 'More steps needed';
        const cost = dungeon.stepCost === 0 ? 'Free' : `${dungeon.stepCost.toLocaleString()} steps`;
        return <Pressable key={dungeon.offerId} testID={`map-location-${dungeon.offerId}`} accessibilityRole="button"
          accessibilityLabel={`Select ${dungeon.name}, ${difficultyLabel(dungeon.difficulty)}, level ${dungeon.level}, ${cost.toLowerCase()}, ${status.toLowerCase()}`}
          accessibilityState={{ selected }} accessibilityHint="Shows dungeon details and the entry button."
          onPress={() => onSelect(dungeon.offerId)}
          style={({ pressed }) => [styles.location, mapNodeLayout(width, MAP_LOCATIONS[index]), { opacity: pressed ? 0.75 : 1 }]}>
          <View style={[styles.marker, { borderColor: selected ? colors.gold : active ? colors.green : dungeon.color,
            backgroundColor: selected ? '#373423' : colors.bg, borderWidth: selected ? 3 : 2 }]}>
            <Text style={[styles.number, { color: active ? colors.green : selected ? colors.gold : colors.text }]}>{dungeon.level}</Text>
          </View>
          <View style={[styles.label, selected && { borderColor: colors.gold }]}>
            <Text style={styles.name}>{dungeon.name}</Text>
            <Text style={[styles.status, { color: selected ? colors.gold : colors.text }]}>{difficultyLabel(dungeon.difficulty)} · {cost}</Text>
            <Text style={[styles.status, { color: active ? colors.green : colors.muted }]}>{status}</Text>
          </View>
        </Pressable>;
      })}
    </View>
    <View style={styles.legend}>
      <Text style={styles.legendText}><Text style={{ color: colors.gold }}>━</Text> Within reach</Text>
      <Text style={styles.legendText}><Text style={{ color: colors.muted }}>┄</Text> Earn more steps</Text>
      <Text style={styles.legendText}>New paths after victory</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: 10 },
  map: { width: '100%', aspectRatio: MAP_SIZE.width / MAP_SIZE.height, borderRadius: 20,
    overflow: 'hidden', backgroundColor: '#434838', borderWidth: 1, borderColor: '#5c6350' },
  mapHeading: { position: 'absolute', top: 13, left: 13, paddingHorizontal: 9, paddingVertical: 6,
    borderRadius: 6, backgroundColor: '#101918db' },
  eyebrow: { fontSize: 9, letterSpacing: 1.8, fontWeight: '700', color: colors.text },
  location: { position: 'absolute', alignItems: 'center', gap: 3 },
  marker: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 3 },
  number: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  label: { alignItems: 'center', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 7,
    backgroundColor: '#101918f0', borderWidth: 1, borderColor: '#536050', maxWidth: '100%' },
  name: { color: colors.text, fontSize: 11, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
  status: { fontSize: 9, lineHeight: 12, fontWeight: '600' },
  camp: { position: 'absolute', width: 56, textAlign: 'center', fontSize: 10, fontWeight: '700',
    color: colors.text, backgroundColor: '#101918dd', paddingVertical: 3, borderRadius: 5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  legendText: { fontSize: 10, color: colors.muted },
});
