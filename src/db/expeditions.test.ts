import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db';
import { advanceDungeon, getGameSnapshot, getHero, purchaseUpgrade, savePushupWorkout, saveStepTotal, startDungeon } from './game';
import { dungeonRuns, heroes } from './schema';
import { localDay } from '../game/rules';

const now = new Date(2026, 8, 6, 12).getTime();
const day = localDay(now);
function trained() {
  const db = createTestDb();
  savePushupWorkout(db, { sourceKey: 'training', startedAt: now - 60000, endedAt: now, validReps: 20, partialReps: 0 });
  saveStepTotal(db, day, 6000);
  return db;
}
function finish(db: ReturnType<typeof createTestDb>, run: ReturnType<typeof startDungeon>) {
  for (let i = 0; run.status === 'active' && i < 500; i++) run = advanceDungeon(db, run.id, run.state.tick, now)!;
  return run;
}
describe('victory stakes', () => {
  it('banks the whole bounty once and carries exact remaining health into a replay', () => {
    const db = trained();
    let run = startDungeon(db, 0, now);
    while (run.state.defeated < 1) run = advanceDungeon(db, run.id, run.state.tick, now)!;
    expect(run.state.gold).toBe(8);
    expect(getHero(db)).toMatchObject({ gold: 0, xp: 0 });
    run = finish(db, run);
    expect(run.status).toBe('victory');
    expect(getHero(db)).toMatchObject({ gold: 70, xp: 85, pushupUnitsSpent: 1400 });
    expect(getGameSnapshot(db, now).pushupUnits).toBe(600);
    expect(getGameSnapshot(db, now).currentHealth).toBe(run.state.heroHp);
    expect(run.state.heroHp).toBeLessThan(run.state.entryHp);
    advanceDungeon(db, run.id, run.state.tick - 1, now);
    expect(getHero(db).gold).toBe(70);
    const replay = startDungeon(db, 0, now);
    expect(replay.state.entryHp).toBe(run.state.heroHp);
    const loss = finish(db, replay);
    expect(loss.status).toBe('defeat');
    expect(loss.state).toMatchObject({ gold: 0, xp: 0 });
    expect(getHero(db)).toMatchObject({ gold: 70, xp: 85, pushupUnitsSpent: 1400 });
    expect(getGameSnapshot(db, now).pushupUnits).toBe(600);
    expect(startDungeon(db, 0, now).state.entryHp).toBe(replay.state.entryHp);
    db.$client.close();
  });
  it('more steps and armor add available health without clearing existing damage', () => {
    const db = trained();
    const win = finish(db, startDungeon(db, 0, now));
    saveStepTotal(db, day, 8000);
    expect(getGameSnapshot(db, now).currentHealth).toBe(win.state.heroHp + 20);
    purchaseUpgrade(db, 'armor');
    expect(getGameSnapshot(db, now).currentHealth).toBe(win.state.heroHp + 40);
    const tomorrow = new Date(2026, 8, 7, 12).getTime();
    const next = getGameSnapshot(db, tomorrow);
    expect(next.currentHealth).toBe(next.stats.health);
    expect(next.stats.dailyHealth).toBe(0);
    db.$client.close();
  });
  it('does not heal on a level-up caused by the boss bounty', () => {
    const db = trained();
    getHero(db);
    db.update(heroes).set({ xp: 90 }).run();
    const win = finish(db, startDungeon(db, 0, now));
    const snapshot = getGameSnapshot(db, now);
    expect(snapshot.stats.level).toBe(2);
    expect(snapshot.currentHealth).toBe(win.state.heroHp);
    db.$client.close();
  });
  it('rolls back all rewards and health if the victory checkpoint cannot be saved', () => {
    const db = trained();
    let run = startDungeon(db, 0, now);
    while (!(run.state.encounter === 3 && run.state.phase === 'fighting' && run.state.turn === 'hero' && run.state.enemyHp <= run.state.stats.attack)) {
      run = advanceDungeon(db, run.id, run.state.tick, now)!;
    }
    db.run("CREATE TRIGGER fail_victory BEFORE UPDATE ON dungeon_runs BEGIN SELECT RAISE(ABORT, 'disk error'); END");
    const hero = getHero(db);
    expect(() => advanceDungeon(db, run.id, run.state.tick, now)).toThrow();
    expect(getHero(db)).toEqual(hero);
    expect(db.select().from(dungeonRuns).where(eq(dungeonRuns.id, run.id)).get()).toEqual(run);
    db.run('DROP TRIGGER fail_victory');
    expect(advanceDungeon(db, run.id, run.state.tick, now)?.status).toBe('victory');
    db.$client.close();
  });
});
