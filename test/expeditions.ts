import { advanceDungeon, resolveDungeonChest, type startDungeon, type GameDb } from '../src/db/game';

/** Test driver makes the same explicit chest decisions as the expedition UI. */
export function advanceExpedition(db: GameDb, run: ReturnType<typeof startDungeon>, now: number) {
  return run.state.phase === 'chest' ? resolveDungeonChest(db, run.id, run.state.tick, 'open', now)!
    : run.state.phase === 'chest-reveal' ? resolveDungeonChest(db, run.id, run.state.tick, 'continue', now)!
      : advanceDungeon(db, run.id, run.state.tick, now)!;
}
