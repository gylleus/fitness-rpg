/** Native screen tests complement the fast Vitest game/detector tests. */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/ui/**/*.test.tsx'],
  testTimeout: 15000,
  cacheDirectory: '/tmp/fitness-rpg-jest-cache',
};
