import { isWeaponType, type WeaponType } from '../game/weapons';

export const PLAYER_SPRITES = {
  mace: 'barbarian_player',
  axe: 'knight_player_axe',
  sword: 'knight_player_sword',
  fist: 'knight_player_fist',
} as const satisfies Record<WeaponType, string>;

/** Old expeditions have no class and retain their original mace appearance. */
export function playerSpriteId(weaponType: unknown) {
  return PLAYER_SPRITES[isWeaponType(weaponType) ? weaponType : 'mace'];
}
