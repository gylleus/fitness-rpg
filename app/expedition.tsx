import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../src/db/client';
import { advanceDungeon, dismissDungeonResult, resolveDungeonChest, retreatDungeon, startDungeon } from '../src/db/game';
import { battleDungeon } from '../src/game/combat';
import { useGame } from '../src/game/GameProvider';
import { multiplierLabel } from '../src/game/items';
import { armorReduction, attackPower, damageAfterArmor } from '../src/game/rules';
import { battleSchedule } from '../src/sprites/battleAnimation';
import { useBattleTick } from '../src/sprites/useBattleTick';
import { DungeonJourney } from '../src/ui/DungeonJourney';
import { LootRewards } from '../src/ui/LootRewards';
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
  const atChest = run?.state.phase === 'chest' || run?.state.phase === 'chest-reveal';
  const runId = run?.id;
  const tick = run?.state.tick;
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const advance = useCallback(() => {
    if (runId !== undefined && tick !== undefined && !perform(() => advanceDungeon(db, runId, tick))) setPlaying(false);
  }, [runId, tick, perform]);
  const schedule = run ? battleSchedule(run.state) : { key: 'empty', elapsed: 0, deadline: 800 };
  useBattleTick(`${runId}:${schedule.key}`, schedule.deadline,
    Boolean(active && !atChest && focused && foreground && playing), speed, advance, schedule.elapsed);

  const leave = () => router.dismissTo('/dungeon');
  if (!run) return <View style={[styles.screen, styles.empty]}>
    <Text style={ui.heading}>Choose an expedition to begin.</Text>
    <Button label="Choose expedition" onPress={leave} />
  </View>;

  const battle = run.state;
  const dungeon = battleDungeon(battle);
  const enemy = dungeon.enemies[battle.encounter];
  const power = (battle.rulesVersion ?? 0) >= 2 ? attackPower(battle.stats, battle.focusAttacks) : { damage: battle.stats.attack, minDamage: battle.stats.attack, maxDamage: battle.stats.attack, multiplier: 1 };
  const retryOffer = data.dungeonMap.find(offer => offer.offerId === dungeon.offerId);
  const retry = () => { if (retryOffer && perform(() => startDungeon(db, retryOffer.offerId))) setPlaying(true); };
  const chestAction = (action: 'open' | 'skip' | 'continue') => perform(() => resolveDungeonChest(db, run.id, battle.tick, action));
  const choose = () => { if (perform(() => dismissDungeonResult(db, run.id))) leave(); };
  return <View testID="fullscreen-expedition" style={styles.screen}>
    <DungeonJourney key={run.id} battle={battle} playing={focused && foreground && playing && !atChest} speed={speed} fullScreen />
    <View style={[styles.hud, { top: Math.max(10, insets.top), left: Math.max(16, insets.left), right: Math.max(16, insets.right) }]}>
      <View style={[styles.health, { maxWidth: 260 }]}>
        <Text numberOfLines={1} style={styles.name}>KNIGHT · {battle.heroHp}/{battle.stats.health} HP</Text>
        <Meter value={battle.heroHp} max={battle.stats.health} label="Hero health" />
        <Text style={ui.small}>{power.minDamage}–{power.maxDamage} damage · {multiplierLabel(power.multiplier)} power</Text>
        <Text style={ui.small}>{battle.stats.armor ?? 0} armor · {(armorReduction(battle.stats.armor) * 100).toFixed(1)}% reduction</Text>
      </View>
      <View style={styles.chapter}><Text style={[ui.label, { color: dungeon.color }]}>{dungeon.name}</Text>
        {dungeon.difficulty && <Text style={ui.small}>{dungeon.difficulty} · Level {dungeon.level}</Text>}
        <Text style={ui.small}>{battle.defeated}/{dungeon.enemies.length - (dungeon.chestEncounters?.length ?? 0)} monsters · {battle.loot?.length ?? 0} items · ◆ {battle.gold} {active ? 'pending' : 'earned'}</Text></View>
      {!atChest && <View style={[styles.health, { maxWidth: 260 }]}>
        <Text numberOfLines={1} style={[styles.name, { textAlign: 'right' }]}>{enemy.name} · {battle.enemyHp}/{enemy.health} HP</Text>
        <Meter value={battle.enemyHp} max={enemy.health} color={colors.red} label="Enemy health" />
        <Text style={[ui.small, { textAlign: 'right' }]}>{damageAfterArmor(enemy.attack, battle.stats.armor)} damage after armor</Text>
      </View>}
    </View>
    <View style={[styles.controls, { bottom: Math.max(10, insets.bottom), left: Math.max(16, insets.left), right: Math.max(16, insets.right) }]}>
      <Button compact secondary label="← Expeditions" onPress={leave} />
      <Text numberOfLines={2} style={[ui.small, styles.event]} accessibilityLiveRegion="polite">{battle.log.at(-1)}</Text>
      {active && <>
        <Button compact secondary label={`${speed}× speed`} onPress={() => setSpeed(speed === 1 ? 2 : 1)} />
        {!atChest && <Button compact label={playing ? 'Pause battle' : 'Resume battle'} onPress={() => setPlaying(!playing)} />}
        <Button compact secondary label="Retreat" onPress={() => Alert.alert('End this expedition?', 'The pending bounty is lost. Entry health is restored. Travel steps and used potion charges stay spent.', [
          { text: 'Keep battling', style: 'cancel' },
          { text: 'Retreat', onPress: () => { if (perform(() => retreatDungeon(db, run.id))) leave(); } },
        ])} />
      </>}
    </View>
    {active && atChest && <View pointerEvents="box-none" style={styles.resultArea}>
      <ScrollView testID="chest-prompt" style={styles.result} contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={ui.heading}>{battle.phase === 'chest' ? 'A chest beside the path.' : 'Inside the chest'}</Text>
        {battle.phase === 'chest' ? <>
          <Text style={ui.body}>Your expedition is paused. Open the chest to reveal its contents, or leave it and continue.</Text>
          <View style={ui.row}>
            <Button label="Open chest" onPress={() => chestAction('open')} />
            <Button secondary label="Leave chest" onPress={() => chestAction('skip')} />
          </View>
        </> : <>
          <LootRewards loot={(battle.loot ?? []).filter(drop => drop.encounter === battle.encounter)} secured={false} />
          <Text style={ui.small}>Defeat the final boss to bring this loot back to camp.</Text>
          <Button label="Continue expedition" onPress={() => chestAction('continue')} />
        </>}
      </ScrollView>
    </View>}
    {!active && <View pointerEvents="box-none" style={styles.resultArea}>
      <ScrollView style={styles.result} contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={ui.heading}>{battle.status === 'victory' ? 'Boss defeated. Well fought.' : 'Back to the campfire.'}</Text>
        <Text style={ui.body}>{battle.status === 'victory' ? `${battle.gold} gold · ${battle.xp} XP secured` : 'Entry health restored. Daily bonuses reset at 5 AM device time.'}</Text>
        {battle.status === 'victory' && <>
          <Text style={[ui.small, { color: colors.green }]}>{battle.loot?.length ? 'Loot secured. Tap an item to inspect it.' : 'No item drops in this older expedition'}</Text>
          <LootRewards loot={battle.loot ?? []} />
          <Button label="Open inventory" onPress={() => router.dismissTo('/forge')} />
        </>}
        {battle.status !== 'victory' && retryOffer && retryOffer.stepCost > 0 &&
          <Text style={ui.small}>Travel steps stay spent. Retry travel costs {retryOffer.stepCost.toLocaleString()} steps. You have {data.travelSteps.available.toLocaleString()} available.</Text>}
        <View style={[ui.row, { flexWrap: 'wrap' }]}>
          <Button compact secondary label="Choose a new expedition" onPress={choose} />
          {battle.status !== 'victory' && retryOffer && <Button compact label="Try this dungeon again"
            disabled={data.currentHealth <= 0 || data.travelSteps.available < retryOffer.stepCost} onPress={retry} />}
        </View>
      </ScrollView>
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
  result: { maxHeight: '75%', width: '92%', maxWidth: 600, backgroundColor: '#172622ed', borderColor: colors.border, borderWidth: 1, borderRadius: 16 },
});
