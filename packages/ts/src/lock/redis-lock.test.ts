import { describe, expect, it } from 'vitest';
import { RedisLock } from './redis-lock.js';
import { FakeRedis } from '../testing/fake-redis.js';

describe('RedisLock', () => {
  it('acquire is an atomic NX lock returning a token; fenced release frees it', async () => {
    const lock = new RedisLock(new FakeRedis());
    const token = await lock.acquire('k', 30);
    expect(token).not.toBeNull();
    expect(await lock.acquire('k', 30)).toBeNull(); // held
    await lock.release('k', token as string);
    expect(await lock.acquire('k', 30)).not.toBeNull(); // free again
  });

  it('release with a foreign token does NOT free another owner\'s lock (fenced unlock)', async () => {
    const lock = new RedisLock(new FakeRedis());
    const mine = await lock.acquire('k', 30);
    await lock.release('k', 'someone-elses-token'); // must be a no-op
    expect(await lock.acquire('k', 30)).toBeNull(); // still held by `mine`
    await lock.release('k', mine as string);
    expect(await lock.acquire('k', 30)).not.toBeNull();
  });

  it('uses a distinct namespace from stored values', async () => {
    const redis = new FakeRedis();
    const lock = new RedisLock(redis, { namespace: 'app:lock' });
    const token = await lock.acquire('product/detail/x', 30);
    expect(token).not.toBeNull();
    // The lock lives under the lock namespace, not the value key.
    expect(await redis.get('app:lock:product/detail/x')).toBe(token);
  });
});
