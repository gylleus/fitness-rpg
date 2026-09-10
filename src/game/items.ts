/** Retained only for reading historical stockpile saves. */
export const PUSHUP_UNITS = 100;
export const BASE_PUSHUP_DAMAGE_COEFFICIENT = 0.1;
export const AMULET = { name: 'Amulet of Restraint', cost: 150, coefficientBonus: 0.01, unlockDungeon: 1 } as const;
export const POTIONS = {
  health: { name: 'Healing potion', cost: 30, description: 'Restore up to 40 HP at camp.', field: 'healthPotions' },
  efficiency: { name: 'Focus potion', cost: 25, description: 'Add 2 percentage points to the damage bonus per pushup for your next 10 attacks.', field: 'focusPotions' },
} as const;
export type Potion = keyof typeof POTIONS;
export const FOCUS_ATTACKS = 10;
export const FOCUS_COEFFICIENT_BONUS = 0.02;
export const HEALING_HP = 40;

export const multiplierLabel = (multiplier: number) => `${multiplier.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;
export const percentLabel = (bps: number) => `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
