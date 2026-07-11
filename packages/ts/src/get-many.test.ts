import { describe, expect, it, vi } from 'vitest';
import { Cache } from './cache.js';
import { Key } from './key.js';
import { MemoryStore } from './store/memory-store.js';
import { RedisDriver } from './driver/redis-driver.js';
import { FakeRedis } from './testing/fake-redis.js';
import type { Clock } from './clock.js';
import type { Jitter } from './ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };
const clock: Clock = { now: () => 1000 };

const K = (id: number): Key => new Key('product', 'detail', id);

describe('Cache.getMany (FRSH-049)', () => {
  it('returns [] for an empty key list', async () => {
    const cache = new Cache<string>({ loader: () => 'x', hardTtlSec: 600, jitter: noJitter, clock });
    expect(await cache.getMany([])).toEqual([]);
  });

  it('returns one order-preserving result per key', async () => {
    const cache = new Cache<string>({
      loader: (k) => `v:${k.idString()}`,
      hardTtlSec: 600,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
    });
    const results = await cache.getMany([K(1), K(2), K(3)]);
    expect(results.map((r) => r.value())).toEqual(['v:1', 'v:2', 'v:3']);
  });

  it('serves fresh hits from the batch read without calling the loader', async () => {
    const loader = vi.fn((k: Key) => `v:${k.idString()}`);
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
    });
    await cache.put(K(1), 'A');
    await cache.put(K(2), 'B');
    loader.mockClear();
    const results = await cache.getMany([K(1), K(2)]);
    expect(results.map((r) => r.value())).toEqual(['A', 'B']);
    expect(loader).not.toHaveBeenCalled(); // both fresh
  });

  it('recomputes only the missing keys, preserving order', async () => {
    const loader = vi.fn((k: Key) => `loaded:${k.idString()}`);
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
    });
    await cache.put(K(2), 'cached-B'); // only key 2 is warm
    loader.mockClear();
    const results = await cache.getMany([K(1), K(2), K(3)]);
    expect(results.map((r) => r.value())).toEqual(['loaded:1', 'cached-B', 'loaded:3']);
    expect(loader).toHaveBeenCalledTimes(2); // only the two misses
  });

  it('uses the driver MGET in a single round-trip on Redis', async () => {
    const redis = new FakeRedis();
    const driver = new RedisDriver<string>(redis);
    const mgetSpy = vi.spyOn(redis, 'mget');
    const cache = new Cache<string>({
      loader: (k) => `v:${k.idString()}`,
      hardTtlSec: 600,
      precomputeSec: 60,
      store: driver,
      singleFlight: driver,
      jitter: noJitter,
      clock,
    });
    await cache.put(K(1), 'A');
    await cache.put(K(2), 'B');
    mgetSpy.mockClear();
    const results = await cache.getMany([K(1), K(2)]);
    expect(results.map((r) => r.value())).toEqual(['A', 'B']);
    expect(mgetSpy).toHaveBeenCalledOnce(); // one MGET for the whole batch
  });
});
