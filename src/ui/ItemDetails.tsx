import type { PropsWithChildren } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { CATEGORY_LABELS, GEAR, itemStatsLabel, modifierLabel, type GearItem } from '../game/equipment';
import { armorReduction, type HeroStats } from '../game/rules';
import { ItemIcon, rarityColor } from './ItemIcon';
import { Button, Card, colors, ui } from './theme';

export function ItemDetails({ item, onClose, children }: PropsWithChildren<{ item: GearItem; onClose: () => void }>) {
  const category = item.category ?? GEAR[item.definitionId]?.category;
  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000bb', padding: 20 }}>
      <Card style={{ maxHeight: '90%', width: '100%', maxWidth: 600, borderColor: rarityColor[item.rarity], overflow: 'hidden' }}>
        <View style={ui.between}>
          <Text style={[ui.label, { flex: 1, color: rarityColor[item.rarity] }]}>{item.rarity} · {category ? CATEGORY_LABELS[category] : item.kind} · Item level {item.itemLevel ?? 1}</Text>
          <Button compact secondary label="Close item" onPress={onClose} />
        </View>
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14, paddingRight: 6 }} keyboardShouldPersistTaps="handled">
          <View style={ui.row}><ItemIcon item={item} size={96} /><View style={ui.flex}>
            <Text style={[ui.heading, { color: rarityColor[item.rarity] }]}>{item.name}</Text>
            <Text style={ui.small}>◆ {item.sellValue} sell value</Text>
          </View></View>
          <Text style={ui.body}>{itemStatsLabel(item)}</Text>
          {(item.modifiers ?? []).filter(modifier => modifier.affix).map((modifier, i) =>
            <Text key={i} style={[ui.small, { color: colors.green }]}>{modifier.affix} · {modifierLabel(modifier)}</Text>)}
          {(item.visualDescription ?? GEAR[item.definitionId]?.visualDescription) &&
            <Text style={ui.small}>{item.visualDescription ?? GEAR[item.definitionId]?.visualDescription}</Text>}
          {children}
        </ScrollView>
      </Card>
    </View>
  </Modal>;
}

export function EquipmentComparison({ before, after }: { before: HeroStats; after: HeroStats }) {
  const rows = [
    ['Damage', before.attack, after.attack], ['Max health', before.health, after.health],
    ['Armor', before.armor ?? 0, after.armor ?? 0],
    ['Damage reduction %', armorReduction(before.armor) * 100, armorReduction(after.armor) * 100],
    ['Per pushup %', before.pushupDamageCoefficient * 100, after.pushupDamageCoefficient * 100],
    ['Crit chance %', (before.critChanceBps ?? 0) / 100, (after.critChanceBps ?? 0) / 100],
    ['Crit damage %', (before.critMultiplierBps ?? 15000) / 100, (after.critMultiplierBps ?? 15000) / 100],
  ] as const;
  const changed = rows.filter(([, from, to]) => Math.abs(to - from) > .00001);
  const number = (n: number) => Number(n.toFixed(2));
  return <View testID="equipment-comparison" style={{ gap: 5 }}>
    {changed.length === 0 ? <Text style={ui.small}>Same total stats.</Text> : changed.map(([label, from, to]) =>
      <View key={label} style={[ui.between, { flexWrap: 'wrap', rowGap: 2 }]}><Text style={ui.small}>{label}</Text>
        <Text style={[ui.small, { flexGrow: 1, textAlign: 'right', color: to > from ? colors.green : colors.red }]}>{number(from)} → {number(to)} ({to > from ? '+' : ''}{number(to - from)})</Text>
      </View>)}
    <Text style={ui.small}>Damage compares an average hit before criticals, using your current pushup power.</Text>
  </View>;
}
