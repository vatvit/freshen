import { describe, expect, it, vi } from 'vitest';
import { RedisDriver } from './redis-driver.js';
import { FakeRedis } from '../testing/fake-redis.js';
import { Cache } from '../cache.js';
import { Key } from '../key.js';
import type { Entry } from '../item.js';
import type { Jitter } from '../ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };

function entry(value: unknown, createdAt = 1000, hardExpiresAt = 1600): Entry {
  return { value, createdAt, hardExpiresAt };
}

describe('RedisDriver', () => {
  it('round-trips an entry as JSON', async () => {
    const driver = new RedisDriver(new FakeRedis());
    await driver.write('product/detail/a', entry({ n: 1 }), 600);
    expect(await driver.read('product/detail/a')).toEqual(entry({ n: 1 }));
  });

  it('returns undefined for a missing key', async () => {
    expect(await new RedisDriver(new FakeRedis()).read('nope')).toBeUndefined();
  });

  it('treats a corrupt value as a miss', async () => {
    const redis = new FakeRedis();
    await redis.set('freshen:bad', '{not json');
    expect(await new RedisDriver(redis).read('bad')).toBeUndefined();
  });

  it('deleteExact removes only the named key', async () => {
    const driver = new RedisDriver(new FakeRedis());
    await driver.write('product/detail/a', entry(1), 600);
    await driver.write('product/detail/a/child', entry(2), 600);
    await driver.deleteExact('product/detail/a');
    expect(await driver.read('product/detail/a')).toBeUndefined();
    expect(await driver.read('product/detail/a/child')).toBeDefined();
  });

  it('deleteExactMany batches deletes', async () => {
    const redis = new FakeRedis();
    const delSpy = vi.spyOn(redis, 'del');
    const driver = new RedisDriver(redis);
    await driver.write('a', entry(1), 600);
    await driver.write('b', entry(2), 600);
    await driver.deleteExactMany(['a', 'b']);
    expect(delSpy).toHaveBeenCalledOnce(); // one round-trip for the whole set
    expect(await driver.read('a')).toBeUndefined();
    expect(await driver.read('b')).toBeUndefined();
  });

  it('readMany preserves order and marks misses undefined', async () => {
    const driver = new RedisDriver(new FakeRedis());
    await driver.write('a', entry('A'), 600);
    await driver.write('c', entry('C'), 600);
    const out = await driver.readMany(['a', 'b', 'c']);
    expect(out.map((e) => e?.value)).toEqual(['A', undefined, 'C']);
  });

  it('deletePrefix removes the subtree but not siblings', async () => {
    const driver = new RedisDriver(new FakeRedis());
    await driver.write('product/detail', entry(0), 600);
    await driver.write('product/detail/a', entry(1), 600);
    await driver.write('product/detail/a/deep', entry(2), 600);
    await driver.write('product/detail-other', entry(3), 600);
    await driver.write('product/list/a', entry(4), 600);
    await driver.deletePrefix('product/detail');
    expect(await driver.read('product/detail')).toBeUndefined();
    expect(await driver.read('product/detail/a')).toBeUndefined();
    expect(await driver.read('product/detail/a/deep')).toBeUndefined();
    expect(await driver.read('product/detail-other')).toBeDefined();
    expect(await driver.read('product/list/a')).toBeDefined();
  });

  it('acquire is an atomic NX lock returning a token; fenced release frees it', async () => {
    const driver = new RedisDriver(new FakeRedis());
    const token = await driver.acquire('k', 30);
    expect(token).not.toBeNull();
    expect(await driver.acquire('k', 30)).toBeNull(); // held
    await driver.release('k', token as string);
    expect(await driver.acquire('k', 30)).not.toBeNull(); // free again
  });

  it('release with a foreign token does NOT free another leader\'s lock (fenced unlock)', async () => {
    const driver = new RedisDriver(new FakeRedis());
    const mine = await driver.acquire('k', 30);
    await driver.release('k', 'someone-elses-token'); // must be a no-op
    expect(await driver.acquire('k', 30)).toBeNull(); // still held by `mine`
    await driver.release('k', mine as string);
    expect(await driver.acquire('k', 30)).not.toBeNull();
  });
});

describe('Cache over RedisDriver — single-flight', () => {
  it('two concurrent cold gets recompute once (leader) and the other is served the fill', async () => {
    const clock = { now: () => 1000 };
    const driver = new RedisDriver<string>(new FakeRedis());
    const loader = vi.fn(() => 'value');
    const cache = new Cache<string>({
      loader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store: driver,
      singleFlight: driver,
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
