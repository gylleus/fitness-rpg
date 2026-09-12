import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { itemStatsLabel, upgradeGear, type LootDrop } from '../game/equipment';
import { ItemDetails } from './ItemDetails';
import { ItemIcon, rarityColor } from './ItemIcon';
import { colors, ui } from './theme';

/** The same inspectable item snapshots appear in both expedition result views. */
export function LootRewards({ loot }: { loot: readonly LootDrop[] }) {
  const [selected, setSelected] = useState<LootDrop | null>(null);
  const displayed = loot.map(drop => ({ ...drop, item: upgradeGear(drop.item) }));
  return <View style={{ gap: 10 }}>
    {displayed.map((drop, i) => <Pressable key={i} accessibilityRole="button" accessibilityLabel={`Preview loot ${drop.item.name}`}
      onPress={() => setSelected(drop)} style={{ flexDirection: 'row', gap: 12, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
      <ItemIcon item={drop.item} />
      <View style={ui.flex}><Text style={ui.label}>{drop.boss ? 'Boss reward' : 'Loot'} · In your bag</Text>
        <Text style={[ui.body, { color: rarityColor[drop.item.rarity], fontWeight: '700' }]}>{drop.item.name}</Text>
        <Text style={ui.small}>{itemStatsLabel(drop.item)}</Text>
      </View>
    </Pressable>)}
    {selected && <ItemDetails item={selected.item} onClose={() => setSelected(null)}>
      <Text style={[ui.body, { color: colors.green }]}>Secured in your bag. Equip it from Inventory at camp.</Text>
    </ItemDetails>}
  </View>;
}
