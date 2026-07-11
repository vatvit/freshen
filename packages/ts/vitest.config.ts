import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      // Test doubles / helpers are exercised by tests but are not product code.
      exclude: ['src/**/*.test.ts', 'src/testing/**'],
      // Floor gate (mirrors PHP's coverage:gate) — a tracked threshold that must not
      // regress. Set just below the current numbers; raise as coverage climbs.
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 85,
        lines: 90,
      },
    },
  },
});
