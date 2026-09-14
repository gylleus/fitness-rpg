import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { db } from '../../src/db/client';
import { purchasePotion, drinkPotion } from '../../src/db/game';
import { equipItem, sellItem, unequipItem } from '../../src/db/inventory';
import { useGame } from '../../src/game/GameProvider';
import { CATEGORY_LABELS, EQUIPMENT_SLOTS, fitsSlot, itemStatsLabel, previewEquipment, SLOT_LABELS, type ItemCategory } from '../../src/game/equipment';
import { armorReduction, heroStats } from '../../src/game/rules';
import { POTIONS, type Potion } from '../../src/game/items';
import { Button, Card, colors, Gold, PageHeading, Screen, ui } from '../../src/ui/theme';
import { EquipmentComparison, ItemDetails } from '../../src/ui/ItemDetails';
import { ItemIcon, rarityColor } from '../../src/ui/ItemIcon';

export default function Inventory() {
  const { data, perform } = useGame();
  const { hero, stats, currentHealth, latestBattle, inventory } = data;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [section, setSection] = useState<'gear' | 'supplies'>('gear');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ItemCategory | 'all'>('all');
  const [sort, setSort] = useState<'newest' | 'rarity' | 'name' | 'value'>('newest');
  const [visibleCount, setVisibleCount] = useState(24);
  const selected = inventory.find(item => item.id === selectedId);
  const bag = inventory.filter(item => !item.slot);
  const rarityOrder = { common: 0, uncommon: 1, rare: 2, epic: 3 };
  const filtered = bag.filter(({ item }) => (category === 'all' || item.category === category) &&
    `${item.name} ${item.rarity} ${itemStatsLabel(item)}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.item.name.localeCompare(b.item.name) : sort === 'value' ? b.item.sellValue - a.item.sellValue || b.id - a.id
      : sort === 'rarity' ? rarityOrder[b.item.rarity] - rarityOrder[a.item.rarity] || b.id - a.id : b.id - a.id);
  const inDungeon = latestBattle?.status === 'active';
  return <Screen>
    <PageHeading eyebrow="Inventory / spoils of the road" title="Pack & equipment." right={<Gold amount={hero.gold} />} />
    <View style={ui.row}>
      <View style={ui.flex}><Button secondary={section !== 'gear'} label={`Equipment & bag · ${inventory.length}`} onPress={() => setSection('gear')} /></View>
      <View style={ui.flex}><Button secondary={section !== 'supplies'} label="Supplies" onPress={() => setSection('supplies')} /></View>
    </View>
    {section === 'gear' ? <>
      <View style={ui.between}><Text style={ui.heading}>{data.damageMin}–{data.damageMax} damage</Text><Text style={ui.small}>{currentHealth}/{stats.health} HP</Text></View>
      <Card>
        <Text style={ui.heading}>{stats.armor ?? 0} armor · {(armorReduction(stats.armor) * 100).toFixed(1)}% damage reduction</Text>
        <Text style={ui.small}>{((stats.critChanceBps ?? 0) / 100).toFixed(1)}% crit chance · {((stats.critMultiplierBps ?? 15000) / 10000).toFixed(2)}× critical damage</Text>
        <Text style={ui.small}>Each pushup adds {Number((stats.pushupDamageCoefficient * 100).toFixed(2))}% damage. Armor reduces incoming hits, up to 75%; health bonuses increase maximum HP separately.</Text>
      </Card>
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
            <View style={ui.row}>{owned && <ItemIcon item={owned.item} size={48} />}<Text style={{ flex: 1, color: owned ? rarityColor[owned.item.rarity] : colors.muted, fontWeight: '700' }}>{owned?.item.name ?? 'Empty slot'}</Text></View>
            <Text style={ui.small}>{owned ? itemStatsLabel(owned.item) : slot === 'weapon' ? 'Unarmed: 5–9 damage' : 'Find gear in dungeons'}</Text>
          </Pressable>;
        })}
      </View>
      {selected && <ItemDetails item={selected.item} onClose={() => setSelectedId(null)}>
        <Text style={ui.label}>{selected.slot ? `Equipped · ${SLOT_LABELS[selected.slot]}` : 'In bag'}</Text>
        {selected.slot ? <Button label="Unequip to bag" disabled={inDungeon} onPress={() => perform(() => unequipItem(db, selected.slot!))} />
          : EQUIPMENT_SLOTS.filter(slot => fitsSlot(selected.item, slot)).map(slot => {
            const current = inventory.find(owned => owned.slot === slot);
            return <View key={slot} style={{ gap: 8 }}>
              <Text style={ui.small}>{SLOT_LABELS[slot]} now: {current ? `${current.item.name} · ${itemStatsLabel(current.item)}` : 'Empty'}</Text>
              <EquipmentComparison before={stats} after={heroStats(hero, data.today, stats.pushups, previewEquipment(inventory, selected, slot))} />
              <Button label={`Equip to ${SLOT_LABELS[slot]}`} disabled={inDungeon} onPress={() => perform(() => equipItem(db, selected.id, slot))} />
            </View>;
          })}
        <Button secondary label={`Sell for ${selected.item.sellValue} gold`} disabled={inDungeon || Boolean(selected.slot)}
          onPress={() => { if (perform(() => sellItem(db, selected.id))) setSelectedId(null); }} />
        {selected.slot && <Text style={ui.small}>Unequip before selling.</Text>}
      </ItemDetails>}
      <View style={ui.between}><Text style={ui.heading}>Your bag</Text><Text style={ui.small}>{bag.length} {bag.length === 1 ? 'item' : 'items'}</Text></View>
      {bag.length > 0 && <>
        <TextInput accessibilityLabel="Search your bag" placeholder="Search items, stats or rarity" placeholderTextColor={colors.muted}
          value={query} onChangeText={value => { setQuery(value); setVisibleCount(24); }}
          style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14 }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(['all', ...Object.keys(CATEGORY_LABELS)] as (ItemCategory | 'all')[]).map(value =>
            <Button key={value} compact secondary={category !== value} label={value === 'all' ? 'All gear' : CATEGORY_LABELS[value]}
              onPress={() => { setCategory(value); setVisibleCount(24); }} />)}
        </ScrollView>
        <View style={[ui.row, { flexWrap: 'wrap' }]}>
          {(['newest', 'rarity', 'name', 'value'] as const).map(value => <Button key={value} compact secondary={sort !== value}
            label={`Sort: ${value}`} onPress={() => { setSort(value); setVisibleCount(24); }} />)}
        </View>
        <Text style={ui.small}>{filtered.length} matching {filtered.length === 1 ? 'item' : 'items'}</Text>
      </>}
      {bag.length === 0 ? <Card><Text style={ui.body}>Room for your next discovery.</Text><Text style={ui.small}>Enemies can drop equipment. Bosses always reward an item. Defeat the boss to bring your loot home.</Text></Card>
        : filtered.slice(0, visibleCount).map(owned => <Pressable key={owned.id} accessibilityRole="button" accessibilityLabel={`Inspect ${owned.item.name}`} onPress={() => setSelectedId(owned.id)}
          style={{ padding: 16, gap: 8, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: owned.id === selectedId ? colors.green : colors.border }}>
          <View style={ui.row}><ItemIcon item={owned.item} /><View style={ui.flex}>
          <View style={ui.between}><Text style={[ui.heading, { flex: 1, color: rarityColor[owned.item.rarity] }]}>{owned.item.name}</Text><Text style={ui.small}>◆ {owned.item.sellValue}</Text></View>
          <Text style={ui.small}>Item level {owned.item.itemLevel ?? 1} · {owned.item.kind} · {itemStatsLabel(owned.item)}</Text>
          </View></View>
        </Pressable>)}
      {bag.length > 0 && filtered.length === 0 && <Text style={ui.body}>No items match this search.</Text>}
      {filtered.length > visibleCount && <Button secondary label="Show more items" onPress={() => setVisibleCount(count => count + 24)} />}
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
