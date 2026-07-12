import { describe, expect, it, vi } from 'vitest';
import { RedisDriver } from './redis-driver.js';
import { RedisLock } from '../lock/redis-lock.js';
import { FakeRedis } from '../testing/fake-redis.js';
import { Cache } from '../cache.js';
import { Key } from '../key.js';
import type { Jitter } from '../ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };

// Byte-agnostic driver (FRSH-060): it stores the opaque packed string verbatim — no
// JSON encode/decode here. Tests use plain string payloads.

describe('RedisDriver', () => {
  it('round-trips the packed string verbatim', async () => {
    const driver = new RedisDriver(new FakeRedis());
    await driver.write('product/detail/a', 'packed-payload', 600);
    expect(await driver.read('product/detail/a')).toBe('packed-payload');
  });

  it('returns undefined for a missing key', async () => {
    expect(await new RedisDriver(new FakeRedis()).read('nope')).toBeUndefined();
  });

  it('deleteExact removes only the named key', async () => {
    const driver = new RedisDriver(new FakeRedis());
    await driver.write('product/detail/a', '1', 600);
    await driver.write('product/detail/a/child', '2', 600);
    await driver.deleteExact('product/detail/a');
    expect(await driver.read('product/detail/a')).toBeUndefined();
    expect(await driver.read('product/detail/a/child')).toBeDefined();
  });

  it('deleteExactMany batches deletes', async () => {
    const redis = new FakeRedis();
    const delSpy = vi.spyOn(redis, 'del');
    const driver = new RedisDriver(redis);
    await driver.write('a', '1', 600);
    await driver.write('b', '2', 600);
    await driver.deleteExactMany(['a', 'b']);
    expect(delSpy).toHaveBeenCalledOnce(); // one round-trip for the whole set
    expect(await driver.read('a')).toBeUndefined();
    expect(await driver.read('b')).toBeUndefined();
  });

  it('readMany preserves order and marks misses undefined', async () => {
    const driver = new RedisDriver(new FakeRedis());
    await driver.write('a', 'A', 600);
    await driver.write('c', 'C', 600);
    const out = await driver.readMany(['a', 'b', 'c']);
    expect(out).toEqual(['A', undefined, 'C']);
  });

  it('deletePrefix removes the subtree but not siblings', async () => {
    const driver = new RedisDriver(new FakeRedis());
    await driver.write('product/detail', '0', 600);
    await driver.write('product/detail/a', '1', 600);
    await driver.write('product/detail/a/deep', '2', 600);
    await driver.write('product/detail-other', '3', 600);
    await driver.write('product/list/a', '4', 600);
    await driver.deletePrefix('product/detail');
    expect(await driver.read('product/detail')).toBeUndefined();
    expect(await driver.read('product/detail/a')).toBeUndefined();
    expect(await driver.read('product/detail/a/deep')).toBeUndefined();
    expect(await driver.read('product/detail-other')).toBeDefined();
    expect(await driver.read('product/list/a')).toBeDefined();
  });
});

describe('Cache over RedisDriver + RedisLock — single-flight', () => {
  it('two concurrent cold gets recompute once (leader) and the other is served the fill', async () => {
    const clock = { now: () => 1000 };
    const redis = new FakeRedis();
    const driver = new RedisDriver(redis);
    const loader = vi.fn(() => 'value');
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store: driver,
      lock: new RedisLock(redis),
      jitter: noJitter,
      clock,
      followerWaitMs: 500,
      followerPollMs: 10,
    });
    const key = new Key('product', 'detail', 'sku-1');
    const [a, b] = await Promise.all([cache.get(key), cache.get(key)]);
    expect(loader).toHaveBeenCalledOnce();
    expect(a.value()).toBe('value');
    expect(b.value()).toBe('value');
  });
});
