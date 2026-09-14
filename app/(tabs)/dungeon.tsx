import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { db } from '../../src/db/client';
import { dismissDungeonResult, startDungeon } from '../../src/db/game';
import { battleDungeon } from '../../src/game/combat';
import { useGame } from '../../src/game/GameProvider';
import { LootRewards } from '../../src/ui/LootRewards';
import { multiplierLabel } from '../../src/game/items';
import { EntitySprite } from '../../src/ui/EntitySprite';
import { DungeonMap, difficultyLabel } from '../../src/ui/DungeonMap';
import { Button, Card, colors, Gold, PageHeading, Screen, ui } from '../../src/ui/theme';

export default function DungeonScreen() {
  const { data, perform } = useGame();
  const router = useRouter();
  const run = data.latestBattle;
  const active = run?.status === 'active';
  const [chosenId, setChosenId] = useState<string | null>(null);
  const savedDungeon = run ? battleDungeon(run.state) : null;
  const preferredId = chosenId ?? (active ? savedDungeon?.offerId : undefined);
  const dungeon = data.dungeonMap.find(offer => offer.offerId === preferredId) ?? data.dungeonMap[0];
  const boss = dungeon.enemies[dungeon.enemies.length - 1];
  const canAfford = data.travelSteps.available >= dungeon.stepCost;
  const retryOffer = data.dungeonMap.find(offer => offer.offerId === savedDungeon?.offerId);
  const enter = (offerId: string) => {
    if (perform(() => startDungeon(db, offerId))) router.push('/expedition');
  };
  return <Screen>
    <PageHeading eyebrow="Adventure / around camp" title="Choose your path." right={<Gold amount={data.hero.gold} />} />
    <Card>
      <Text style={ui.label}>Steps for travel today</Text>
      <Text style={ui.heading}>{data.travelSteps.available.toLocaleString()} steps available</Text>
      <Text style={ui.small}>{data.travelSteps.earned.toLocaleString()} earned · {data.travelSteps.spent.toLocaleString()} spent · resets at 5 AM</Text>
      <Text style={ui.body}>Walk to heroic and mythic dungeons using today’s steps. Normal paths are free. New destinations appear after every victory.</Text>
      <Button compact secondary label="Sync travel steps" onPress={() => router.push('/health')} />
    </Card>
    {active && <Card>
      <Text style={ui.label}>Expedition in progress</Text>
      <Text style={ui.heading}>{savedDungeon!.name}</Text>
      <Text style={ui.body}>Your expedition is paused here. Continue in full-screen landscape.</Text>
      <Button label="Continue expedition" onPress={() => router.push('/expedition')} />
    </Card>}
    <DungeonMap offers={data.dungeonMap} selectedId={dungeon.offerId} onSelect={setChosenId}
      availableSteps={data.travelSteps.available} activeOfferId={active ? savedDungeon?.offerId : undefined} />
    <Card>
      <View style={ui.row}>
        <View style={{ width: 68, height: 68, borderRadius: 14, backgroundColor: colors.bg }}>
          <View style={{ position: 'absolute', left: 34, bottom: 8 }}><EntitySprite entityId={boss.id} heroHeight={42} fallback={boss.sprite} tint={dungeon.color} playing={false} /></View>
        </View>
        <View style={[ui.flex, { gap: 5 }]}>
          <Text style={[ui.label, { color: dungeon.color }]}>{difficultyLabel(dungeon.difficulty)} · Level {dungeon.level}</Text>
          <Text accessibilityRole="header" style={ui.heading}>{dungeon.name}</Text>
          <Text style={ui.small}>{dungeon.subtitle}</Text>
        </View>
      </View>
      <View style={ui.between}>
        <Text style={[ui.small, ui.flex]}>Boss · {boss.name}{'\n'}{boss.health} HP / {boss.attack} ATK</Text>
        <Text style={{ color: colors.gold, fontSize: 12 }}>◆ up to {dungeon.enemies.reduce((sum, e, i) => sum + (dungeon.chestEncounters?.includes(i) ? 0 : e.gold), 0)}</Text>
      </View>
      <Text style={ui.body}>{dungeon.stepCost === 0 ? 'Free entry' : `${dungeon.stepCost.toLocaleString()} steps to travel`} · {dungeon.enemies.length - (dungeon.chestEncounters?.length ?? 0)} monsters</Text>
      <Text style={[ui.small, { color: dungeon.difficulty === 'normal' ? colors.green : '#91c9ff' }]}>Boss reward: guaranteed {dungeon.difficulty === 'normal' ? 'Uncommon' : 'Rare'} item or better · item level near {dungeon.level}</Text>
      <Text style={ui.small}>{dungeon.difficulty === 'normal' ? 'A shorter expedition. Normal paths may be below your level.' : `${difficultyLabel(dungeon.difficulty)} expeditions match your level, with more monsters, stronger bosses and better chances of magical loot.`}</Text>
      <Button label={active ? 'Expedition in progress' : data.currentHealth <= 0 ? 'Recover health to enter' : !canAfford ? `Need ${(dungeon.stepCost - data.travelSteps.available).toLocaleString()} more steps` : 'Enter dungeon  →'}
        disabled={active || data.currentHealth <= 0 || !canAfford} onPress={() => enter(dungeon.offerId)} />
      <Text style={[ui.small, { color: colors.green }]}>Available health: {data.currentHealth} / {data.stats.health} HP</Text>
    </Card>
    {run && !active && <Card>
      <Text style={ui.label}>Expedition result</Text>
      <Text style={ui.heading}>{savedDungeon!.name}</Text>
      <Text style={ui.body}>This expedition has ended. You are back at camp with {data.currentHealth} / {data.stats.health} HP. Today’s pushups power your attacks until 5 AM device time.</Text>
      <Text style={ui.body}>{run.status === 'victory' ? `Victory · ${run.state.gold} gold · ${run.state.xp} XP earned. New paths await around camp.` : 'No loot earned. Entry health is restored. Travel steps stay spent.'}</Text>
      {run.status === 'victory' && <LootRewards loot={run.state.loot ?? []} />}
      <Button secondary label="Choose a new expedition" onPress={() => perform(() => dismissDungeonResult(db, run.id))} />
      {run.status !== 'victory' && retryOffer && <>
        {retryOffer.stepCost > 0 && <Text style={ui.small}>Retry travel costs {retryOffer.stepCost.toLocaleString()} steps. You have {data.travelSteps.available.toLocaleString()} available.</Text>}
        <Button label="Try this dungeon again" disabled={data.currentHealth <= 0 || data.travelSteps.available < retryOffer.stepCost} onPress={() => enter(retryOffer.offerId)} />
      </>}
    </Card>}
    <View style={{ gap: 14 }}>
      <Text style={ui.heading}>{data.damageMin}–{data.damageMax} damage · {multiplierLabel(data.damageMultiplier)} pushup power</Text>
      <Text style={ui.body}>{data.today.pushups} pushups today increase your damage until 5 AM device time. Attacks never consume pushups; you can enter even with zero.</Text>
      <Text style={ui.small}>Defeat the boss to secure your bounty. Wins carry health; failed attempts restore entry health and award no loot. Each normal monster has a 20% item chance. Chests may replace monsters: choose to open one, then inspect its contents. Training and equipment take effect on your next expedition.</Text>
      {!active && data.currentHealth <= 0 && <Card>
        <Text style={ui.heading}>Recover health before setting out</Text>
        <Text style={ui.body}>Use a healing potion or equip health bonuses to recover health. Daily health also resets at 5 AM device time.</Text>
        <Button label="Open inventory" onPress={() => router.navigate('/forge')} />
      </Card>}
      <Button secondary label="Train pushups" onPress={() => router.push('/session')} />
    </View>
  </Screen>;
}
