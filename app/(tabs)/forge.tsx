import { Text, View } from 'react-native';
import { db } from '../../src/db/client';
import { purchaseAmulet, purchasePotion, purchaseUpgrade, drinkPotion } from '../../src/db/game';
import { useGame } from '../../src/game/GameProvider';
import { upgradeCost } from '../../src/game/rules';
import { AMULET, POTIONS, type Potion } from '../../src/game/items';
import { PixelSprite } from '../../src/ui/PixelSprite';
import { Button, Card, colors, Gold, PageHeading, Screen, ui } from '../../src/ui/theme';

export default function Forge() {
  const { data: { hero, stats, currentHealth, latestBattle }, perform } = useGame();
  const inDungeon = latestBattle?.status === 'active';
  return <Screen>
    <PageHeading eyebrow="The forge / permanent power" title="Built to last." right={<Gold amount={hero.gold} />} />
    <Text style={ui.body}>Turn your dungeon spoils into stronger gear. Every upgrade stays with you tomorrow.</Text>
    {([
      { kind: 'sword', name: 'Training Blade', level: hero.swordLevel, bonus: 3, stat: 'attack', color: colors.gold },
      { kind: 'armor', name: "Traveler’s Armor", level: hero.armorLevel, bonus: 20, stat: 'health', color: colors.purple },
    ] as const).map((item) => {
      const cost = upgradeCost(item.level);
      const affordable = hero.gold >= cost;
      return <Card key={item.kind}>
        <Text style={[ui.label, { color: item.color }]}>Equipped · upgrade {item.level}</Text>
        <View style={{ backgroundColor: colors.bg, borderRadius: 16, alignItems: 'center', paddingVertical: 24 }}><PixelSprite kind={item.kind} size={128} tint={item.kind === 'sword' ? colors.green : '#829cb4'} /></View>
        <Text style={ui.heading}>{item.name}</Text>
        <View style={ui.between}><Text style={ui.body}>Permanent {item.stat}</Text><Text style={{ color: item.color, fontSize: 20, fontWeight: '700' }}>+{item.level * item.bonus}</Text></View>
        <View style={ui.divider} />
        <View style={ui.between}><Text style={ui.body}>Next upgrade</Text><Text style={[ui.body, { color: colors.green }]}>+{item.bonus} {item.stat}</Text></View>
        <Button label={affordable ? `Upgrade  ·  ◆ ${cost} gold` : `Need ${cost - hero.gold} more gold  ·  ◆ ${cost}`} disabled={!affordable} onPress={() => perform(() => purchaseUpgrade(db, item.kind))} />
      </Card>;
    })}
    <Card>
      <Text style={[ui.label, { color: colors.purple }]}>Rare amulet · {hero.amuletOwned ? 'Equipped' : 'Merchant stock'}</Text>
      <Text style={ui.heading}>{AMULET.name}</Text>
      <Text style={ui.body}>Permanently add 1 percentage point to the damage bonus per pushup: 10% becomes 11%.</Text>
      <Text style={ui.small}>Unlocked by defeating the Root Hulk. A guaranteed purchase; no random drops.</Text>
      <Button label={hero.amuletOwned ? 'Amulet equipped ✓' : hero.unlockedDungeon < AMULET.unlockDungeon ? 'Defeat the Root Hulk to unlock' : `Buy amulet  ·  ◆ ${AMULET.cost} gold`}
        disabled={hero.amuletOwned || hero.unlockedDungeon < AMULET.unlockDungeon || hero.gold < AMULET.cost}
        onPress={() => perform(() => purchaseAmulet(db))} />
    </Card>
    <Text style={ui.heading}>Potions for the road</Text>
    <Text style={ui.body}>Buy with gold and drink at camp. Stored potions and unused focus attacks carry over to tomorrow.</Text>
    {(Object.keys(POTIONS) as Potion[]).map(kind => {
      const potion = POTIONS[kind];
      const cannotUse = inDungeon || hero[potion.field] === 0 || (kind === 'health' ? currentHealth === stats.health : hero.focusAttacks > 0);
      return <Card key={kind}>
        <View style={ui.between}><Text style={ui.heading}>{potion.name}</Text><Text style={ui.small}>{hero[potion.field]} owned</Text></View>
        <Text style={ui.body}>{potion.description}</Text>
        {kind === 'efficiency' && <Text style={ui.small}>Stacks with the amulet: each pushup adds 13% damage while focused. {hero.focusAttacks > 0 ? `${hero.focusAttacks} focused attacks remaining.` : 'One focus potion active at a time.'}</Text>}
        {kind === 'health' && <Text style={ui.small}>{currentHealth} / {stats.health} HP available</Text>}
        <Button secondary label={`Buy ${potion.name.toLowerCase()}  ·  ◆ ${potion.cost} gold`} disabled={hero.gold < potion.cost} onPress={() => perform(() => purchasePotion(db, kind))} />
        <Button label={`Drink ${potion.name.toLowerCase()}`} disabled={cannotUse} onPress={() => perform(() => drinkPotion(db, kind))} />
        {inDungeon && <Text style={ui.small}>Finish or retreat from your expedition to drink a potion.</Text>}
      </Card>;
    })}
    <Card><Text style={ui.heading}>Your foundation</Text><Text style={ui.body}>{stats.baseAttack} damage per hit · {stats.baseHealth} health from your hero and equipment.</Text><Text style={ui.small}>Earn gold from boss victories and daily quests. Adventure levels add +1 damage and +5 health per level. Gear upgrades take effect on your next expedition.</Text></Card>
  </Screen>;
}
