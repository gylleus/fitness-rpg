/** Store hundredths of a pushup: 10% efficiency spends exactly 90 units. */
export const PUSHUP_UNITS = 100;
export const AMULET = { name: 'Amulet of Restraint', cost: 150, reduction: 10, unlockDungeon: 1 } as const;
export const POTIONS = {
  health: { name: 'Healing potion', cost: 30, description: 'Restore up to 40 HP at camp.', field: 'healthPotions' },
  efficiency: { name: 'Focus potion', cost: 25, description: 'Use 20% fewer pushups for your next 10 attacks.', field: 'focusPotions' },
} as const;
export type Potion = keyof typeof POTIONS;
export const FOCUS_ATTACKS = 10;
export const HEALING_HP = 40;

export function attackCostUnits(baseCost: number, focusAttacks: number) {
  return Math.max(50, baseCost - (focusAttacks > 0 ? 20 : 0));
}

export function attacksAvailable(units: number, baseCost: number, focusAttacks: number) {
  const focusedCost = attackCostUnits(baseCost, focusAttacks);
  const focused = Math.min(focusAttacks, Math.floor(units / focusedCost));
  return focused + Math.floor((units - focused * focusedCost) / baseCost);
}

export const pushupLabel = (units: number) => (units / PUSHUP_UNITS).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const percentLabel = (bps: number) => `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
