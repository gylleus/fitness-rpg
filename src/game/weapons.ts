/** A visual weapon class shared by all item designs in that family. */
export const WEAPON_TYPES = ['mace', 'axe', 'sword', 'fist'] as const;
export type WeaponType = typeof WEAPON_TYPES[number];
export const WEAPON_TYPE_LABELS: Record<WeaponType, string> = {
  mace: 'Maces', axe: 'Axes', sword: 'Swords', fist: 'Fist weapons',
};
export const WEAPON_CATEGORY_TYPES = {
  maces: 'mace', axes: 'axe', swords: 'sword', fist_weapons: 'fist',
} as const satisfies Record<string, WeaponType>;

export function isWeaponType(value: unknown): value is WeaponType {
  return WEAPON_TYPES.some(type => type === value);
}

export function categoryWeaponType(category: string | undefined): WeaponType | undefined {
  return Object.entries(WEAPON_CATEGORY_TYPES).find(([key]) => key === category)?.[1];
}
