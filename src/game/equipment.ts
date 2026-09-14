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
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic';
export type GearItem = {
  version?: 2; definitionId: string; name: string; kind: ItemKind; rarity: ItemRarity;
  category?: ItemCategory; tier?: number; description?: string; visualDescription?: string;
  /** Absent on historical snapshots; independent of the catalog's visual tier. */
  itemLevel?: number;
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
  const definition = GEAR[item.definitionId];
  const itemLevel = validItemLevel(item.itemLevel ?? item.tier ?? definition?.tier ?? 1);
  if (item.version === 2) return item.itemLevel === itemLevel ? item : { ...item, itemLevel };
  const armor = item.armor ?? (item.definitionId === 'travel_wraps'
    ? 2 + Math.floor((item.health ?? 0) / 20) * 8 : definition?.armor);
  return { ...item, version: 2, itemLevel, category: item.category ?? definition?.category,
    tier: item.tier ?? definition?.tier, description: item.description ?? definition?.description,
    visualDescription: item.visualDescription ?? definition?.visualDescription, armor };
}

/** Preserve old paid upgrades once, with their health kept as a separate bonus. */
export function startingEquipment(swordLevel = 0, armorLevel = 0, amuletOwned = false) {
  const items: { item: GearItem; slot: EquipmentSlot }[] = [
    { slot: 'weapon', item: { ...GEAR.wooden_club, itemLevel: 1, name: swordLevel ? 'Seasoned Wooden Club' : GEAR.wooden_club.name,
      damageMin: 20 + swordLevel * 3, damageMax: 30 + swordLevel * 3, sellValue: 5 + swordLevel * 15 } },
    { slot: 'armor', item: { ...GEAR.travel_wraps, itemLevel: 1, name: armorLevel ? 'Reinforced Travel Wraps' : GEAR.travel_wraps.name,
      armor: 2 + armorLevel * 8, health: armorLevel * 20, sellValue: 3 + armorLevel * 15 } },
  ];
  if (amuletOwned) items.push({ slot: 'amulet', item: { ...GEAR.restraint_amulet, itemLevel: 1 } });
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

export type LootDrop = { encounter: number; item: GearItem; boss: boolean; source?: 'enemy' | 'chest' };
export type LootDifficulty = 'normal' | 'heroic' | 'mythic';
export type LootOptions = { difficulty?: LootDifficulty; level?: number; chest?: boolean };
const AFFIXES: { prefix: string; suffix: string; stat: ModifierStat; min: number; max: number; scale?: number }[] = [
  { prefix: 'Vital', suffix: 'of Vigor', stat: 'health', min: 5, max: 12 },
  { prefix: 'Crushing', suffix: 'of Impact', stat: 'damage', min: 1, max: 3 },
  { prefix: 'Stalwart', suffix: 'of Warding', stat: 'armor', min: 2, max: 6 },
  { prefix: 'Disciplined', suffix: 'of Discipline', stat: 'pushup_damage_coefficient', min: 1, max: 3, scale: 0.0025 },
  { prefix: 'Keen', suffix: 'of the Seer', stat: 'crit_chance_bps', min: 1, max: 3, scale: 100 },
  { prefix: 'Ruinous', suffix: 'of Cataclysm', stat: 'crit_damage_bps', min: 5, max: 15, scale: 100 },
];
const RARITIES: readonly ItemRarity[] = ['common', 'uncommon', 'rare', 'epic'];
/** Basis-point weights conditional on receiving an item, ordered like RARITIES. */
const LOOT_WEIGHTS: Record<LootDifficulty, readonly number[]> = {
  normal: [8000, 1850, 145, 5], heroic: [5000, 4300, 680, 20], mythic: [3500, 5000, 1450, 50],
};
const BOSS_WEIGHTS: Record<LootDifficulty, readonly number[]> = {
  normal: [0, 9700, 295, 5], heroic: [0, 0, 9950, 50], mythic: [0, 0, 9800, 200],
};
const LOOT_BASES = [1, 2, 3].map(tier => Object.values(GEAR).filter(item => item.tier === tier && item.rarity === 'common'));
const validItemLevel = (level: number) => Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;

/** Each encounter owns a stream; saved lootPlan retains old items and rolls.
 * Mobs drop an item 20% of the time; bosses and unopened chests guarantee one.
 * The old dungeon ID is only a level fallback, never an item's power ceiling. */
export function rollLoot(seed: number, encounter: number, boss: boolean, dungeonId = 0, options: LootOptions = {}): LootDrop[] {
  const difficulty = options.difficulty ?? 'normal';
  const dungeonLevel = validItemLevel(options.level ?? dungeonId + 1);
  const source = options.chest ? 'chest' : 'enemy';
  let state = seedFor(`loot-v3:${seed}:${encounter}:${source}`);
  const draw = (min: number, max: number) => { const next = randomInt(state, min, max); state = next.state; return next.value; };
  if (!boss && !options.chest && draw(0, 9999) >= 2000) return [];
  let rarityRoll = draw(0, 9999);
  const weights = boss ? BOSS_WEIGHTS[difficulty] : LOOT_WEIGHTS[difficulty];
  const rarity = RARITIES.find((_, index) => (rarityRoll -= weights[index]) < 0)!;
  const itemLevel = Math.max(1, dungeonLevel + draw(-1, 1));
  const tier = Math.min(3, 1 + Math.floor((itemLevel - 1) / 5));
  const pool = LOOT_BASES[tier - 1];
  const base = pool[draw(0, pool.length - 1)];
  const levelScale = 1 + (itemLevel - 1) * .12;
  // Catalog tiers describe existing artwork and baseline power at levels 1/6/11.
  const intrinsicScale = levelScale / (1 + (tier - 1) * .6);
  const modifiers: ItemModifier[] = [];
  const available = [...AFFIXES];
  const rollAffix = (position: 'prefix' | 'suffix') => {
    const [affix] = available.splice(draw(0, available.length - 1), 1);
    const raw = draw(affix.min, affix.max) * levelScale * (rarity === 'epic' ? 1.5 : 1) * (affix.scale ?? 1);
    const value = affix.stat === 'pushup_damage_coefficient' ? Math.round(raw * 10000) / 10000 : Math.round(raw);
    modifiers.push({ stat: affix.stat, value, affix: affix[position] });
    return affix[position];
  };
  const prefix = rarity === 'rare' || rarity === 'epic' ? rollAffix('prefix') : '';
  const suffix = rarity !== 'common' ? rollAffix('suffix') : '';
  // Copy only intrinsic properties. Old common definitions can contain magical
  // bonuses; those remain on earned snapshots but never leak into fresh rolls.
  const item: GearItem = { version: 2, definitionId: base.definitionId, kind: base.kind,
    category: base.category, weaponType: base.weaponType, tier, itemLevel, rarity,
    name: [prefix, base.name, suffix].filter(Boolean).join(' '),
    description: base.description, visualDescription: base.visualDescription,
    damageMin: base.damageMin === undefined ? undefined : Math.max(1, Math.round(base.damageMin * intrinsicScale)),
    damageMax: base.damageMax === undefined ? undefined : Math.max(1, Math.round(base.damageMax * intrinsicScale)),
    armor: base.armor === undefined ? undefined : Math.max(1, Math.round(base.armor * intrinsicScale)),
    modifiers, sellValue: Math.max(1, Math.round(base.sellValue * intrinsicScale + modifiers.length * 5 * levelScale * (rarity === 'epic' ? 1.5 : 1))),
  };
  return [{ encounter, item, boss, source }];
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
