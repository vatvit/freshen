import { describe, expect, it, vi } from 'vitest';
import { Cache } from './cache.js';
import { NotFoundError } from './errors.js';
import { Key } from './key.js';
import { MemoryStore } from './store/memory-store.js';
import type { Clock } from './clock.js';
import type { Jitter, Metrics } from './ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };
const KEY = new Key('product', 'detail', 'sku-1');

function fakeClock(start = 1000): Clock & { set(t: number): void } {
  let t = start;
  return { now: () => t, set: (n) => (t = n) };
}

function recordingMetrics(): Metrics & { calls: Array<[string, Record<string, string> | undefined]> } {
  const calls: Array<[string, Record<string, string> | undefined]> = [];
  return { calls, inc: (n, l) => calls.push([n, l]), observe: () => undefined };
}

describe('negative caching (FRSH-051)', () => {
  it('caches a not-found for negativeTtlSec and short-circuits subsequent loads', async () => {
    const clock = fakeClock(1000);
    const loader = vi.fn(() => {
      throw new NotFoundError();
    });
    const metrics = recordingMetrics();
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
      metrics,
      negativeTtlSec: 30,
    });
    const first = await cache.get(KEY);
    expect(first.isMiss()).toBe(true);
    const second = await cache.get(KEY); // within negative window
    expect(second.isMiss()).toBe(true);
    expect(loader).toHaveBeenCalledOnce(); // second short-circuited
    expect(metrics.calls).toContainEqual(['cache_miss', { cause: 'negative' }]);
  });

  it('re-hits the loader after the negative window expires', async () => {
    const clock = fakeClock(1000);
    const loader = vi.fn(() => {
      throw new NotFoundError();
    });
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
      negativeTtlSec: 30,
    });
    await cache.get(KEY); // caches negative until 1030
    clock.set(1031);
    await cache.get(KEY); // negative expired -> loader again
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('with negative caching off, a not-found is a plain miss (loader hit each time)', async () => {
    const clock = fakeClock(1000);
    const loader = vi.fn(() => {
      throw new NotFoundError();
    });
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
      // negativeTtlSec defaults to 0 (off)
    });
    expect((await cache.get(KEY)).isMiss()).toBe(true);
    expect((await cache.get(KEY)).isMiss()).toBe(true);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('a cached null is a real HIT, not a negative miss', async () => {
    const clock = fakeClock(1000);
    const cache = new Cache<null>({
      loader: () => null,
      hardTtlSec: 600,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
      negativeTtlSec: 30,
    });
    const r = await cache.get(KEY);
    expect(r.isHit()).toBe(true);
    expect(r.isMiss()).toBe(false);
    expect(r.value()).toBeNull();
  });
});

describe('stale-if-error (FRSH-048)', () => {
  async function seedStaleThenFail(opts?: {
    staleIfError?: boolean;
    graceSec?: number;
  }): Promise<{
    cache: Cache<string>;
    clock: Clock & { set(t: number): void };
    loader: ReturnType<typeof vi.fn>;
    metrics: ReturnType<typeof recordingMetrics>;
    outcome: { throws: boolean; value: string };
  }> {
    const clock = fakeClock(1000);
    const store = new MemoryStore(clock);
    const metrics = recordingMetrics();
    const outcome = { throws: false, value: 'v1' };
    const loader = vi.fn(() => {
      if (outcome.throws) {
        throw new Error('source down');
      }
      return outcome.value;
    });
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store,
      jitter: noJitter,
      clock,
      metrics,
      staleIfErrorRetrySec: 10,
      // These tests exercise the stale-if-error feature itself, so opt in unless a case
      // overrides it (the ctor default is now OFF — covered separately below).
      staleIfError: opts?.staleIfError ?? true,
      graceSec: opts?.graceSec,
    });
    await cache.get(KEY); // fill v1 at t=1000 (hard 1600, soft 1540)
    return { cache, clock, loader, metrics, outcome };
  }

  it('serves the last-good value as STALE when a recompute throws', async () => {
    const { cache, clock, loader, metrics, outcome } = await seedStaleThenFail();
    clock.set(1550); // due for recompute (>= soft 1540, < hard 1600)
    outcome.throws = true;
    const r = await cache.get(KEY);
    expect(r.isStale()).toBe(true);
    expect(r.value()).toBe('v1');
    expect(loader).toHaveBeenCalledTimes(2); // initial fill + the failed retry
    expect(metrics.calls).toContainEqual(['cache_hit', { state: 'stale_on_error' }]);
    expect(metrics.calls).toContainEqual(['cache_loader_error', undefined]);
  });

  it('does not re-hit the loader during the retry backoff window', async () => {
    const { cache, clock, loader, outcome } = await seedStaleThenFail();
    clock.set(1550);
    outcome.throws = true;
    await cache.get(KEY); // fails, sets nextRetryAt = 1560
    clock.set(1555); // within backoff
    const r = await cache.get(KEY);
    expect(r.isStale()).toBe(true);
    expect(loader).toHaveBeenCalledTimes(2); // no extra call within the window
  });

  it('retries once the backoff elapses and recovers to a fresh hit', async () => {
    const { cache, clock, loader, outcome } = await seedStaleThenFail();
    clock.set(1550);
    outcome.throws = true;
    await cache.get(KEY); // fail -> nextRetryAt 1560
    clock.set(1561); // past backoff
    outcome.throws = false;
    outcome.value = 'v2';
    const r = await cache.get(KEY);
    expect(r.isHit()).toBe(true);
    expect(r.value()).toBe('v2');
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('propagates the error when stale-if-error is disabled', async () => {
    const { cache, clock, outcome } = await seedStaleThenFail({ staleIfError: false });
    clock.set(1550);
    outcome.throws = true;
    await expect(cache.get(KEY)).rejects.toThrow('source down');
  });

  it('propagates the error by DEFAULT (staleIfError is off unless opted in)', async () => {
    // Same setup as seedStaleThenFail but WITHOUT passing staleIfError — exercises the
    // ctor default, which must be OFF (FRSH-057): a loader throw propagates by default.
    const clock = fakeClock(1000);
    const store = new MemoryStore(clock);
    const outcome = { throws: false, value: 'v1' };
    const loader = vi.fn(() => {
      if (outcome.throws) {
        throw new Error('source down');
      }
      return outcome.value;
    });
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store,
      jitter: noJitter,
      clock,
      graceSec: 300, // last-good IS retained past hard — proves propagation is the default, not a retention gap
    });
    await cache.get(KEY); // fill v1 (hard 1600, soft 1540)
    clock.set(1550); // due for recompute, last-good still retained
    outcome.throws = true;
    await expect(cache.get(KEY)).rejects.toThrow('source down');
  });

  it('propagates the error when there is no last-good value (cold key)', async () => {
    const clock = fakeClock(1000);
    const cache = new Cache<string>({
      loader: () => {
        throw new Error('cold and down');
      },
      hardTtlSec: 600,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
    });
    await expect(cache.get(KEY)).rejects.toThrow('cold and down');
  });

  it('stops serving stale once the grace window elapses', async () => {
    const { cache, clock, outcome } = await seedStaleThenFail({ graceSec: 0 });
    // graceSec 0 => retention ends at hard expiry (1600). Past it, nothing to serve.
    clock.set(1601);
    outcome.throws = true;
    await expect(cache.get(KEY)).rejects.toThrow('source down');
  });
});

describe('precedence: not-found overrides stale-if-error (FRSH-048 vs FRSH-051)', () => {
  it('a definitive NotFound returns a negative miss even with a retained positive', async () => {
    const clock = fakeClock(1000);
    const store = new MemoryStore(clock);
    const outcome = { notFound: false };
    const loader = vi.fn(() => {
      if (outcome.notFound) {
        throw new NotFoundError();
      }
      return 'v1';
    });
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store,
      jitter: noJitter,
      clock,
      negativeTtlSec: 30,
    });
    await cache.get(KEY); // fill v1
    clock.set(1550); // due
    outcome.notFound = true;
    const r = await cache.get(KEY);
    expect(r.isMiss()).toBe(true); // negative wins over stale positive
    // The positive was overwritten by the negative entry; next read short-circuits.
    const r2 = await cache.get(KEY);
    expect(r2.isMiss()).toBe(true);
    expect(loader).toHaveBeenCalledTimes(2); // r2 short-circuited on the cached negative
  });
});
