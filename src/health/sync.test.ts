import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../../test/db';
import { getFitnessDay, saveStepTotal } from '../db/game';
import { dayStart, localDay } from '../game/rules';
import { setHealthConnected, stepsInSegments, syncHealth } from './sync';
const native = vi.hoisted(() => ({ authorized: vi.fn(), steps: vi.fn() }));
vi.mock('./native', () => ({ healthName: 'Test Health', healthAuthorized: native.authorized, readHealthSteps: native.steps }));
const now = new Date(2026, 8, 6, 12).getTime();
const day = localDay(now);
beforeEach(() => { native.authorized.mockReset().mockResolvedValue(true); native.steps.mockReset().mockResolvedValue(0); });
describe('connected step sync', () => {
  it('replaces manual totals with native aggregates, including zero, without repeated additions', async () => {
    const db = createTestDb();
    saveStepTotal(db, day, 9999);
    setHealthConnected(db, true);
    native.steps.mockImplementation(async (start: number) => start === dayStart(day) ? 6000 : 0);
    await syncHealth(db, now);
    await syncHealth(db, now);
    expect(getFitnessDay(db, day)).toMatchObject({ steps: 6000, stepSource: 'Test Health', syncedAt: now });
    native.steps.mockResolvedValue(0);
    await syncHealth(db, now);
    expect(getFitnessDay(db, day).steps).toBe(0);
    db.$client.close();
  });
  it('keeps the last complete totals when permission is revoked or any read fails', async () => {
    const db = createTestDb();
    setHealthConnected(db, true);
    native.steps.mockResolvedValue(3000);
    await syncHealth(db, now);
    native.authorized.mockResolvedValue(false);
    await expect(syncHealth(db, now)).rejects.toThrow('Allow');
    expect(getFitnessDay(db, day).steps).toBe(3000);
    native.authorized.mockResolvedValue(true);
    native.steps.mockResolvedValueOnce(5000).mockRejectedValueOnce(new Error('Platform read failed'));
    await expect(syncHealth(db, now)).rejects.toThrow('Platform read failed');
    expect(getFitnessDay(db, day).steps).toBe(3000);
    db.$client.close();
  });
  it('does not query private data before connecting or after disconnecting', async () => {
    const db = createTestDb();
    await syncHealth(db, now);
    expect(native.authorized).not.toHaveBeenCalled();
    setHealthConnected(db, true);
    setHealthConnected(db, false);
    await syncHealth(db, now);
    expect(native.steps).not.toHaveBeenCalled();
    db.$client.close();
  });
  it('queries only active running intervals for recorded run steps', async () => {
    native.steps.mockResolvedValueOnce(100).mockResolvedValueOnce(80);
    expect(await stepsInSegments([{ start: 10, end: 20 }, { start: 40, end: 60 }])).toBe(180);
    expect(native.steps.mock.calls).toEqual([[10, 20], [40, 60]]);
  });
  it('syncs steps from 5 AM, carrying them through midnight and excluding them after reset', async () => {
    const db = createTestDb();
    try {
      setHealthConnected(db, true);
      const reset = new Date(2026, 8, 7, 5).getTime();
      native.steps.mockImplementation(async (start: number) => start < reset ? 6000 : 100);
      await syncHealth(db, reset - 1);
      expect(native.steps).toHaveBeenLastCalledWith(dayStart(day), reset - 1);
      expect(getFitnessDay(db, localDay(reset - 1)).steps).toBe(6000);
      native.steps.mockClear();
      await syncHealth(db, reset);
      expect(getFitnessDay(db, localDay(reset)).steps).toBe(0);
      expect(native.steps.mock.calls.every(([start, end]) => start < end)).toBe(true);
      expect(native.steps).toHaveBeenLastCalledWith(dayStart(day), reset);
      await syncHealth(db, reset + 60_000);
      expect(native.steps).toHaveBeenLastCalledWith(reset, reset + 60_000);
      expect(getFitnessDay(db, localDay(reset)).steps).toBe(100);
      expect(getFitnessDay(db, day).steps).toBe(6000);
    } finally { db.$client.close(); }
  });
});
