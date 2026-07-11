import { defineConfig } from 'vitest/config';

/**
 * Live-Redis integration lane (FRSH-044) — mirrors PHP's `integration` suite. Runs
 * only via `scripts/ts-redis-it.sh` (needs a reachable Redis + the ioredis/node-redis
 * clients). Excluded from the default `vitest run` above.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
