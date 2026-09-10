/** Version 1 game RNG. Keep these operations stable for saved expeditions. */
export function seedFor(key: string) {
  let seed = 2166136261;
  for (let i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 16777619);
  return seed >>> 0;
}

export function randomInt(state: number, min: number, max: number) {
  if (!Number.isInteger(state) || state < 0 || state > 0xffffffff
    || !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min || max - min >= 0x100000000) {
    throw new Error('Invalid random range or state.');
  }
  const next = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return { state: next, value: min + Math.floor(next / 0x100000000 * (max - min + 1)) };
}

export const dungeonSeed = (dungeon: number, victories: number) => seedFor(`dungeon-v1:${dungeon}:${victories}`);
