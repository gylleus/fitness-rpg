import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { db } from '../../src/db/client';
import { dismissDungeonResult, startDungeon } from '../../src/db/game';
import { DUNGEONS, battleDungeon } from '../../src/game/combat';
import { useGame } from '../../src/game/GameProvider';
import { LootRewards } from '../../src/ui/LootRewards';
import { multiplierLabel } from '../../src/game/items';
import { EntitySprite } from '../../src/ui/EntitySprite';
import { DungeonMap } from '../../src/ui/DungeonMap';
import { Button, Card, colors, Gold, PageHeading, Screen, ui } from '../../src/ui/theme';

export default function DungeonScreen() {
  const { data, perform } = useGame();
  const router = useRouter();
  const run = data.latestBattle;
  const active = run?.status === 'active';
  const [chosenId, setChosenId] = useState<number | null>(null);
  const selectedId = chosenId ?? (active ? run.state.dungeonId : Math.min(data.hero.unlockedDungeon, DUNGEONS.length - 1));
  const dungeon = DUNGEONS.find(d => d.id === selectedId) ?? DUNGEONS[0];
  const locked = dungeon.id > data.hero.unlockedDungeon;
  const boss = dungeon.enemies[dungeon.enemies.length - 1];
  const previous = DUNGEONS[dungeon.id - 1];
  const enter = (id: number) => {
    if (perform(() => startDungeon(db, id))) router.push('/expedition');
  };
  return <Screen>
    <PageHeading eyebrow="Adventure / world map" title="Choose your path." right={<Gold amount={data.hero.gold} />} />
    {active && <Card>
      <Text style={ui.label}>Expedition in progress</Text>
      <Text style={ui.heading}>{battleDungeon(run.state).name}</Text>
      <Text style={ui.body}>Your expedition is paused here. Continue in full-screen landscape.</Text>
      <Button label="Continue expedition" onPress={() => router.push('/expedition')} />
    </Card>}
    <DungeonMap selectedId={dungeon.id} onSelect={setChosenId} unlockedDungeon={data.hero.unlockedDungeon}
      activeDungeonId={active ? run.state.dungeonId : undefined} />
    <Card>
      <View style={ui.row}>
        <View style={{ width: 68, height: 68, borderRadius: 14, backgroundColor: colors.bg }}>
          <View style={{ position: 'absolute', left: 34, bottom: 8 }}><EntitySprite entityId={boss.id} heroHeight={42} fallback={boss.sprite} tint={dungeon.color} playing={false} /></View>
        </View>
        <View style={[ui.flex, { gap: 5 }]}>
          <Text style={[ui.label, { color: dungeon.color }]}>Chapter {String(dungeon.id + 1).padStart(2, '0')} · {locked ? 'Locked' : 'Available'}</Text>
          <Text accessibilityRole="header" style={ui.heading}>{dungeon.name}</Text>
          <Text style={ui.small}>{dungeon.subtitle}</Text>
        </View>
      </View>
      <View style={ui.between}>
        <Text style={[ui.small, ui.flex]}>Boss · {boss.name}{'\n'}{boss.health} HP / {boss.attack} ATK</Text>
        <Text style={{ color: colors.gold, fontSize: 12 }}>◆ up to {dungeon.enemies.reduce((sum, e) => sum + e.gold, 0)}</Text>
      </View>
      {locked && <Text style={ui.body}>Defeat {previous.enemies[previous.enemies.length - 1].name} in {previous.name} to open this path.</Text>}
      <Button label={locked ? `Defeat ${previous.enemies[previous.enemies.length - 1].name}` : active ? 'Expedition in progress' : data.currentHealth <= 0 ? 'Recover health to enter' : 'Enter dungeon  →'}
        disabled={locked || active || data.currentHealth <= 0} onPress={() => enter(dungeon.id)} />
      <Text style={[ui.small, { color: colors.green }]}>Available health: {data.currentHealth} / {data.stats.health} HP</Text>
    </Card>
    {run && !active && <Card>
      <Text style={ui.label}>Expedition result</Text>
      <Text style={ui.heading}>{battleDungeon(run.state).name}</Text>
        <Text style={ui.body}>This expedition has ended. You are back at camp with {data.currentHealth} / {data.stats.health} HP. Today’s pushups power your attacks until 5 AM device time.</Text>
        <Text style={ui.body}>{run.status === 'victory' ? `Victory · ${run.state.gold} gold · ${run.state.xp} XP earned` : 'No loot earned. Entry health is restored.'}</Text>
        {run.status === 'victory' && <LootRewards loot={run.state.loot ?? []} />}
        <Button secondary label="Choose a new expedition" onPress={() => perform(() => dismissDungeonResult(db, run.id))} />
        <Button label="Try this dungeon again" disabled={data.currentHealth <= 0} onPress={() => enter(run.state.dungeonId)} />
    </Card>}
    <View style={{ gap: 14 }}>
      <Text style={ui.heading}>{data.damageMin}–{data.damageMax} damage · {multiplierLabel(data.damageMultiplier)} pushup power</Text>
      <Text style={ui.body}>{data.today.pushups} pushups today increase your damage until 5 AM device time. Attacks never consume pushups; you can enter even with zero.</Text>
      <Text style={ui.small}>Defeat the boss to secure the entire bounty. Wins carry health; failed attempts restore entry health and award no loot. Enemies can drop items; bosses guarantee an item. Combat and loot rolls repeat after failure. Only victory changes this dungeon’s rolls. Training and equipment take effect on your next expedition.</Text>
      {!active && data.currentHealth <= 0 && <Card>
        <Text style={ui.heading}>Recover health before setting out</Text>
        <Text style={ui.body}>Sync your steps, use a healing potion, or equip health bonuses to recover health. Daily health also resets at 5 AM device time.</Text>
        <Button label="Sync steps for health" onPress={() => router.push('/health')} />
        <Button secondary label="Open inventory" onPress={() => router.navigate('/forge')} />
      </Card>}
      <Button secondary label="Train pushups" onPress={() => router.push('/session')} />
    </View>
  </Screen>;
}
