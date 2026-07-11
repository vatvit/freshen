import { describe, expect, it, vi } from 'vitest';
import { Cache } from './cache.js';
import { Key } from './key.js';
import { MemoryStore } from './store/memory-store.js';
import { InvalidateEvent, InvalidateExactEvent, RefreshEvent } from './events.js';
import { AsyncDispatcherError, InvalidArgumentError } from './errors.js';
import { SyncMode } from './sync-mode.js';
import type { Clock } from './clock.js';
import type { Entry } from './item.js';
import type { EventDispatcher, Jitter, Metrics, SingleFlight, Store } from './ports.js';

function fakeClock(start = 1000): Clock & { set(t: number): void } {
  let t = start;
  return { now: () => t, set: (n) => (t = n) };
}

/** Identity jitter — deterministic TTLs so hardExpiresAt is exactly now+ttl. */
const noJitter: Jitter = { apply: (ttl) => ttl };

/** A single-flight that always loses the election (simulates another leader). */
const alwaysLost: SingleFlight = {
  acquire: () => Promise.resolve(null),
  release: () => Promise.resolve(),
};

function recordingMetrics(): Metrics & { calls: Array<[string, Record<string, string> | undefined]> } {
  const calls: Array<[string, Record<string, string> | undefined]> = [];
  return {
    calls,
    inc: (name, labels) => calls.push([name, labels]),
    observe: () => undefined,
  };
}

function recordingDispatcher(): EventDispatcher & { events: object[] } {
  const events: object[] = [];
  return { events, dispatch: (e) => events.push(e) };
}

const KEY = new Key('product', 'detail', 'sku-1');

describe('Cache — construction & validation', () => {
  it('rejects hardTtlSec < 1', () => {
    expect(() => new Cache({ loader: () => 'x', hardTtlSec: 0 })).toThrow(InvalidArgumentError);
  });
  it('rejects precomputeSec out of range', () => {
    expect(() => new Cache({ loader: () => 'x', hardTtlSec: 100, precomputeSec: 200 })).toThrow(
      InvalidArgumentError,
    );
  });
  it('rejects negative graceSec', () => {
    expect(() => new Cache({ loader: () => 'x', hardTtlSec: 100, graceSec: -1 })).toThrow(
      InvalidArgumentError,
    );
  });
  it('works with just loader + hardTtlSec (the 2-line path)', async () => {
    const cache = new Cache<string>({ loader: () => 'v', hardTtlSec: 600 });
    const r = await cache.get(KEY);
    expect(r.isHit()).toBe(true);
    expect(r.value()).toBe('v');
  });
});

describe('Cache.get — read state machine (PARITY §7)', () => {
  it('tier 1: fresh hit within the soft window', async () => {
    const clock = fakeClock(1000);
    const metrics = recordingMetrics();
    const cache = new Cache<string>({
      loader: () => 'loaded',
      hardTtlSec: 600,
      precomputeSec: 60,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
      metrics,
    });
    await cache.put(KEY, 'v'); // createdAt 1000, hardExpiresAt 1600, soft 1540
    const r = await cache.get(KEY);
    expect(r.isHit()).toBe(true);
    expect(r.value()).toBe('v');
    expect(r.createdAt()).toBe(1000);
    expect(r.softExpiresAt()).toBe(1540);
    expect(metrics.calls).toContainEqual(['cache_hit', { state: 'fresh' }]);
  });

  it('tier 2: leader computes, stores, and returns a fresh hit on a cold key', async () => {
    const clock = fakeClock(1000);
    const metrics = recordingMetrics();
    const store = new MemoryStore<string>(clock);
    const loader = vi.fn(() => 'loaded');
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store,
      jitter: noJitter,
      clock,
      metrics,
    });
    const r = await cache.get(KEY);
    expect(r.isHit()).toBe(true);
    expect(r.value()).toBe('loaded');
    expect(r.createdAt()).toBe(1000);
    expect(r.softExpiresAt()).toBe(1540);
    expect(loader).toHaveBeenCalledOnce();
    expect((await store.read(KEY.toString()))?.value).toBe('loaded'); // stored
    expect(metrics.calls).toContainEqual(['cache_fill', undefined]);
  });

  it('tier 1 (non-elected): follower in the precompute window is served fresh, not stale', async () => {
    const clock = fakeClock(1550); // soft(1540) <= now < hard(1600)
    const store = new MemoryStore<string>(fakeClock(1000));
    const entry: Entry<string> = { value: 'v', createdAt: 1000, hardExpiresAt: 1600 };
    await store.write(KEY.toString(), entry, 100000);
    const metrics = recordingMetrics();
    const cache = new Cache<string>({
      loader: () => 'loaded',
      hardTtlSec: 600,
      precomputeSec: 60,
      store,
      jitter: noJitter,
      singleFlight: alwaysLost,
      clock,
      metrics,
    });
    const r = await cache.get(KEY);
    expect(r.isHit()).toBe(true);
    expect(r.isStale()).toBe(false);
    expect(r.value()).toBe('v');
    expect(metrics.calls).toContainEqual(['cache_hit', { state: 'fresh' }]);
  });

  it('tier 3: follower past hard expiry is served the retained value as STALE', async () => {
    const clock = fakeClock(1700); // now >= hard(1600), value retained via grace
    const store = new MemoryStore<string>(fakeClock(1000));
    const entry: Entry<string> = { value: 'old', createdAt: 1000, hardExpiresAt: 1600 };
    await store.write(KEY.toString(), entry, 100000);
    const metrics = recordingMetrics();
    const cache = new Cache<string>({
      loader: () => 'loaded',
      hardTtlSec: 600,
      precomputeSec: 60,
      store,
      jitter: noJitter,
      singleFlight: alwaysLost,
      clock,
      metrics,
    });
    const r = await cache.get(KEY);
    expect(r.isStale()).toBe(true);
    expect(r.value()).toBe('old');
    expect(r.createdAt()).toBe(1000);
    expect(r.softExpiresAt()).toBe(1540);
    expect(metrics.calls).toContainEqual(['cache_hit', { state: 'stale' }]);
  });

  it('tier 4: follower waits and returns the leader\'s fresh value', async () => {
    const clock = fakeClock(1000);
    const store = new MemoryStore<string>(clock);
    const metrics = recordingMetrics();
    const cache = new Cache<string>({
      loader: () => 'unused',
      hardTtlSec: 600,
      precomputeSec: 60,
      store,
      jitter: noJitter,
      singleFlight: alwaysLost,
      clock,
      metrics,
      followerWaitMs: 500,
      followerPollMs: 10,
    });
    const p = cache.get(KEY);
    // A "leader" in another flight writes a fresh value mid-wait.
    setTimeout(() => {
      void store.write(KEY.toString(), { value: 'fresh', createdAt: 1000, hardExpiresAt: 1600 }, 600);
    }, 30);
    const r = await p;
    expect(r.isHit()).toBe(true);
    expect(r.value()).toBe('fresh');
    expect(metrics.calls).toContainEqual(['cache_hit', { state: 'fresh_after_sleep' }]);
  });

  it('tier 4 with precomputeSec == hardTtlSec: follower accepts the leader\'s write (no stampede)', async () => {
    // Regression: gating the follower wait on soft-expiry would reject an entry whose
    // soft ≈ createdAt (large precompute), sending every follower to fail-open.
    const clock = fakeClock(1000);
    const store = new MemoryStore<string>(clock);
    const loader = vi.fn(() => 'unused');
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 600, // soft == createdAt
      store,
      jitter: noJitter,
      singleFlight: alwaysLost,
      clock,
      followerWaitMs: 500,
      followerPollMs: 10,
    });
    const p = cache.get(KEY);
    setTimeout(() => {
      void store.write(KEY.toString(), { value: 'fresh', createdAt: 1000, hardExpiresAt: 1600 }, 600);
    }, 30);
    const r = await p;
    expect(r.isHit()).toBe(true);
    expect(r.value()).toBe('fresh');
    expect(loader).not.toHaveBeenCalled(); // served the leader's value, did not fail-open
  });

  it('leader timestamps the entry AFTER the loader resolves (PARITY §7.1)', async () => {
    const clock = fakeClock(1000);
    const store = new MemoryStore<string>(clock);
    const cache = new Cache<string>({
      loader: () => {
        clock.set(1005); // a "slow" loader: 5s elapse during recompute
        return 'v';
      },
      hardTtlSec: 600,
      precomputeSec: 60,
      store,
      jitter: noJitter,
      clock,
    });
    const r = await cache.get(KEY);
    expect(r.createdAt()).toBe(1005); // post-loader, not the pre-acquire 1000
    const stored = await store.read(KEY.toString());
    expect(stored?.createdAt).toBe(1005);
    expect(stored?.hardExpiresAt).toBe(1605);
  });

  it('tier 5a: fail-open computes without storing when no value and wait times out', async () => {
    const clock = fakeClock(1000);
    const store = new MemoryStore<string>(clock);
    const loader = vi.fn(() => 'fallback');
    const metrics = recordingMetrics();
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store,
      jitter: noJitter,
      singleFlight: alwaysLost,
      clock,
      metrics,
      failOpen: true,
      followerWaitMs: 30,
      followerPollMs: 10,
    });
    const r = await cache.get(KEY);
    expect(r.isHit()).toBe(true);
    expect(r.value()).toBe('fallback');
    expect(loader).toHaveBeenCalledOnce();
    expect(await store.read(KEY.toString())).toBeUndefined(); // NOT stored
    expect(metrics.calls).toContainEqual(['cache_miss', { cause: 'precompute_race' }]);
  });

  it('tier 5b: fail-closed returns a miss without consulting the loader', async () => {
    const clock = fakeClock(1000);
    const loader = vi.fn(() => {
      throw new Error('loader must not be called fail-closed');
    });
    const metrics = recordingMetrics();
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store: new MemoryStore(clock),
      jitter: noJitter,
      singleFlight: alwaysLost,
      clock,
      metrics,
      failOpen: false,
      followerWaitMs: 30,
      followerPollMs: 10,
    });
    const r = await cache.get(KEY);
    expect(r.isMiss()).toBe(true);
    expect(loader).not.toHaveBeenCalled();
    expect(metrics.calls).toContainEqual(['cache_miss', { cause: 'precompute_race_fail_closed' }]);
  });
});

describe('Cache.put', () => {
  it('stores with the jittered hard TTL', async () => {
    const clock = fakeClock(1000);
    const store = new MemoryStore<string>(clock);
    const jitter: Jitter = { apply: () => 555 };
    const metrics = recordingMetrics();
    const cache = new Cache<string>({ loader: () => 'x', hardTtlSec: 600, store, jitter, clock, metrics });
    await cache.put(KEY, 'v');
    const entry = await store.read(KEY.toString());
    expect(entry?.value).toBe('v');
    expect(entry?.createdAt).toBe(1000);
    expect(entry?.hardExpiresAt).toBe(1555); // now + jittered 555
    expect(metrics.calls).toContainEqual(['cache_put', undefined]);
  });
});

describe('Cache — invalidate / invalidateExact / refresh', () => {
  it('async invalidate dispatches an InvalidateEvent per element and does not touch the store', async () => {
    const dispatcher = recordingDispatcher();
    const store = { deletePrefix: vi.fn() } as unknown as Store<string>;
    const cache = new Cache<string>({ loader: () => 'x', hardTtlSec: 600, store, dispatcher });
    await cache.invalidate([new Key('a', 'f', 1), new Key('b', 'f', 2)]);
    expect(dispatcher.events).toHaveLength(2);
    expect(dispatcher.events[0]).toBeInstanceOf(InvalidateEvent);
  });

  it('sync invalidate deletes the whole subtree', async () => {
    const store = new MemoryStore<number>();
    await store.write('product/detail', { value: 0, createdAt: 1, hardExpiresAt: 9 }, 600);
    await store.write('product/detail/a', { value: 1, createdAt: 1, hardExpiresAt: 9 }, 600);
    const metrics = recordingMetrics();
    const cache = new Cache<number>({ loader: () => 0, hardTtlSec: 600, store, metrics });
    await cache.invalidate(new Key('product', 'detail', 'a'), SyncMode.SYNC);
    // Key used as a selector selects its whole subtree (its prefixString).
    await cache.invalidate({ toString: () => 'product/detail', segments: () => [] }, SyncMode.SYNC);
    expect(await store.read('product/detail')).toBeUndefined();
    expect(await store.read('product/detail/a')).toBeUndefined();
    expect(metrics.calls).toContainEqual(['cache_invalidate_hierarchical', undefined]);
  });

  it('async invalidateExact dispatches InvalidateExactEvent', async () => {
    const dispatcher = recordingDispatcher();
    const cache = new Cache<string>({ loader: () => 'x', hardTtlSec: 600, dispatcher });
    await cache.invalidateExact(KEY);
    expect(dispatcher.events[0]).toBeInstanceOf(InvalidateExactEvent);
  });

  it('sync invalidateExact removes only the named key', async () => {
    const store = new MemoryStore<number>();
    await store.write('product/detail/sku-1', { value: 1, createdAt: 1, hardExpiresAt: 9 }, 600);
    await store.write('product/detail/sku-1/child', { value: 2, createdAt: 1, hardExpiresAt: 9 }, 600);
    const cache = new Cache<number>({ loader: () => 0, hardTtlSec: 600, store });
    await cache.invalidateExact(KEY, SyncMode.SYNC);
    expect(await store.read('product/detail/sku-1')).toBeUndefined();
    expect(await store.read('product/detail/sku-1/child')).toBeDefined();
  });

  it('sync refresh loads and puts', async () => {
    const clock = fakeClock(1000);
    const store = new MemoryStore<string>(clock);
    const loader = vi.fn(() => 'rv');
    const cache = new Cache<string>({ loader, hardTtlSec: 600, store, jitter: noJitter, clock });
    await cache.refresh(KEY, SyncMode.SYNC);
    expect(loader).toHaveBeenCalledOnce();
    expect((await store.read(KEY.toString()))?.value).toBe('rv');
  });

  it('async refresh dispatches one RefreshEvent per key and never calls the loader', async () => {
    const dispatcher = recordingDispatcher();
    const loader = vi.fn(() => 'x');
    const cache = new Cache<string>({ loader, hardTtlSec: 600, dispatcher });
    await cache.refresh([new Key('a', 'f', 1), new Key('b', 'f', 2)]);
    expect(dispatcher.events).toHaveLength(2);
    expect(dispatcher.events[0]).toBeInstanceOf(RefreshEvent);
    expect(loader).not.toHaveBeenCalled();
  });

  it('an ASYNC op without a dispatcher throws', async () => {
    const cache = new Cache<string>({ loader: () => 'x', hardTtlSec: 600 });
    await expect(cache.invalidate(KEY, SyncMode.ASYNC)).rejects.toBeInstanceOf(AsyncDispatcherError);
  });
});

describe('Cache.asStore', () => {
  it('returns the underlying store', () => {
    const store = new MemoryStore<string>();
    const cache = new Cache<string>({ loader: () => 'x', hardTtlSec: 600, store });
    expect(cache.asStore()).toBe(store);
  });
});
