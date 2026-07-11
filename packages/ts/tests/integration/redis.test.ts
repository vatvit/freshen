import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Cache,
  Key,
  RedisDriver,
  ioredisAdapter,
  nodeRedisAdapter,
  SyncMode,
} from '../../src/index.js';
import type { RedisLike, Jitter, Entry } from '../../src/index.js';

/**
 * The same suite runs against a live Redis through BOTH client adapters — proving
 * the strong guarantees (atomic SET NX single-flight, atomic exact/prefix/batch
 * delete, MGET) hold on real Redis with either ioredis or node-redis (FRSH-044).
 *
 * Run via scripts/ts-redis-it.sh (sets REDIS_URL to the redis:7 service).
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const noJitter: Jitter = { apply: (ttl) => ttl };

interface Backend {
  name: string;
  make(): Promise<{ redis: RedisLike; close(): Promise<unknown> }>;
}

const backends: Backend[] = [
  {
    name: 'ioredis',
    async make() {
      const mod = await import('ioredis');
      const Redis = (mod.default ?? mod) as unknown as new (url: string) => never;
      const client = new Redis(REDIS_URL);
      return { redis: ioredisAdapter(client as never), close: () => (client as { quit(): Promise<unknown> }).quit() };
    },
  },
  {
    name: 'node-redis',
    async make() {
      const { createClient } = await import('redis');
      const client = createClient({ url: REDIS_URL });
      await client.connect();
      return { redis: nodeRedisAdapter(client as never), close: () => client.quit() };
    },
  },
];

function entry(value: unknown, createdAt = 1000, hardExpiresAt = 1600): Entry {
  return { value, createdAt, hardExpiresAt };
}

describe.each(backends)('RedisDriver over live Redis via $name', (backend) => {
  let redis: RedisLike;
  let close: () => Promise<unknown>;
  let ns = 0;

  beforeAll(async () => {
    const made = await backend.make();
    redis = made.redis;
    close = made.close;
  });

  afterAll(async () => {
    await close();
  });

  // Isolate every test in its own namespace so a live server needs no flush.
  const driverFor = <T>(): RedisDriver<T> =>
    new RedisDriver<T>(redis, { namespace: `frshit:${backend.name}:${ns++}` });

  it('round-trips an entry', async () => {
    const d = driverFor();
    await d.write('product/detail/a', entry({ n: 1 }), 60);
    expect(await d.read('product/detail/a')).toEqual(entry({ n: 1 }));
  });

  it('SET NX gives exactly one leader', async () => {
    const d = driverFor();
    expect(await d.acquire('k', 30)).toBe(true);
    expect(await d.acquire('k', 30)).toBe(false);
    await d.release('k');
    expect(await d.acquire('k', 30)).toBe(true);
  });

  it('exact delete leaves the subtree; prefix delete drops it', async () => {
    const d = driverFor();
    await d.write('product/detail', entry(0), 60);
    await d.write('product/detail/a', entry(1), 60);
    await d.write('product/detail/a/deep', entry(2), 60);
    await d.write('product/detail-other', entry(3), 60);

    await d.deleteExact('product/detail');
    expect(await d.read('product/detail')).toBeUndefined();
    expect(await d.read('product/detail/a')).toBeDefined();

    await d.deletePrefix('product/detail');
    expect(await d.read('product/detail/a')).toBeUndefined();
    expect(await d.read('product/detail/a/deep')).toBeUndefined();
    expect(await d.read('product/detail-other')).toBeDefined();
  });

  it('MGET batch read preserves order and marks misses', async () => {
    const d = driverFor();
    await d.write('a', entry('A'), 60);
    await d.write('c', entry('C'), 60);
    const out = await d.readMany(['a', 'b', 'c']);
    expect(out.map((e) => e?.value)).toEqual(['A', undefined, 'C']);
  });

  it('full SWR cycle: leader fills, follower hits fresh, invalidateExact clears', async () => {
    const d = driverFor<string>();
    const clock = { now: () => 1000 };
    const loader = vi.fn(() => 'v');
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 60,
      precomputeSec: 6,
      store: d,
      singleFlight: d,
      jitter: noJitter,
      clock,
    });
    const key = new Key('product', 'detail', 'sku-1');

    const first = await cache.get(key);
    expect(first.value()).toBe('v');
    const second = await cache.get(key);
    expect(second.isHit()).toBe(true);
    expect(loader).toHaveBeenCalledOnce(); // second read was a fresh hit, no recompute

    await cache.invalidateExact(key, SyncMode.SYNC);
    expect(await d.read(key.toString())).toBeUndefined();
  });

  it('concurrent cold reads recompute once', async () => {
    const d = driverFor<string>();
    const clock = { now: () => 1000 };
    const loader = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'value';
    });
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 60,
      precomputeSec: 6,
      store: d,
      singleFlight: d,
      jitter: noJitter,
      clock,
      followerWaitMs: 1000,
      followerPollMs: 20,
    });
    const key = new Key('hot', 'key', 1);
    const results = await Promise.all(Array.from({ length: 5 }, () => cache.get(key)));
    expect(loader).toHaveBeenCalledOnce();
    for (const r of results) {
      expect(r.value()).toBe('value');
    }
  });
});
