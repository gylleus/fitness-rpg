import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { db } from '../../src/db/client';
import { dismissDungeonResult, startDungeon } from '../../src/db/game';
import { DUNGEONS, battleDungeon } from '../../src/game/combat';
import { useGame } from '../../src/game/GameProvider';
import { multiplierLabel } from '../../src/game/items';
import { EntitySprite } from '../../src/ui/EntitySprite';
import { Button, Card, colors, Gold, PageHeading, Screen, ui } from '../../src/ui/theme';

export default function DungeonScreen() {
  const { data, perform } = useGame();
  const router = useRouter();
  const run = data.latestBattle;
  const active = run?.status === 'active';
  const enter = (id: number) => {
    if (perform(() => startDungeon(db, id))) router.push('/expedition');
  };
  return <Screen>
    <PageHeading eyebrow="Adventure / automatic battles" title="Into the wild." right={<Gold amount={data.hero.gold} />} />
    {run && <Card>
      <Text style={ui.label}>{active ? 'Expedition in progress' : 'Expedition result'}</Text>
      <Text style={ui.heading}>{battleDungeon(run.state).name}</Text>
      {active ? <>
        <Text style={ui.body}>Your expedition is paused here. Continue in full-screen landscape.</Text>
        <Button label="Continue expedition" onPress={() => router.push('/expedition')} />
      </> : <>
        <Text style={ui.body}>This expedition has ended. You are back at camp with {data.currentHealth} / {data.stats.health} HP. Your saved pushups still power every attack.</Text>
        <Text style={ui.body}>{run.status === 'victory' ? `Victory · ${run.state.gold} gold · ${run.state.xp} XP earned` : 'No loot earned. Entry health is restored.'}</Text>
        {run.status === 'victory' && (run.state.loot ?? []).map((drop, i) => <Text key={i} style={[ui.body, { color: colors.green }]}>{drop.boss ? 'Boss reward' : 'Loot'} · {drop.item.name}</Text>)}
        <Button secondary label="Choose a new expedition" onPress={() => perform(() => dismissDungeonResult(db, run.id))} />
        <Button label="Try this dungeon again" disabled={data.currentHealth <= 0} onPress={() => enter(run.state.dungeonId)} />
      </>}
    </Card>}
    <View style={{ gap: 14 }}>
      <Text style={ui.heading}>Choose your expedition</Text>
      <Text style={[ui.body, { color: colors.green }]}>Available health: {data.currentHealth} / {data.stats.health} HP</Text>
      <Text style={ui.heading}>{data.damageMin}–{data.damageMax} damage · {multiplierLabel(data.damageMultiplier)} pushup power</Text>
      <Text style={ui.body}>{data.savedPushups} saved pushups increase your damage. Attacks never consume pushups; you can enter even with zero.</Text>
      <Text style={ui.small}>Defeat the boss to secure the entire bounty. Wins carry health; failed attempts restore entry health and award no loot. Enemies can drop items; bosses guarantee an item. Combat and loot rolls repeat after failure. Only victory changes this dungeon’s rolls. Training and equipment take effect on your next expedition.</Text>
      {!active && data.currentHealth <= 0 && <Card>
        <Text style={ui.heading}>Recover health before setting out</Text>
        <Text style={ui.body}>Sync your steps, use a healing potion, or equip better armor to recover health. Daily health also resets tomorrow.</Text>
        <Button label="Sync steps for health" onPress={() => router.push('/health')} />
        <Button secondary label="Open inventory" onPress={() => router.navigate('/forge')} />
      </Card>}
      <Button secondary label="Train pushups" onPress={() => router.push('/session')} />
      {DUNGEONS.map(dungeon => {
        const locked = dungeon.id > data.hero.unlockedDungeon;
        const boss = dungeon.enemies[dungeon.enemies.length - 1];
        const previous = DUNGEONS[dungeon.id - 1];
        return <Card key={dungeon.id} style={{ opacity: locked ? 0.6 : 1 }}>
          <View style={ui.row}>
            <View style={{ width: 68, height: 68, borderRadius: 14, backgroundColor: colors.bg }}>
              <View style={{ position: 'absolute', left: 34, bottom: 8 }}><EntitySprite entityId={boss.id} heroHeight={42} fallback={boss.sprite} tint={dungeon.color} playing={false} /></View>
            </View>
            <View style={[ui.flex, { gap: 5 }]}><Text style={[ui.label, { color: dungeon.color }]}>Chapter {String(dungeon.id + 1).padStart(2, '0')}</Text><Text style={ui.heading}>{dungeon.name}</Text><Text style={ui.small}>{dungeon.subtitle}</Text></View>
          </View>
          <View style={ui.between}><Text style={ui.small}>Boss · {boss.health} HP / {boss.attack} ATK</Text><Text style={{ color: colors.gold, fontSize: 12 }}>◆ up to {dungeon.enemies.reduce((sum, e) => sum + e.gold, 0)}</Text></View>
          <Button secondary label={locked ? `Defeat ${previous.enemies[previous.enemies.length - 1].name}` : active ? 'Expedition in progress' : data.currentHealth <= 0 ? 'Recover health to enter' : 'Enter dungeon  →'}
            disabled={locked || active || data.currentHealth <= 0} onPress={() => enter(dungeon.id)} />
        </Card>;
      })}
    </View>
  </Screen>;
}
