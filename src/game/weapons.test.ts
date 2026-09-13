import { expect, it } from 'vitest';
import { equippedWeaponType, GEAR, itemWeaponType, type GearItem } from './equipment';
import { WEAPON_CATEGORY_TYPES } from './weapons';

it('classifies every authored weapon and excludes armor and glove items', () => {
  for (const item of Object.values(GEAR)) {
    expect(itemWeaponType(item)).toBe(item.kind === 'weapon'
      ? WEAPON_CATEGORY_TYPES[item.category as keyof typeof WEAPON_CATEGORY_TYPES] : undefined);
  }
  expect(Object.values(GEAR).filter(item => item.kind !== 'weapon').every(item => !item.weaponType)).toBe(true);
});

it('resolves old saved weapon metadata without rewriting earned rolls', () => {
  const sword = Object.values(GEAR).find(item => item.weaponType === 'sword')!;
  const old: GearItem = { ...sword, weaponType: undefined, category: undefined,
    name: 'My earned blade', damageMin: 77, damageMax: 99, sellValue: 222 };
  const before = JSON.stringify(old);
  expect(itemWeaponType(old)).toBe('sword');
  expect(itemWeaponType({ ...old, definitionId: 'retired_sword', category: 'swords' })).toBe('sword');
  expect(itemWeaponType({ ...old, definitionId: 'unknown_legacy_weapon' })).toBe('mace');
  expect(JSON.stringify(old)).toBe(before);
});

it('uses the equipped weapon class, supports fist weapons and bare hands, and ignores the bag', () => {
  const axe = Object.values(GEAR).find(item => item.weaponType === 'axe')!;
  const fist: GearItem = { ...axe, definitionId: 'iron_knuckles', category: 'fist_weapons', weaponType: 'fist' };
  expect(itemWeaponType({ ...fist, weaponType: undefined })).toBe('fist');
  expect(equippedWeaponType([{ slot: 'weapon', item: axe }, { slot: null, item: fist }])).toBe('axe');
  expect(equippedWeaponType([{ slot: 'weapon', item: fist }])).toBe('fist');
  expect(equippedWeaponType([{ slot: null, item: axe }])).toBe('fist');
  expect(equippedWeaponType([])).toBe('fist');
});
