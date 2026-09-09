import { describe, expect, it } from 'vitest';
import { acceptFix, activeMilliseconds, distanceBetween, routePaths, type GpsFix } from './route';
const start = 1000000;
const fix = (seconds: number, meters: number): GpsFix => ({ timestamp: start + seconds * 1000, latitude: 0, longitude: meters / 111195, accuracy: 5 });
describe('GPS distance and active time', () => {
  it('measures geographic distance and separates pause segments', () => {
    expect(distanceBetween(fix(0, 0), fix(10, 20))).toBeCloseTo(20, 1);
    const segments = [{ start, end: start + 10000 }, { start: start + 30000, end: null }];
    expect(activeMilliseconds(segments, start + 40000)).toBe(20000);
    const first = acceptFix(fix(0, 0), null, segments, start)!;
    expect(acceptFix(fix(20, 100), first.point, segments, start + 20000)).toBeNull();
    const afterPause = acceptFix(fix(31, 200), first.point, segments, start + 31000)!;
    expect(afterPause.distance).toBe(0);
    expect(afterPause.point.breakBefore).toBe(true);
    expect(routePaths([first.point, afterPause.point], 300, 220)).toHaveLength(2);
  });
  it('rejects poor accuracy, impossible speed, stale timestamps and stationary jitter', () => {
    const segments = [{ start, end: null }];
    const first = acceptFix(fix(0, 0), null, segments, start)!.point;
    for (const bad of [{ ...fix(10, 20), accuracy: 80 }, fix(1, 200), fix(0, 30), fix(10, 1), { ...fix(10, 20), latitude: NaN }, { ...fix(10, 20), longitude: 190 }]) {
      expect(acceptFix(bad, first, segments, start + 10000)).toBeNull();
    }
    expect(acceptFix(fix(10, 20), first, segments, start + 10000)?.distance).toBeCloseTo(20, 1);
  });
  it('does not connect a long GPS outage with invented distance', () => {
    const segments = [{ start, end: null }];
    const first = acceptFix(fix(0, 0), null, segments, start)!.point;
    expect(acceptFix(fix(300, 1000), first, segments, start + 300000)).toMatchObject({ distance: 0, point: { breakBefore: true } });
  });
});
