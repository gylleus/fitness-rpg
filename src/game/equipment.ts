import type { AttackEffect } from './attacks';
import catalog from './catalog/items.json';
import { randomInt, seedFor } from './random';
import { categoryWeaponType, isWeaponType, type WeaponType } from './weapons';

export const EQUIPMENT_SLOTS = ['weapon', 'armor', 'helmet', 'gloves', 'ring1', 'ring2', 'amulet'] as const;
export type EquipmentSlot = typeof EQUIPMENT_SLOTS[number];
export type ItemKind = Exclude<EquipmentSlot, 'ring1' | 'ring2'> | 'ring';
export type ItemCategory = 'maces' | 'swords' | 'axes' | 'fist_weapons' | 'body_armor' | 'helmets' | 'gloves' | 'rings' | 'amulets';
export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  maces: 'Maces', swords: 'Swords', axes: 'Axes', fist_weapons: 'Fist weapons', body_armor: 'Body armor', helmets: 'Helmets', gloves: 'Gloves', rings: 'Rings', amulets: 'Amulets',
};
export const SLOT_LABELS: Record<EquipmentSlot, string> = {
  weapon: 'Weapon', armor: 'Armor', helmet: 'Helmet', gloves: 'Gloves', ring1: 'Ring 1', ring2: 'Ring 2', amulet: 'Amulet',
};
export type ModifierStat = 'health' | 'damage' | 'armor' | 'pushup_damage_coefficient' | 'crit_chance_bps' | 'crit_damage_bps';
export type ItemModifier = { stat: ModifierStat; value: number; affix?: string };
export type GearItem = {
  version?: 2; definitionId: string; name: string; kind: ItemKind; rarity: 'common' | 'uncommon' | 'rare';
  category?: ItemCategory; tier?: number; description?: string; visualDescription?: string;
  /** Optional only because historical earned-item snapshots predate classes. */
  weaponType?: WeaponType;
  sellValue: number; damageMin?: number; damageMax?: number; armor?: number; modifiers?: ItemModifier[];
  /** Legacy flat bonuses remain readable so earned gear and saved runs survive. */
  health?: number; attackBonus?: number; coefficientBonus?: number; effects?: AttackEffect[];
};
export type OwnedItem = { id: number; item: GearItem; slot: EquipmentSlot | null };

/** Generated from validated content/items TOML; earned gear stores a snapshot. */
export const GEAR: Record<string, GearItem> = catalog.items as Record<string, GearItem>;

/** Resolve metadata without replacing any saved rolls, names or bonuses. */
export function itemWeaponType(item: GearItem | undefined): WeaponType | undefined {
  if (item?.kind !== 'weapon') return undefined;
  if (isWeaponType(item.weaponType)) return item.weaponType;
  return categoryWeaponType(item.category) ?? GEAR[item.definitionId]?.weaponType ?? 'mace';
}

export function equippedWeaponType(items: readonly { item: GearItem; slot: EquipmentSlot | null }[]): WeaponType {
  return itemWeaponType(items.find(owned => owned.slot === 'weapon')?.item) ?? 'fist';
}

export function fitsSlot(item: GearItem, slot: EquipmentSlot) {
  return EQUIPMENT_SLOTS.includes(slot) && (item.kind === 'ring' ? slot === 'ring1' || slot === 'ring2' : item.kind === slot);
}

/** Preview precisely the swap the database will perform, including two rings. */
export function previewEquipment(inventory: readonly OwnedItem[], selected: OwnedItem, slot: EquipmentSlot) {
  if (!fitsSlot(selected.item, slot)) throw new Error('This item does not fit that equipment slot.');
  return inventory.map(owned => ({ item: owned.item,
    slot: owned.id === selected.id ? slot : owned.slot === slot ? null : owned.slot }));
}

/** Add armor to known pre-catalog gear without erasing paid-for health bonuses.
 * Never replace saved rolls, rarity, name, price, effects or damage from GEAR. */
export function upgradeGear(item: GearItem): GearItem {
  if (item.version === 2) return item;
  const definition = GEAR[item.definitionId];
  const armor = item.armor ?? (item.definitionId === 'travel_wraps'
    ? 2 + Math.floor((item.health ?? 0) / 20) * 8 : definition?.armor);
  return { ...item, version: 2, category: item.category ?? definition?.category,
    tier: item.tier ?? definition?.tier, description: item.description ?? definition?.description,
    visualDescription: item.visualDescription ?? definition?.visualDescription, armor };
}

/** Preserve old paid upgrades once, with their health kept as a separate bonus. */
export function startingEquipment(swordLevel = 0, armorLevel = 0, amuletOwned = false) {
  const items: { item: GearItem; slot: EquipmentSlot }[] = [
    { slot: 'weapon', item: { ...GEAR.wooden_club, name: swordLevel ? 'Seasoned Wooden Club' : GEAR.wooden_club.name,
      damageMin: 20 + swordLevel * 3, damageMax: 30 + swordLevel * 3, sellValue: 5 + swordLevel * 15 } },
    { slot: 'armor', item: { ...GEAR.travel_wraps, name: armorLevel ? 'Reinforced Travel Wraps' : GEAR.travel_wraps.name,
      armor: 2 + armorLevel * 8, health: armorLevel * 20, sellValue: 3 + armorLevel * 15 } },
  ];
  if (amuletOwned) items.push({ slot: 'amulet', item: { ...GEAR.restraint_amulet } });
  return items;
}

export function itemBonuses(item: GearItem) {
  const result = { health: item.health ?? 0, damage: item.attackBonus ?? 0, armor: item.armor ?? 0,
    pushup_damage_coefficient: item.coefficientBonus ?? 0, crit_chance_bps: 0, crit_damage_bps: 0 };
  for (const modifier of item.modifiers ?? []) result[modifier.stat] += modifier.value;
  result.pushup_damage_coefficient = Math.round(result.pushup_damage_coefficient * 10000) / 10000;
  return result;
}

export function equipmentBonuses(items: readonly { item: GearItem; slot: EquipmentSlot | null }[]) {
  let damageMin = 5, damageMax = 9, health = 0, attackBonus = 0, armor = 0, coefficientBps = 0, critChanceBps = 0, critDamageBps = 0;
  const effects: AttackEffect[] = [];
  for (const slot of EQUIPMENT_SLOTS) {
    const item = items.find(owned => owned.slot === slot)?.item;
    if (!item || !fitsSlot(item, slot)) continue;
    if (slot === 'weapon') { damageMin = item.damageMin ?? 5; damageMax = item.damageMax ?? 9; }
    const bonus = itemBonuses(item);
    health += bonus.health;
    armor += bonus.armor;
    attackBonus += bonus.damage;
    coefficientBps += Math.round(bonus.pushup_damage_coefficient * 10000);
    critChanceBps += bonus.crit_chance_bps;
    critDamageBps += bonus.crit_damage_bps;
    effects.push(...(item.effects ?? []).map(effect => ({ ...effect, id: `${slot}:${effect.id}` })));
  }
  critChanceBps = Math.max(0, Math.min(10000, critChanceBps));
  const critMultiplierBps = 15000 + Math.max(0, Math.min(35000, critDamageBps));
  if (critChanceBps > 0) effects.push({ id: 'equipment:critical', name: 'Critical strike', trigger: 'onAttack',
    kind: 'critical', rateBps: critChanceBps, multiplierBps: critMultiplierBps });
  return { damageMin: damageMin + attackBonus, damageMax: damageMax + attackBonus, health, armor,
    coefficientBonus: coefficientBps / 10000, critChanceBps, critMultiplierBps, effects };
}

export type LootDrop = { encounter: number; item: GearItem; boss: boolean };
const AFFIXES: { name: string; stat: ModifierStat; min: number; max: number; scale?: number }[] = [
  { name: 'of Vigor', stat: 'health', min: 5, max: 12 },
  { name: 'of Impact', stat: 'damage', min: 1, max: 3 },
  { name: 'of Warding', stat: 'armor', min: 2, max: 6 },
  { name: 'of Discipline', stat: 'pushup_damage_coefficient', min: 1, max: 3, scale: 0.0025 },
  { name: 'of Precision', stat: 'crit_chance_bps', min: 1, max: 3, scale: 100 },
  { name: 'of Ruin', stat: 'crit_damage_bps', min: 5, max: 15, scale: 100 },
];

/** Each encounter owns a stream; saved lootPlan retains old items and rolls.
 * Tier matches the chapter, common/uncommon/rare weights are 60/30/10, and
 * bosses guarantee rare gear. A rare receives two distinct rolled modifiers. */
export function rollLoot(seed: number, encounter: number, boss: boolean, dungeonId = 0): LootDrop[] {
  let state = seedFor(`loot-v2:${seed}:${encounter}`);
  const draw = (min: number, max: number) => { const next = randomInt(state, min, max); state = next.state; return next.value; };
  if (!boss && draw(0, 9999) >= 3500) return [];
  const tier = Math.max(1, Math.min(3, Math.floor(dungeonId) + 1));
  const rarityRoll = draw(0, 99);
  const rarity = boss || rarityRoll >= 90 ? 'rare' : rarityRoll >= 60 ? 'uncommon' : 'common';
  const pool = Object.values(GEAR).filter(item => item.tier === tier && item.rarity === rarity);
  const base = pool[draw(0, pool.length - 1)];
  const modifiers = (base.modifiers ?? []).map(modifier => ({ ...modifier }));
  const available = [...AFFIXES];
  const affixCount = rarity === 'rare' ? 2 : rarity === 'uncommon' ? 1 : 0;
  const affixNames: string[] = [];
  for (let i = 0; i < affixCount; i++) {
    const [affix] = available.splice(draw(0, available.length - 1), 1);
    const value = Math.round(draw(affix.min, affix.max) * tier * (affix.scale ?? 1) * 10000) / 10000;
    modifiers.push({ stat: affix.stat, value, affix: affix.name });
    affixNames.push(affix.name.replace(/^of /, ''));
  }
  const item: GearItem = { ...base, modifiers, sellValue: base.sellValue + affixCount * 5 * tier,
    name: affixNames.length ? `${base.name} of ${affixNames.join(' & ')}` : base.name };
  return [{ encounter, item, boss }];
}

const percent = (value: number) => Number(value.toFixed(2)).toString();
export function modifierLabel(modifier: Pick<ItemModifier, 'stat' | 'value'>) {
  const { stat, value } = modifier;
  switch (stat) {
    case 'health': return `+${value} health`;
    case 'armor': return `+${value} armor`;
    case 'damage': return `+${value} damage`;
    case 'pushup_damage_coefficient': return `+${percent(value * 100)}% damage per pushup`;
    case 'crit_chance_bps': return `+${percent(value / 100)}% crit chance`;
    case 'crit_damage_bps': return `+${percent(value / 100)}% crit damage`;
  }
}

export function itemStatsLabel(item: GearItem) {
  return [item.damageMin !== undefined ? `${item.damageMin}–${item.damageMax} damage` : '',
    item.armor ? `${item.armor} armor` : '', item.health ? `+${item.health} health` : '',
    item.attackBonus ? `+${item.attackBonus} damage` : '',
    item.coefficientBonus ? modifierLabel({ stat: 'pushup_damage_coefficient', value: item.coefficientBonus }) : '',
    ...(item.modifiers ?? []).map(modifierLabel)].filter(Boolean).join(' · ') || 'No stat bonus';
}
