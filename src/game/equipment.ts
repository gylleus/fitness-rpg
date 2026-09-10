import type { AttackEffect } from './attacks';
import { randomInt, seedFor } from './random';

export const EQUIPMENT_SLOTS = ['weapon', 'armor', 'helmet', 'gloves', 'ring1', 'ring2', 'amulet'] as const;
export type EquipmentSlot = typeof EQUIPMENT_SLOTS[number];
export type ItemKind = Exclude<EquipmentSlot, 'ring1' | 'ring2'> | 'ring';
export const SLOT_LABELS: Record<EquipmentSlot, string> = {
  weapon: 'Weapon', armor: 'Armor', helmet: 'Helmet', gloves: 'Gloves', ring1: 'Ring 1', ring2: 'Ring 2', amulet: 'Amulet',
};
export type GearItem = {
  definitionId: string; name: string; kind: ItemKind; rarity: 'common' | 'uncommon' | 'rare';
  sellValue: number; damageMin?: number; damageMax?: number; health?: number; attackBonus?: number;
  coefficientBonus?: number; effects?: AttackEffect[];
};
export type OwnedItem = { id: number; item: GearItem; slot: EquipmentSlot | null };

// Initial runtime loot pool. Item snapshots keep earned gear stable across balance updates.
export const GEAR: Record<string, GearItem> = {
  wooden_club: { definitionId: 'wooden_club', name: 'Wooden Club', kind: 'weapon', rarity: 'common', damageMin: 20, damageMax: 30, sellValue: 5 },
  travel_wraps: { definitionId: 'travel_wraps', name: 'Travel Wraps', kind: 'armor', rarity: 'common', health: 0, sellValue: 3 },
  iron_club: { definitionId: 'iron_club', name: 'Iron-bound Club', kind: 'weapon', rarity: 'uncommon', damageMin: 24, damageMax: 38, sellValue: 24 },
  hide_armor: { definitionId: 'hide_armor', name: 'Patched Hide Armor', kind: 'armor', rarity: 'common', health: 25, sellValue: 16 },
  iron_helmet: { definitionId: 'iron_helmet', name: 'Dented Iron Helmet', kind: 'helmet', rarity: 'common', health: 15, sellValue: 12 },
  leather_gloves: { definitionId: 'leather_gloves', name: 'Worn Leather Gloves', kind: 'gloves', rarity: 'common', attackBonus: 2, sellValue: 12 },
  copper_ring: { definitionId: 'copper_ring', name: 'Heavy Copper Ring', kind: 'ring', rarity: 'uncommon', attackBonus: 2, health: 5, sellValue: 18 },
  restraint_amulet: { definitionId: 'restraint_amulet', name: 'Amulet of Restraint', kind: 'amulet', rarity: 'rare', coefficientBonus: 0.01, sellValue: 75 },
  root_maul: { definitionId: 'root_maul', name: 'Knotted Root Maul', kind: 'weapon', rarity: 'rare', damageMin: 30, damageMax: 46, sellValue: 45 },
  bark_armor: { definitionId: 'bark_armor', name: 'Bound Bark Armor', kind: 'armor', rarity: 'rare', health: 45, sellValue: 38 },
};

export function fitsSlot(item: GearItem, slot: EquipmentSlot) {
  return EQUIPMENT_SLOTS.includes(slot) && (item.kind === 'ring' ? slot === 'ring1' || slot === 'ring2' : item.kind === slot);
}

/** Preserve the exact old average damage, health and amulet bonuses once. */
export function startingEquipment(swordLevel = 0, armorLevel = 0, amuletOwned = false) {
  const items: { item: GearItem; slot: EquipmentSlot }[] = [
    { slot: 'weapon', item: { ...GEAR.wooden_club, name: swordLevel ? 'Seasoned Wooden Club' : GEAR.wooden_club.name,
      damageMin: 20 + swordLevel * 3, damageMax: 30 + swordLevel * 3, sellValue: 5 + swordLevel * 15 } },
    { slot: 'armor', item: { ...GEAR.travel_wraps, name: armorLevel ? 'Reinforced Travel Wraps' : GEAR.travel_wraps.name,
      health: armorLevel * 20, sellValue: 3 + armorLevel * 15 } },
  ];
  if (amuletOwned) items.push({ slot: 'amulet', item: { ...GEAR.restraint_amulet } });
  return items;
}

export function equipmentBonuses(items: readonly { item: GearItem; slot: EquipmentSlot | null }[]) {
  let damageMin = 5, damageMax = 9, health = 0, attackBonus = 0, coefficientBonus = 0;
  const effects: AttackEffect[] = [];
  for (const slot of EQUIPMENT_SLOTS) {
    const item = items.find(owned => owned.slot === slot)?.item;
    if (!item || !fitsSlot(item, slot)) continue;
    if (slot === 'weapon') { damageMin = item.damageMin!; damageMax = item.damageMax!; }
    health += item.health ?? 0;
    attackBonus += item.attackBonus ?? 0;
    coefficientBonus += item.coefficientBonus ?? 0;
    effects.push(...(item.effects ?? []).map(effect => ({ ...effect, id: `${slot}:${effect.id}` })));
  }
  return { damageMin: damageMin + attackBonus, damageMax: damageMax + attackBonus, health, coefficientBonus, effects };
}

export type LootDrop = { encounter: number; item: GearItem; boss: boolean };
const COMMON_LOOT = ['iron_club', 'hide_armor', 'iron_helmet', 'leather_gloves', 'copper_ring'];
const BOSS_LOOT = ['root_maul', 'bark_armor', 'restraint_amulet'];

/** Each encounter owns a stream: combat length can never reroll its loot. */
export function rollLoot(seed: number, encounter: number, boss: boolean, dungeonId = 0): LootDrop[] {
  let draw = randomInt(seedFor(`loot-v1:${seed}:${encounter}`), 0, 9999);
  if (!boss && draw.value >= 3500) return [];
  const pool = boss ? BOSS_LOOT : COMMON_LOOT;
  draw = randomInt(draw.state, 0, pool.length - 1);
  const base = GEAR[pool[draw.value]];
  const tier = Math.max(0, dungeonId);
  const item = { ...base, sellValue: base.sellValue * (tier + 1) };
  if (tier) {
    item.name = `${base.name} +${tier}`;
    if (item.damageMin !== undefined) { item.damageMin += tier * 12; item.damageMax! += tier * 16; }
    if (item.health) item.health += tier * 25;
    if (item.attackBonus) item.attackBonus += tier * 2;
  }
  return [{ encounter, item, boss }];
}

export function itemStatsLabel(item: GearItem) {
  return [item.damageMin !== undefined ? `${item.damageMin}–${item.damageMax} damage` : '',
    item.health ? `+${item.health} health` : '', item.attackBonus ? `+${item.attackBonus} damage` : '',
    item.coefficientBonus ? `+${Math.round(item.coefficientBonus * 100)}% damage per pushup` : ''].filter(Boolean).join(' · ') || 'No stat bonus';
}
