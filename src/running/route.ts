export type RunSegment = { start: number; end: number | null };
export type GpsFix = { timestamp: number; latitude: number; longitude: number; accuracy: number; altitude?: number | null };
export type RoutePoint = GpsFix & { segment: number; breakBefore: boolean };

export function activeMilliseconds(segments: RunSegment[], now = Date.now()) {
  return segments.reduce((total, s) => total + Math.max(0, (s.end ?? now) - s.start), 0);
}

export function distanceBetween(a: GpsFix, b: GpsFix) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Reject poor fixes, stale batches, stationary jitter and impossible jumps.
 * A pause or long GPS outage starts a new polyline, never an invented shortcut.
 */
export function acceptFix(fix: GpsFix, previous: RoutePoint | null, segments: RunSegment[], now = Date.now()): { point: RoutePoint; distance: number } | null {
  if (![fix.timestamp, fix.latitude, fix.longitude, fix.accuracy].every(Number.isFinite)
    || Math.abs(fix.latitude) > 90 || Math.abs(fix.longitude) > 180
    || fix.accuracy < 0 || fix.accuracy > 35 || fix.timestamp > now + 5000) return null;
  const segment = segments.findIndex((s) => fix.timestamp >= s.start && (s.end === null || fix.timestamp <= s.end));
  if (segment < 0 || (previous && fix.timestamp <= previous.timestamp)) return null;
  const gap = previous ? (fix.timestamp - previous.timestamp) / 1000 : 0;
  const breakBefore = !previous || previous.segment !== segment || gap > 120;
  if (breakBefore) return { point: { ...fix, segment, breakBefore: true }, distance: 0 };
  const distance = distanceBetween(previous!, fix);
  if (distance / gap > 10 || distance < Math.max(3, (fix.accuracy + previous!.accuracy) * 0.25)) return null;
  return { point: { ...fix, segment, breakBefore: false }, distance };
}

export function routePaths(points: RoutePoint[], width: number, height: number): string[] {
  if (!points.length) return [];
  const origin = points[0];
  const xy = points.map(p => ({ x: (p.longitude - origin.longitude) * Math.cos(origin.latitude * Math.PI / 180), y: -(p.latitude - origin.latitude) }));
  const xs = xy.map(p => p.x), ys = xy.map(p => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX, spanY = Math.max(...ys) - minY;
  const scale = Math.min((width - 32) / Math.max(spanX, 0.00001), (height - 32) / Math.max(spanY, 0.00001));
  const paths: string[] = [];
  xy.forEach((p, i) => {
    const coordinate = `${((p.x - minX) * scale + (width - spanX * scale) / 2).toFixed(1)},${((p.y - minY) * scale + (height - spanY * scale) / 2).toFixed(1)}`;
    if (points[i].breakBefore || !paths.length) paths.push(`M${coordinate}`);
    else paths[paths.length - 1] += ` L${coordinate}`;
  });
  return paths;
}
