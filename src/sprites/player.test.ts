import { expect, it } from 'vitest';
import catalog from '../../assets/sprites/catalog.json';
import { WEAPON_TYPES } from '../game/weapons';
import { PLAYER_SPRITES, playerSpriteId } from './player';
import { sampleSprite } from './playback';
import { HERO_ATTACK_DURATION_MS, HERO_ATTACK_IMPACT_MS } from './battleAnimation';
import type { SpriteCatalog } from './types';

it('ships distinct complete weapon sets with the same player scale and ground pivot', () => {
  const entities = (catalog as unknown as SpriteCatalog).entities;
  expect(new Set(Object.values(PLAYER_SPRITES)).size).toBe(WEAPON_TYPES.length);
  for (const type of WEAPON_TYPES) {
    const player = entities[playerSpriteId(type)];
    expect(player).toMatchObject({ facing: 'right', frameSize: [128, 128], idleHeight: 78,
      heightScale: 1, pivot: [62 / 128, 112 / 128] });
    expect(Object.keys(player.actions).sort()).toEqual(['attack', 'death', 'idle', 'walk']);
    expect(player.actions.idle.duration).toBe(2400);
    expect(sampleSprite(player, 'attack', HERO_ATTACK_IMPACT_MS - 1, HERO_ATTACK_DURATION_MS).index).toBe(2);
    expect(sampleSprite(player, 'attack', HERO_ATTACK_IMPACT_MS, HERO_ATTACK_DURATION_MS).index).toBe(3);
    expect(sampleSprite(player, 'attack', HERO_ATTACK_DURATION_MS, HERO_ATTACK_DURATION_MS).clip).toBe(player.actions.idle);
    expect(sampleSprite(player, 'death', 10000).index).toBe(5);
  }
});

it('keeps pre-class saves and invalid saved metadata on the legacy mace set', () => {
  for (const value of [undefined, null, 'retired', '__proto__']) expect(playerSpriteId(value)).toBe(PLAYER_SPRITES.mace);
});
