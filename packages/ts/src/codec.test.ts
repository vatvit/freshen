import { describe, expect, it } from 'vitest';
import { gzipJsonCodec, withCodec } from './codec.js';
import type { Codec } from './codec.js';
import { Cache } from './cache.js';
import { Key } from './key.js';
import { MemoryStore } from './store/memory-store.js';
import { RedisDriver } from './driver/redis-driver.js';
import { RedisLock } from './lock/redis-lock.js';
import { FakeRedis } from './testing/fake-redis.js';
import { isDriver } from './ports.js';
import type { Clock } from './clock.js';
import type { Entry } from './item.js';
import type { Jitter, Store } from './ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };
const clock: Clock = { now: () => 1000 };
const KEY = new Key('doc', 'body', 'sku-1');

describe('gzipJsonCodec', () => {
  it('round-trips a value', () => {
    const codec = gzipJsonCodec<{ text: string }>();
    const value = { text: 'x'.repeat(5000) };
    const encoded = codec.encode(value);
    expect(typeof encoded).toBe('string');
    expect(codec.decode(encoded)).toEqual(value);
  });

  it('produces a smaller payload for a compressible value', () => {
    const codec = gzipJsonCodec<string>();
    const encoded = codec.encode('a'.repeat(10000)) as string;
    expect(encoded.length).toBeLessThan(10000);
  });
});

describe('withCodec', () => {
  it('stores encoded and returns decoded (observable value unchanged)', async () => {
    const inner = new MemoryStore(clock);
    const store = withCodec(inner, gzipJsonCodec<string>());
    const cache = new Cache<string>({ loader: () => 'hello', hardTtlSec: 600, store, jitter: noJitter, clock });
    await cache.put(KEY, 'the payload');
    // Raw envelope holds an encoded (non-plaintext) value...
    const raw = (await inner.read(KEY.toString())) as Entry<unknown>;
    expect(raw.value).not.toBe('the payload');
    expect(raw.createdAt).toBe(1000); // ...but timestamps stay intact
    // ...while the cache observes the original value.
    expect((await cache.get(KEY)).value()).toBe('the payload');
  });

  it('treats a corrupt payload as a miss (fail-open), triggering recompute', async () => {
    const inner = new MemoryStore<unknown>(clock);
    const bad: Codec<string> = {
      encode: (v) => v,
      decode: () => {
        throw new Error('corrupt');
      },
    };
    const store = withCodec(inner, bad);
    const cache = new Cache<string>({ loader: () => 'recomputed', hardTtlSec: 600, store, jitter: noJitter, clock });
    await inner.write(KEY.toString(), { value: 'garbage', createdAt: 1000, hardExpiresAt: 1600 }, 600);
    const r = await cache.get(KEY);
    expect(r.value()).toBe('recomputed'); // decode failed -> miss -> loader
  });

  it('preserves Driver capabilities (getMany still batches) when wrapping a driver', async () => {
    const redis = new FakeRedis();
    const driver = new RedisDriver<unknown>(redis);
    const store = withCodec(driver, gzipJsonCodec<string>());
    expect(isDriver(store as Store<string>)).toBe(true);
    const cache = new Cache<string>({
      loader: (k) => `v:${k.idString()}`,
      hardTtlSec: 600,
      precomputeSec: 60,
      store,
      lock: new RedisLock(redis),
      jitter: noJitter,
      clock,
    });
    await cache.put(new Key('doc', 'body', 1), 'A');
    await cache.put(new Key('doc', 'body', 2), 'B');
    const out = await cache.getMany([new Key('doc', 'body', 1), new Key('doc', 'body', 2)]);
    expect(out.map((r) => r.value())).toEqual(['A', 'B']);
  });

  it('leaves negative entries untouched by the codec', async () => {
    const inner = new MemoryStore<unknown>(clock);
    const throwingOnValue: Codec<string> = {
      encode: (v) => {
        if (v === undefined) throw new Error('should not encode negative');
        return v;
      },
      decode: (s) => s as string,
    };
    const store = withCodec(inner, throwingOnValue);
    // Writing a negative entry must not invoke the codec on its (undefined) value.
    await expect(
      store.write(KEY.toString(), { value: undefined as unknown as string, createdAt: 1000, hardExpiresAt: 1030, negative: true }, 30),
    ).resolves.toBeUndefined();
  });
});
