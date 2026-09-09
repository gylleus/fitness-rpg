import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { db } from '../../src/db/client';
import { advanceDungeon, retreatDungeon, startDungeon } from '../../src/db/game';
import { DUNGEONS } from '../../src/game/combat';
import { useGame } from '../../src/game/GameProvider';
import { percentLabel, pushupLabel } from '../../src/game/items';
import { DungeonJourney } from '../../src/ui/DungeonJourney';
import { PixelSprite } from '../../src/ui/PixelSprite';
import { Button, Card, colors, Gold, Meter, PageHeading, Screen, ui } from '../../src/ui/theme';

export default function DungeonScreen() {
  const { data, perform, foreground } = useGame();
  const [focused, setFocused] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const run = data.latestBattle;
  const battle = run?.state;
  const active = run?.status === 'active';

  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    if (!run || !active || !focused || !foreground || !playing) return;
    const timer = setTimeout(() => {
      if (!perform(() => advanceDungeon(db, run.id, run.state.tick))) setPlaying(false);
    }, (run.state.phase === 'travelling' ? 500 : 800) / speed);
    return () => clearTimeout(timer);
  }, [run, active, focused, foreground, playing, speed, perform]);

  const enter = (id: number) => {
    if (perform(() => startDungeon(db, id))) setPlaying(true);
  };
  return <Screen>
    <PageHeading eyebrow="Adventure / automatic battles" title="Into the wild." right={<Gold amount={data.hero.gold} />} />
    {battle && run && <Card>
      <View style={ui.between}><View style={[ui.flex, { gap: 5 }]}><Text style={ui.label}>{active ? `Encounter ${battle.encounter + 1} of 4` : 'Expedition result'}</Text><Text style={ui.heading}>{DUNGEONS[battle.dungeonId].name}</Text></View><Text style={{ color: DUNGEONS[battle.dungeonId].color, fontWeight: '700' }}>{active ? playing ? '● AUTO' : 'Ⅱ PAUSED' : battle.status.toUpperCase()}</Text></View>
      <View style={ui.row}>{DUNGEONS[battle.dungeonId].enemies.map((enemy, i) => <View key={enemy.name} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i < battle.defeated ? colors.green : i === battle.encounter ? colors.gold : colors.border }} />)}</View>
      <View style={{ backgroundColor: '#121e20', padding: 12, borderRadius: 14, gap: 14 }}>
        <View style={ui.between}>
          <View style={[ui.flex, { gap: 7 }]}><Text style={[ui.small, { color: colors.text }]}>Wayfarer · Lv {battle.stats.level}</Text><Meter value={battle.heroHp} max={battle.stats.health} label="Hero health" /><Text style={ui.small}>{battle.heroHp} / {battle.stats.health} HP</Text></View>
          <View style={[ui.flex, { gap: 7 }]}><Text style={[ui.small, { color: colors.text }]}>{DUNGEONS[battle.dungeonId].enemies[battle.encounter].name}</Text><Meter value={battle.enemyHp} max={DUNGEONS[battle.dungeonId].enemies[battle.encounter].health} color={colors.red} label="Enemy health" /><Text style={ui.small}>{battle.enemyHp} / {DUNGEONS[battle.dungeonId].enemies[battle.encounter].health} HP</Text></View>
        </View>
        <DungeonJourney battle={battle} moving={!!active && focused && foreground && playing} speed={speed} />
        <View style={ui.between}><Text style={ui.small}>{battle.stats.attack} damage · {percentLabel(battle.stats.dodgeBps)} dodge</Text><Text style={ui.small}>{DUNGEONS[battle.dungeonId].enemies[battle.encounter].attack} enemy damage</Text></View>
      </View>
      <Text style={[ui.body, { color: colors.green }]}>{active ? data.attacksAvailable : battle.attacksMade} attacks {active ? 'available' : 'used'} · {pushupLabel(active ? data.pushupUnits : battle.pushupUnits)} pushups left</Text>
      {active && <>
        <Text style={ui.small}>Next attack costs {pushupLabel(data.attackCostUnits)} pushups{battle.focusAttacks > 0 ? ` · ${battle.focusAttacks} focused attacks left` : ''}.</Text>
        {battle.stats.dodgeBps > 0 && <Text style={[ui.small, { color: colors.purple }]}>Next dodge in {Math.ceil((10000 - battle.meters.dodge) / battle.stats.dodgeBps)} enemy attacks.</Text>}
      </>}
      <View style={{ minHeight: 105, gap: 4 }} accessibilityLiveRegion="polite">{battle.log.map((line, i) => <Text key={`${battle.tick}-${i}`} style={[ui.small, { color: i === battle.log.length - 1 ? colors.text : colors.muted }]}>{line}</Text>)}</View>
      <View style={ui.between}><Text style={{ color: colors.gold, fontWeight: '700' }}>◆ {battle.gold} gold {active ? 'pending' : 'earned'}</Text><Text style={[ui.small, { color: colors.purple }]}>+{battle.xp} XP · {battle.defeated}/4 defeated</Text></View>
      {active ? <>
        <View style={ui.row}><View style={ui.flex}><Button label={playing ? 'Pause battle' : 'Resume battle'} onPress={() => setPlaying(!playing)} /></View><Button secondary label={`${speed}× speed`} onPress={() => setSpeed(speed === 1 ? 2 : 1)} /></View>
        <Button secondary label="Retreat to camp" onPress={() => Alert.alert('End this expedition?', 'The pending bounty is lost. Entry health and spent pushups are restored. Used potion charges stay spent.', [{ text: 'Keep battling', style: 'cancel' }, { text: 'Retreat', onPress: () => perform(() => retreatDungeon(db, run.id)) }])} />
        <Text style={ui.small}>Loot is awarded only after the boss falls. Leaving this screen pauses the expedition; every step and attack is saved.</Text>
      </> : <>
        <Text style={ui.heading}>{battle.status === 'victory' ? battle.dungeonId === DUNGEONS.length - 1 ? 'The realm is clear. Well fought.' : 'Boss defeated. A new path opens.' : battle.status === 'expired' ? 'A fresh day. A fresh adventure.' : battle.status === 'retreated' ? 'Back by the campfire.' : 'Every attempt is progress.'}</Text>
        <Text style={ui.body}>{battle.status === 'victory' ? `Rewards secured. Your remaining ${battle.heroHp} HP carries into the next expedition.` : battle.status === 'exhausted' ? 'Your stockpile ran out. No gold or XP earned. Your pushups and entry health are restored; train more or improve your gear to get further.' : 'No gold or XP earned. Entry health and spent pushups are restored. Used potion charges stay spent.'}</Text>
        <Button label="Try this dungeon again" disabled={data.attacksAvailable === 0 || data.currentHealth === 0} onPress={() => enter(battle.dungeonId)} />
      </>}
    </Card>}

    <View style={{ gap: 14 }}><Text style={ui.heading}>Choose your expedition</Text><Text style={[ui.body, { color: colors.green }]}>Available health: {data.currentHealth} / {data.stats.health} HP</Text><Text style={ui.body}>{data.attacksAvailable} attacks in your stockpile</Text><Text style={ui.small}>Every attack spends pushups. Wins carry health; failed attempts restore entry health, refund pushups, and award no loot. Walk, upgrade armor, or use a healing potion to recover health. Running grants dodge.</Text><Text style={ui.body}>Follow the path through four encounters. Defeat the boss to secure the entire bounty.</Text>
      {data.attacksAvailable === 0 && <Text style={[ui.body, { color: colors.gold }]}>Train pushups at camp to stockpile your first attack.</Text>}
      {DUNGEONS.map((dungeon) => {
        const locked = dungeon.id > data.hero.unlockedDungeon;
        return <Card key={dungeon.id} style={{ opacity: locked ? 0.6 : 1 }}>
          <View style={ui.row}><View style={{ width: 68, height: 68, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><PixelSprite kind="boss" size={60} tint={dungeon.color} /></View><View style={[ui.flex, { gap: 5 }]}><Text style={[ui.label, { color: dungeon.color }]}>Chapter {String(dungeon.id + 1).padStart(2, '0')}</Text><Text style={ui.heading}>{dungeon.name}</Text><Text style={ui.small}>{dungeon.subtitle}</Text></View></View>
          <View style={ui.between}><Text style={ui.small}>Boss · {dungeon.enemies[3].health} HP / {dungeon.enemies[3].attack} ATK</Text><Text style={{ color: colors.gold, fontSize: 12 }}>◆ up to {dungeon.enemies.reduce((sum, e) => sum + e.gold, 0)}</Text></View>
          <Button secondary label={locked ? `Defeat ${DUNGEONS[dungeon.id - 1].enemies[3].name}` : active ? 'Expedition in progress' : 'Enter dungeon  →'} disabled={locked || active || data.attacksAvailable === 0 || data.currentHealth === 0} onPress={() => enter(dungeon.id)} />
        </Card>;
      })}
    </View>
  </Screen>;
}
