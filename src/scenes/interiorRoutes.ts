import { battleDungeon, type BattleState, type Dungeon } from '../game/combat';
import type { InteriorLocationId } from './interiorLocations';

type InteriorRoute = { biomeId: string; legacyDungeonId: number; sections: { fromEncounter: number; location: InteriorLocationId }[] };

/** Chapter routes are data; every section uses the same interior renderer. */
export const INTERIOR_ROUTES: InteriorRoute[] = [
  { biomeId: 'embercrypt', legacyDungeonId: 1, sections: [
    { fromEncounter: 0, location: 'lava_caves' }, { fromEncounter: 2, location: 'crypts' },
  ] },
  { biomeId: 'frostbound_keep', legacyDungeonId: 2, sections: [
    { fromEncounter: 0, location: 'frost_caves' }, { fromEncounter: 2, location: 'fortress' },
  ] },
  { biomeId: 'hollow_delve', legacyDungeonId: 3, sections: [{ fromEncounter: 0, location: 'hollow_delve' }] },
];

export function interiorLocationFor(dungeon: Dungeon, encounter: number): InteriorLocationId | undefined {
  const route = INTERIOR_ROUTES.find(route => dungeon.biomeId === undefined
    ? dungeon.id === route.legacyDungeonId : dungeon.biomeId === route.biomeId);
  return route?.sections.findLast(section => section.fromEncounter <= Math.max(0, encounter))?.location;
}

export function journeyInterior(battle: BattleState): InteriorLocationId | undefined {
  // Keep the old room through a finishing swing; enter the next during travel.
  const encounter = battle.phase === 'travelling' && battle.lastAction === 'attack'
    ? battle.encounter - 1 : battle.encounter;
  return interiorLocationFor(battleDungeon(battle), encounter);
}
