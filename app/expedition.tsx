import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../src/db/client';
import { advanceDungeon, dismissDungeonResult, retreatDungeon, startDungeon } from '../src/db/game';
import { battleDungeon } from '../src/game/combat';
import { useGame } from '../src/game/GameProvider';
import { multiplierLabel } from '../src/game/items';
import { attackPower } from '../src/game/rules';
import { battleSchedule } from '../src/sprites/battleAnimation';
import { useBattleTick } from '../src/sprites/useBattleTick';
import { DungeonJourney } from '../src/ui/DungeonJourney';
import { Button, colors, Meter, ui } from '../src/ui/theme';

export default function ExpeditionScreen() {
  const { data, perform, foreground } = useGame();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [focused, setFocused] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const run = data.latestBattle;
  const active = run?.status === 'active';
  const runId = run?.id;
  const tick = run?.state.tick;
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const advance = useCallback(() => {
    if (runId !== undefined && tick !== undefined && !perform(() => advanceDungeon(db, runId, tick))) setPlaying(false);
  }, [runId, tick, perform]);
  const schedule = run ? battleSchedule(run.state) : { key: 'empty', elapsed: 0, deadline: 800 };
  useBattleTick(`${runId}:${schedule.key}`, schedule.deadline,
    Boolean(active && focused && foreground && playing), speed, advance, schedule.elapsed);

  const leave = () => router.dismissTo('/dungeon');
  if (!run) return <View style={[styles.screen, styles.empty]}>
    <Text style={ui.heading}>Choose an expedition to begin.</Text>
    <Button label="Choose expedition" onPress={leave} />
  </View>;

  const battle = run.state;
  const dungeon = battleDungeon(battle);
  const enemy = dungeon.enemies[battle.encounter];
  const power = battle.rulesVersion === 2 ? attackPower(battle.stats, battle.focusAttacks) : { damage: battle.stats.attack, multiplier: 1 };
  const retry = () => { if (perform(() => startDungeon(db, battle.dungeonId))) setPlaying(true); };
  const choose = () => { if (perform(() => dismissDungeonResult(db, run.id))) leave(); };
  return <View testID="fullscreen-expedition" style={styles.screen}>
    <DungeonJourney key={run.id} battle={battle} playing={focused && foreground && playing} speed={speed} fullScreen />
    <View style={[styles.hud, { top: Math.max(10, insets.top), left: Math.max(16, insets.left), right: Math.max(16, insets.right) }]}>
      <View style={[styles.health, { maxWidth: 260 }]}>
        <Text numberOfLines={1} style={styles.name}>BARBARIAN · {battle.heroHp}/{battle.stats.health} HP</Text>
        <Meter value={battle.heroHp} max={battle.stats.health} label="Hero health" />
        <Text style={ui.small}>{power.damage} damage · {multiplierLabel(power.multiplier)} power</Text>
      </View>
      <View style={styles.chapter}><Text style={[ui.label, { color: dungeon.color }]}>{dungeon.name}</Text><Text style={ui.small}>{battle.defeated}/{dungeon.enemies.length} defeated · ◆ {battle.gold} {active ? 'pending' : 'earned'}</Text></View>
      <View style={[styles.health, { maxWidth: 260 }]}>
        <Text numberOfLines={1} style={[styles.name, { textAlign: 'right' }]}>{enemy.name} · {battle.enemyHp}/{enemy.health} HP</Text>
        <Meter value={battle.enemyHp} max={enemy.health} color={colors.red} label="Enemy health" />
        <Text style={[ui.small, { textAlign: 'right' }]}>{enemy.attack} damage</Text>
      </View>
    </View>
    <View style={[styles.controls, { bottom: Math.max(10, insets.bottom), left: Math.max(16, insets.left), right: Math.max(16, insets.right) }]}>
      <Button compact secondary label="← Expeditions" onPress={leave} />
      <Text numberOfLines={2} style={[ui.small, styles.event]} accessibilityLiveRegion="polite">{battle.log.at(-1)}</Text>
      {active && <>
        <Button compact secondary label={`${speed}× speed`} onPress={() => setSpeed(speed === 1 ? 2 : 1)} />
        <Button compact label={playing ? 'Pause battle' : 'Resume battle'} onPress={() => setPlaying(!playing)} />
        <Button compact secondary label="Retreat" onPress={() => Alert.alert('End this expedition?', 'The pending bounty is lost. Entry health is restored. Used potion charges stay spent.', [
          { text: 'Keep battling', style: 'cancel' },
          { text: 'Retreat', onPress: () => { if (perform(() => retreatDungeon(db, run.id))) leave(); } },
        ])} />
      </>}
    </View>
    {!active && <View pointerEvents="box-none" style={styles.resultArea}>
      <View style={styles.result}>
        <Text style={ui.heading}>{battle.status === 'victory' ? 'Boss defeated. Well fought.' : 'Back to the campfire.'}</Text>
        <Text style={ui.body}>{battle.status === 'victory' ? `${battle.gold} gold · ${battle.xp} XP secured` : 'Entry health restored. Your pushup power stays.'}</Text>
        <View style={ui.row}>
          <Button compact secondary label="Choose a new expedition" onPress={choose} />
          <Button compact label="Try this dungeon again" disabled={data.currentHealth <= 0} onPress={retry} />
        </View>
      </View>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111e22' },
  empty: { justifyContent: 'center', alignItems: 'center', gap: 20 },
  hud: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  health: { flex: 1, gap: 5, padding: 10, backgroundColor: '#101918dd', borderRadius: 12 },
  name: { color: colors.text, fontSize: 12, fontWeight: '700' },
  chapter: { flex: 1, alignItems: 'center', gap: 6, paddingTop: 10 },
  controls: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 10 },
  event: { flex: 1, textAlign: 'center', paddingHorizontal: 8 },
  resultArea: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  result: { padding: 20, gap: 12, backgroundColor: '#172622ed', borderColor: colors.border, borderWidth: 1, borderRadius: 16 },
});
