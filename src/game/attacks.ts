/** Rates use integer basis points; meters make every outcome reproducible. */
export const RATE_SCALE = 10_000;
export type CombatMeters = { dodge: number; effects: Record<string, number> };
export const emptyCombatMeters = (): CombatMeters => ({ dodge: 0, effects: {} });

export type AttackEffect = {
  /** Stable, unique equipment-effect ID, retained when a save is reopened. */
  id: string;
  name: string;
  trigger: 'onAttack';
  rateBps: number;
} & (
  | { kind: 'critical'; multiplierBps: number }
  | { kind: 'damage'; amount: number }
  | { kind: 'heal'; amount: number }
);
export type AttackEvent = { source: string; kind: 'damage' | 'heal'; amount: number; critical?: boolean };

export function advanceMeter(meter: number, rateBps: number) {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > RATE_SCALE) throw new Error('Invalid effect rate.');
  const total = meter + rateBps;
  return { triggered: total >= RATE_SCALE, meter: total % RATE_SCALE };
}

/** Resolve one paid attack. Procs cannot recursively trigger more procs/attacks.
 * Critical effects modify weapon damage first (strongest wins), then flat damage
 * and healing procs resolve in equipment order. No UI or database dependencies.
 */
export function resolveAttack(attack: number, effects: readonly AttackEffect[], meters: CombatMeters) {
  const nextMeters = { ...meters, effects: { ...meters.effects } };
  const triggered: AttackEffect[] = [];
  const ids = new Set<string>();
  for (const effect of effects) {
    if (ids.has(effect.id)) throw new Error('Attack effect IDs must be unique.');
    ids.add(effect.id);
    const next = advanceMeter(meters.effects[effect.id] ?? 0, effect.rateBps);
    nextMeters.effects[effect.id] = next.meter;
    if (next.triggered) triggered.push(effect);
  }
  const multiplier = Math.max(RATE_SCALE, ...triggered.filter(e => e.kind === 'critical').map(e => e.multiplierBps));
  const events: AttackEvent[] = [{ source: 'Weapon', kind: 'damage', amount: Math.max(0, Math.floor(attack * multiplier / RATE_SCALE)), critical: multiplier > RATE_SCALE }];
  for (const effect of triggered) {
    if (effect.kind !== 'critical') events.push({ source: effect.name, kind: effect.kind, amount: Math.max(0, Math.floor(effect.amount)) });
  }
  return { meters: nextMeters, events,
    damage: events.reduce((sum, event) => sum + (event.kind === 'damage' ? event.amount : 0), 0),
    healing: events.reduce((sum, event) => sum + (event.kind === 'heal' ? event.amount : 0), 0),
  };
}
