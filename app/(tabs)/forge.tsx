import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { db } from '../../src/db/client';
import { purchasePotion, drinkPotion } from '../../src/db/game';
import { equipItem, sellItem, unequipItem } from '../../src/db/inventory';
import { useGame } from '../../src/game/GameProvider';
import { EQUIPMENT_SLOTS, fitsSlot, itemStatsLabel, SLOT_LABELS } from '../../src/game/equipment';
import { POTIONS, type Potion } from '../../src/game/items';
import { Button, Card, colors, Gold, PageHeading, Screen, ui } from '../../src/ui/theme';

const rarityColor = { common: colors.muted, uncommon: colors.green, rare: colors.purple };

export default function Inventory() {
  const { data, perform } = useGame();
  const { hero, stats, currentHealth, latestBattle, inventory } = data;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [section, setSection] = useState<'gear' | 'supplies'>('gear');
  const selected = inventory.find(item => item.id === selectedId);
  const bag = inventory.filter(item => !item.slot);
  const inDungeon = latestBattle?.status === 'active';
  return <Screen>
    <PageHeading eyebrow="Inventory / spoils of the road" title="Pack & equipment." right={<Gold amount={hero.gold} />} />
    <View style={ui.row}>
      <View style={ui.flex}><Button secondary={section !== 'gear'} label={`Equipment & bag · ${inventory.length}`} onPress={() => setSection('gear')} /></View>
      <View style={ui.flex}><Button secondary={section !== 'supplies'} label="Supplies" onPress={() => setSection('supplies')} /></View>
    </View>
    {section === 'gear' ? <>
      <View style={ui.between}><Text style={ui.heading}>{data.damageMin}–{data.damageMax} damage</Text><Text style={ui.small}>{currentHealth}/{stats.health} HP</Text></View>
      <Text style={ui.body}>Gear shapes your strength. Choose an item to inspect, equip or sell.</Text>
      {inDungeon && <Text accessibilityRole="alert" style={[ui.body, { color: colors.gold }]}>Equipment is locked during an expedition. Return to camp to change or sell items.</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {EQUIPMENT_SLOTS.map(slot => {
          const owned = inventory.find(item => item.slot === slot);
          return <Pressable key={slot} accessibilityRole="button" accessibilityLabel={`${SLOT_LABELS[slot]}: ${owned?.item.name ?? 'Empty'}`}
            disabled={!owned} onPress={() => setSelectedId(owned!.id)}
            style={{ width: '48%', minHeight: 102, gap: 7, padding: 14, backgroundColor: colors.panel,
              borderRadius: 14, borderWidth: 1, borderColor: owned && owned.id === selectedId ? colors.green : colors.border }}>
            <Text style={ui.label}>{SLOT_LABELS[slot]}</Text>
            <Text style={{ color: owned ? rarityColor[owned.item.rarity] : colors.muted, fontWeight: '700' }}>{owned?.item.name ?? 'Empty slot'}</Text>
            <Text style={ui.small}>{owned ? itemStatsLabel(owned.item) : slot === 'weapon' ? 'Unarmed: 5–9 damage' : 'Find gear in dungeons'}</Text>
          </Pressable>;
        })}
      </View>
      {selected && <Modal transparent animationType="fade" onRequestClose={() => setSelectedId(null)}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000aa', padding: 20 }}>
          <ScrollView style={{ maxHeight: '85%', width: '100%', maxWidth: 600 }} contentContainerStyle={{ paddingVertical: 12 }}>
        <Card style={{ borderColor: rarityColor[selected.item.rarity] }}>
        <View style={ui.between}><Text style={[ui.label, { color: rarityColor[selected.item.rarity] }]}>{selected.item.rarity} · {selected.slot ? SLOT_LABELS[selected.slot] : 'In bag'}</Text>
          <Button compact secondary label="Close item" onPress={() => setSelectedId(null)} /></View>
        <Text style={ui.heading}>{selected.item.name}</Text>
        <Text style={ui.body}>{itemStatsLabel(selected.item)}</Text>
        {selected.slot ? <Button label="Unequip to bag" disabled={inDungeon} onPress={() => perform(() => unequipItem(db, selected.slot!))} />
          : EQUIPMENT_SLOTS.filter(slot => fitsSlot(selected.item, slot)).map(slot => {
            const current = inventory.find(owned => owned.slot === slot);
            return <View key={slot} style={{ gap: 8 }}>
              <Text style={ui.small}>{SLOT_LABELS[slot]} now: {current ? `${current.item.name} · ${itemStatsLabel(current.item)}` : 'Empty'}</Text>
              <Button label={`Equip to ${SLOT_LABELS[slot]}`} disabled={inDungeon} onPress={() => perform(() => equipItem(db, selected.id, slot))} />
            </View>;
          })}
        <Button secondary label={`Sell for ${selected.item.sellValue} gold`} disabled={inDungeon || Boolean(selected.slot)}
          onPress={() => { if (perform(() => sellItem(db, selected.id))) setSelectedId(null); }} />
        {selected.slot && <Text style={ui.small}>Unequip before selling.</Text>}
      </Card>
          </ScrollView>
        </View>
      </Modal>}
      <View style={ui.between}><Text style={ui.heading}>Your bag</Text><Text style={ui.small}>{bag.length} {bag.length === 1 ? 'item' : 'items'}</Text></View>
      {bag.length === 0 ? <Card><Text style={ui.body}>Room for your next discovery.</Text><Text style={ui.small}>Enemies can drop equipment. Bosses always reward an item. Defeat the boss to bring your loot home.</Text></Card>
        : bag.map(owned => <Pressable key={owned.id} accessibilityRole="button" accessibilityLabel={`Inspect ${owned.item.name}`} onPress={() => setSelectedId(owned.id)}
          style={{ padding: 16, gap: 8, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: owned.id === selectedId ? colors.green : colors.border }}>
          <View style={ui.between}><Text style={[ui.heading, { flex: 1, color: rarityColor[owned.item.rarity] }]}>{owned.item.name}</Text><Text style={ui.small}>◆ {owned.item.sellValue}</Text></View>
          <Text style={ui.small}>{owned.item.kind} · {itemStatsLabel(owned.item)}</Text>
        </Pressable>)}
    </> : <>
      <Text style={ui.heading}>Supplies for the road</Text>
      <Text style={ui.body}>Buy potions with gold and drink at camp. Unused potions carry over.</Text>
      {(Object.keys(POTIONS) as Potion[]).map(kind => {
        const potion = POTIONS[kind];
        const cannotUse = inDungeon || hero[potion.field] === 0 || (kind === 'health' ? currentHealth === stats.health : hero.focusAttacks > 0);
        return <Card key={kind}>
          <View style={ui.between}><Text style={ui.heading}>{potion.name}</Text><Text style={ui.small}>{hero[potion.field]} owned</Text></View>
          <Text style={ui.body}>{potion.description}</Text>
          {kind === 'efficiency' && <Text style={ui.small}>{hero.focusAttacks} focused attacks remaining. Equipment bonuses stack with focus.</Text>}
          {kind === 'health' && <Text style={ui.small}>{currentHealth} / {stats.health} HP available</Text>}
          <Button secondary label={`Buy ${potion.name.toLowerCase()}  ·  ◆ ${potion.cost} gold`} disabled={hero.gold < potion.cost} onPress={() => perform(() => purchasePotion(db, kind))} />
          <Button label={`Drink ${potion.name.toLowerCase()}`} disabled={cannotUse} onPress={() => perform(() => drinkPotion(db, kind))} />
        </Card>;
      })}
    </>}
  </Screen>;
}
