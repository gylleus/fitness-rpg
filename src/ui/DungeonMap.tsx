import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { DUNGEONS } from '../game/combat';
import { MAP_CAMP, MAP_LOCATIONS, MAP_SIZE, mapNodeLayout, mapRoutes } from './worldMap';
import { colors } from './theme';

function LockIcon() {
  return <Svg width={18} height={18} viewBox="0 0 18 18" accessible={false}>
    <Path d="M5 8V5a4 4 0 018 0v3" stroke={colors.muted} strokeWidth={1.6} fill="none" />
    <Rect x={3.5} y={7.5} width={11} height={8} rx={2} fill={colors.muted} />
    <Circle cx={9} cy={11} r={1.2} fill={colors.bg} />
  </Svg>;
}

export function DungeonMap({ selectedId, onSelect, unlockedDungeon, activeDungeonId }: {
  selectedId: number; onSelect: (id: number) => void; unlockedDungeon: number; activeDungeonId?: number;
}) {
  const [width, setWidth] = useState(320);
  return <View style={styles.container}>
    <View testID="dungeon-map" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={styles.map}>
      <Image source={require('../../assets/maps/world-map.png')} style={StyleSheet.absoluteFill} resizeMode="stretch"
        accessible={false} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#10191818' }]} />
      <Svg pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox={`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`}>
        {mapRoutes(unlockedDungeon).map(route => <G key={route.dungeonId}>
          <Path d={route.path} stroke="#101918" strokeOpacity={0.7} strokeWidth={10} fill="none" strokeLinecap="round" />
          <Path testID={`map-route-${route.dungeonId}`} d={route.path} stroke={route.unlocked ? colors.gold : '#abb4a5'}
            strokeWidth={route.unlocked ? 4 : 3} strokeDasharray={route.unlocked ? undefined : '5 12'}
            strokeOpacity={route.unlocked ? 1 : 0.65} fill="none" strokeLinecap="round" />
        </G>)}
        <Circle cx={MAP_CAMP.x} cy={MAP_CAMP.y} r={10} fill={colors.gold} stroke={colors.bg} strokeWidth={4} />
      </Svg>
      <View pointerEvents="none" style={styles.mapHeading}><Text style={styles.eyebrow}>EXPEDITION MAP</Text></View>
      <Text pointerEvents="none" style={[styles.camp, { left: width * MAP_CAMP.x / MAP_SIZE.width - 28,
        top: width * MAP_CAMP.y / MAP_SIZE.width + 9 }]}>Camp</Text>
      {MAP_LOCATIONS.map(location => {
        const dungeon = DUNGEONS.find(d => d.id === location.dungeonId)!;
        const locked = dungeon.id > unlockedDungeon;
        const selected = dungeon.id === selectedId;
        const active = dungeon.id === activeDungeonId;
        const status = active ? 'In progress' : locked ? 'Locked' : selected ? 'Selected' : 'Available';
        return <Pressable key={dungeon.id} testID={`map-location-${dungeon.id}`} accessibilityRole="button"
          accessibilityLabel={`Select ${dungeon.name}, ${status.toLowerCase()}`} accessibilityState={{ selected }}
          accessibilityHint={locked ? 'Shows the boss required to unlock this dungeon.' : 'Shows dungeon details and the entry button.'}
          onPress={() => onSelect(dungeon.id)}
          style={({ pressed }) => [styles.location, mapNodeLayout(width, location), { opacity: pressed ? 0.75 : 1 }]}>
          <View style={[styles.marker, { borderColor: selected ? colors.gold : active ? colors.green : locked ? colors.muted : dungeon.color,
            backgroundColor: selected ? '#373423' : colors.bg, borderWidth: selected ? 3 : 2 }]}>
            {locked ? <LockIcon /> : <Text style={[styles.number, { color: active ? colors.green : selected ? colors.gold : colors.text }]}>
              {String(dungeon.id + 1).padStart(2, '0')}
            </Text>}
          </View>
          <View style={[styles.label, selected && { borderColor: colors.gold }]}>
            <Text style={[styles.name, { color: locked ? '#c4ccc5' : colors.text }]}>{dungeon.name}</Text>
            <Text style={[styles.status, { color: active ? colors.green : selected ? colors.gold : colors.muted }]}>{status}</Text>
          </View>
        </Pressable>;
      })}
    </View>
    <View style={styles.legend}>
      <Text style={styles.legendText}><Text style={{ color: colors.gold }}>━</Text> Open path</Text>
      <Text style={styles.legendText}><Text style={{ color: colors.muted }}>┄</Text> Locked route</Text>
      <Text style={styles.legendText}>Tap a destination</Text>
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
  name: { fontSize: 11, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
  status: { fontSize: 9, lineHeight: 12, fontWeight: '600' },
  camp: { position: 'absolute', width: 56, textAlign: 'center', fontSize: 10, fontWeight: '700',
    color: colors.text, backgroundColor: '#101918dd', paddingVertical: 3, borderRadius: 5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  legendText: { fontSize: 10, color: colors.muted },
});
