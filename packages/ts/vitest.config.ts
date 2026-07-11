import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      // Test doubles / helpers are exercised by tests but are not product code.
      exclude: ['src/**/*.test.ts', 'src/testing/**'],
    },
  },
});
