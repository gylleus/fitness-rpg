import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { beginBattle, DUNGEONS } from '../src/game/combat';
import { fitnessDay, heroStats } from '../src/game/rules';
import { journeyInterior } from '../src/scenes/interiorRoutes';
import { DungeonJourney } from '../src/ui/DungeonJourney';
import { Button, colors } from '../src/ui/theme';

/** Device art review uses production chapter routing without starting a saved run. */
export default function SceneryReview() {
  const params = useLocalSearchParams<{ dungeon?: string; encounter?: string }>();
  const router = useRouter();
  const requested = Number(params.dungeon ?? 1);
  const dungeonId = Number.isInteger(requested) && DUNGEONS[requested] ? requested : 1;
  const dungeon = DUNGEONS[dungeonId];
  const requestedEncounter = Number(params.encounter ?? 0);
  const encounter = Number.isInteger(requestedEncounter) ? Math.max(0, Math.min(dungeon.enemies.length - 1, requestedEncounter)) : 0;
  const battle = useMemo(() => {
    const stats = heroStats({ gold: 0, xp: 0, swordLevel: 0, armorLevel: 0, unlockedDungeon: 3 }, fitnessDay('2026-09-14'));
    return { ...beginBattle(dungeonId, '2026-09-14', stats), encounter, defeated: encounter,
      phase: 'fighting' as const, travel: 3, enemyHp: DUNGEONS[dungeonId].enemies[encounter].health };
  }, [dungeonId, encounter]);
  if (!__DEV__) return <Redirect href="/dungeon" />;
  return <View style={styles.screen} testID="device-scenery-review">
    <DungeonJourney key={dungeonId} battle={battle} playing={false} speed={1} fullScreen />
    <View style={styles.heading}>
      <Text style={styles.title}>{dungeon.name} · {journeyInterior(battle)?.replaceAll('_', ' ') ?? 'Wetlands'}</Text>
      <Text style={styles.note}>Scenery preview · saved progress stays unchanged</Text>
    </View>
    <View style={styles.controls}>
      <Button compact secondary label="← Expeditions" onPress={() => router.dismissTo('/dungeon')} />
      <Button compact secondary label="Embercrypt" onPress={() => router.setParams({ dungeon: '1', encounter: '0' })} />
      <Button compact secondary label="Frostbound Keep" onPress={() => router.setParams({ dungeon: '2', encounter: '0' })} />
      <Button compact secondary label="Hollow Delve" onPress={() => router.setParams({ dungeon: '3', encounter: '0' })} />
      <Button compact label={`Encounter ${encounter + 1}/${dungeon.enemies.length} →`}
        onPress={() => router.setParams({ encounter: String((encounter + 1) % dungeon.enemies.length) })} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: { position: 'absolute', top: 12, left: 20, padding: 10, borderRadius: 8, backgroundColor: '#101918dd' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 11, marginTop: 3 },
  controls: { position: 'absolute', bottom: 12, left: 16, right: 16, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
