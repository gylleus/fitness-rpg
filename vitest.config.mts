import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the pure logic is tested here — geometry, the rep state machine, and
    // the db layer. Nothing under app/ or src/pose/ is testable off-device.
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
