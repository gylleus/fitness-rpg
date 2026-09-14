import type { AttackEffect } from './attacks';
import { BASE_PUSHUP_DAMAGE_COEFFICIENT, FOCUS_COEFFICIENT_BONUS } from './items';
import { equipmentBonuses, startingEquipment, type OwnedItem } from './equipment';

export const DAILY_RESET_HOUR = 5;

/** The fitness day starts at 5 AM on the device's local calendar. */
export function localDay(time: number | Date = Date.now()): string {
  const d = new Date(time);
  if (d.getHours() < DAILY_RESET_HOUR) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function recentDays(now = Date.now(), count = 7): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(dayStart(localDay(now)));
    d.setDate(d.getDate() - count + 1 + i);
    return localDay(d);
  });
}

export function dayStart(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, DAILY_RESET_HOUR).getTime();
}

export function nextDailyReset(now = Date.now()): number {
  const d = new Date(dayStart(localDay(now)));
  // Calendar arithmetic keeps the reset at 5 AM on 23- and 25-hour days.
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export type RunActivity = { distanceMeters: number; durationSeconds: number; steps: number };
export type FitnessDay = {
  day: string;
  pushups: number;
  partialReps: number;
  steps: number;
  runningSteps: number;
  distanceMeters: number;
  durationSeconds: number;
  agilityBps: number;
};
export type Hero = { gold: number; xp: number; swordLevel: number; armorLevel: number; unlockedDungeon: number; amuletOwned?: boolean };
export type HeroStats = { attack: number; health: number; baseAttack: number; baseHealth: number; dailyHealth: number; level: number; dodgeBps: number;
  armor?: number; critChanceBps?: number; critMultiplierBps?: number;
  baseDamageMin?: number; baseDamageMax?: number;
  pushups: number; pushupDamageCoefficient: number; damageMultiplier: number; attackEffects: AttackEffect[] };

/** Diminishing returns: 25 armor = 20%, 100 = 50%, 300 = the 75% cap. */
export function armorReduction(armor = 0) {
  const rating = Number.isFinite(armor) ? Math.max(0, armor) : 0;
  return Math.min(0.75, rating / (100 + rating));
}

export function damageAfterArmor(damage: number, armor = 0) {
  if (!Number.isFinite(damage) || damage <= 0) return 0;
  return Math.max(1, Math.round(damage * (1 - armorReduction(armor))));
}

/** Coefficient bonuses are additive, so equipment and future talents compose. */
export function pushupPower(baseDamage: number, pushups: number, coefficient = BASE_PUSHUP_DAMAGE_COEFFICIENT) {
  // Integer basis points avoid e.g. 0.1 + 0.01 + 0.02 rounding 57.5 down to 57.
  const scale = 10000;
  const numerator = scale + Math.max(0, pushups) * Math.max(0, Math.round(coefficient * scale));
  return { multiplier: numerator / scale, damage: Math.round(baseDamage * numerator / scale) };
}

export function attackPower(stats: HeroStats, focusAttacks = 0, baseDamage = stats.baseAttack) {
  const coefficient = stats.pushupDamageCoefficient + (focusAttacks > 0 ? FOCUS_COEFFICIENT_BONUS : 0);
  return { ...pushupPower(baseDamage, stats.pushups, coefficient),
    minDamage: pushupPower(stats.baseDamageMin ?? stats.baseAttack, stats.pushups, coefficient).damage,
    maxDamage: pushupPower(stats.baseDamageMax ?? stats.baseAttack, stats.pushups, coefficient).damage };
}

export const MAX_DODGE_BPS = 3000;
export function runDodgeBps(run: Pick<RunActivity, 'distanceMeters' | 'durationSeconds'>): number {
  if (run.durationSeconds <= 0 || run.distanceMeters <= 0 || !Number.isFinite(run.durationSeconds) || !Number.isFinite(run.distanceMeters)) return 0;
  const speed = run.distanceMeters / run.durationSeconds * 3.6;
  // 2% per km at 8 km/h. Pace weight is bounded; distance still matters.
  return Math.min(MAX_DODGE_BPS, Math.round(run.distanceMeters / 1000 * 200 * Math.min(1.5, Math.max(0.5, speed / 8))));
}

export function fitnessDay(day: string, pushups = 0, partialReps = 0, enteredSteps = 0, runs: RunActivity[] = []): FitnessDay {
  const runningSteps = runs.reduce((sum, r) => sum + r.steps, 0);
  return {
    day, pushups, partialReps, runningSteps,
    steps: Math.max(enteredSteps, runningSteps),
    distanceMeters: runs.reduce((sum, r) => sum + r.distanceMeters, 0),
    durationSeconds: runs.reduce((sum, r) => sum + r.durationSeconds, 0),
    agilityBps: Math.min(MAX_DODGE_BPS, runs.reduce((sum, r) => sum + runDodgeBps(r), 0)),
  };
}

export function heroStats(hero: Hero, today: FitnessDay, pushups = today.pushups,
  gear: readonly Pick<OwnedItem, 'item' | 'slot'>[] = startingEquipment()): HeroStats {
  const level = 1 + Math.floor(hero.xp / 100);
  const bonuses = equipmentBonuses(gear);
  const baseDamageMin = bonuses.damageMin + level - 1, baseDamageMax = bonuses.damageMax + level - 1;
  const baseAttack = (baseDamageMin + baseDamageMax) / 2;
  const baseHealth = 100 + bonuses.health + (level - 1) * 5;
  const dailyHealth = Math.floor(today.steps / 100);
  const pushupDamageCoefficient = BASE_PUSHUP_DAMAGE_COEFFICIENT + bonuses.coefficientBonus;
  const power = pushupPower(baseAttack, pushups, pushupDamageCoefficient);
  return { attack: power.damage, health: baseHealth + dailyHealth, baseAttack, baseDamageMin, baseDamageMax, baseHealth, dailyHealth, level,
    armor: bonuses.armor, critChanceBps: bonuses.critChanceBps, critMultiplierBps: bonuses.critMultiplierBps,
    dodgeBps: today.agilityBps, pushups, pushupDamageCoefficient, damageMultiplier: power.multiplier, attackEffects: bonuses.effects };
}

export function validateSteps(steps: number) {
  if (!Number.isSafeInteger(steps) || steps < 0 || steps > 200_000) throw new Error('Enter a whole step total between 0 and 200,000.');
}

export function validateRun(run: RunActivity) {
  validateSteps(run.steps);
  if (run.steps === 0) throw new Error('Enter the steps taken during this run.');
  if (!Number.isFinite(run.distanceMeters) || run.distanceMeters < 100 || run.distanceMeters > 200_000) throw new Error('Enter a distance between 0.1 and 200 km.');
  if (!Number.isFinite(run.durationSeconds) || run.durationSeconds < 60 || run.durationSeconds > 86_400) throw new Error('Enter a duration between 1 and 1,440 minutes.');
  if (run.distanceMeters / run.durationSeconds * 3.6 > 30) throw new Error('That pace looks too fast for a run. Check the distance and duration.');
}

export const CHALLENGES = [
  { id: 'pushups', name: 'A little stronger', description: 'Complete 10 pushups', target: 10, reward: 20, metric: 'pushups' },
  { id: 'steps', name: 'Take the long way', description: 'Walk 3,000 steps', target: 3000, reward: 20, metric: 'steps' },
  { id: 'run', name: 'Find your stride', description: 'Run a total of 1 km', target: 1000, reward: 20, metric: 'distanceMeters' },
] as const;
export type ChallengeId = typeof CHALLENGES[number]['id'];

export function paceLabel(distanceMeters: number, durationSeconds: number): string {
  if (distanceMeters <= 0 || durationSeconds <= 0) return '—';
  const seconds = Math.round(durationSeconds / (distanceMeters / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
