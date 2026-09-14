import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../test/db';
import { advanceExpedition } from '../../test/expeditions';
import { giveItem } from '../../test/equipment';
import { GEAR } from '../game/equipment';
import { advanceDungeon, getDungeonMap, getGameSnapshot, getHero, savePushupWorkout, saveStepTotal, startDungeon } from './game';
import { dungeonRuns, heroes } from './schema';
import { battleTurn } from '../game/combat';
import { localDay } from '../game/rules';

const now = new Date(2026, 8, 6, 12).getTime();
const day = localDay(now);
function trained() {
  const db = createTestDb();
  savePushupWorkout(db, { sourceKey: 'training', startedAt: now - 60000, endedAt: now, validReps: 20, partialReps: 0 });
  saveStepTotal(db, day, 20000);
  return db;
}
function finish(db: ReturnType<typeof createTestDb>, run: ReturnType<typeof startDungeon>) {
  for (let i = 0; run.status === 'active' && i < 500; i++) run = advanceExpedition(db, run, now);
  return run;
}
describe('victory stakes', () => {
  it('makes Hollow Delve reachable from camp without chapter unlocks and persists its scaled roster', () => {
    const db = trained();
    getHero(db);
    const offer = getDungeonMap(db).offers.find(offer => offer.biomeId === 'hollow_delve')!;
    let run = startDungeon(db, offer.offerId, now);
    expect(run.state.dungeon).toEqual(offer);
    expect(db.select().from(dungeonRuns).where(eq(dungeonRuns.id, run.id)).get()?.state.dungeon).toEqual(offer);
    // Exercise the real victory transaction from a saved final combat beat.
    const state = { ...run.state, encounter: offer.enemies.length - 1, defeated: offer.enemies.length - 1, phase: 'fighting' as const,
      turn: 'hero' as const, enemyHp: 1 };
    db.update(dungeonRuns).set({ state }).where(eq(dungeonRuns.id, run.id)).run();
    run = advanceDungeon(db, run.id, state.tick, now)!;
    expect(run.status).toBe('victory');
    expect(getHero(db).unlockedDungeon).toBe(0);
    expect(getDungeonMap(db).generation).toBe(1);
    expect(run.state.loot?.find(drop => drop.boss)?.item.rarity).toMatch(/rare|epic/);
    db.$client.close();
  });
  it('banks the whole bounty once and carries exact remaining health into a replay', () => {
    const db = trained();
    let run = startDungeon(db, 0, now);
    for (let i = 0; run.state.defeated < 1 && i < 100; i++) run = advanceExpedition(db, run, now);
    expect(run.state.gold).toBe(10);
    expect(getHero(db)).toMatchObject({ gold: 0, xp: 0 });
    run = finish(db, run);
    expect(run.status).toBe('victory');
    const earned = { gold: run.state.gold, xp: run.state.xp, pushupUnitsSpent: 0 };
    expect(getHero(db)).toMatchObject(earned);
    expect(getGameSnapshot(db, now).savedPushups).toBe(20);
    expect(getGameSnapshot(db, now).currentHealth).toBe(run.state.heroHp);
    expect(run.state.heroHp).toBeLessThan(run.state.entryHp);
    advanceDungeon(db, run.id, run.state.tick - 1, now);
    expect(getHero(db).gold).toBe(earned.gold);
    const replay = startDungeon(db, 0, now);
    expect(replay.state.entryHp).toBe(run.state.heroHp);
    // Resume a losing combat checkpoint; the refund must use entry HP rather
    // than the final hit's remaining health or the dungeon's new bounty.
    const losingState = { ...replay.state, heroHp: 1, phase: 'fighting' as const, turn: 'enemy' as const };
    db.update(dungeonRuns).set({ state: losingState }).where(eq(dungeonRuns.id, replay.id)).run();
    const loss = finish(db, replay);
    expect(loss.status).toBe('defeat');
    expect(loss.state).toMatchObject({ gold: 0, xp: 0 });
    expect(getHero(db)).toMatchObject(earned);
    expect(getGameSnapshot(db, now).savedPushups).toBe(20);
    expect(startDungeon(db, 0, now).state.entryHp).toBe(replay.state.entryHp);
    db.$client.close();
  });
  it('separates armor from health bonuses without clearing existing damage', () => {
    const db = trained();
    const win = finish(db, startDungeon(db, 0, now));
    saveStepTotal(db, day, 22000);
    expect(getGameSnapshot(db, now).currentHealth).toBe(win.state.heroHp);
    giveItem(db, GEAR.hide_armor, 'armor');
    expect(getGameSnapshot(db, now).currentHealth).toBe(win.state.heroHp);
    expect(getGameSnapshot(db, now).stats.armor).toBe(12);
    giveItem(db, { ...GEAR.hide_armor, modifiers: [{ stat: 'health', value: 25 }] }, 'armor');
    expect(getGameSnapshot(db, now).currentHealth).toBe(win.state.heroHp + 25);
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
    for (let i = 0; battleTurn(run.state).status !== 'victory' && i < 500; i++) {
      run = advanceExpedition(db, run, now);
    }
    expect(battleTurn(run.state).status).toBe('victory');
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
