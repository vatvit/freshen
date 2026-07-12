import { randomUUID } from 'node:crypto';
import type { RedisLike } from '../driver/redis-like.js';
import type { SingleFlightLock } from '../ports.js';

/** Fenced unlock: delete the lock only if this caller still owns the token. */
const RELEASE_LOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export interface RedisLockOptions {
  /** Namespace prefixed to every lock key. Default `'freshen:lock'`. */
  namespace?: string;
}

/**
 * Cross-process single-flight lock over Redis (FRSH-044) — the atomic leader election
 * the in-memory {@link InProcessLock} can only approximate. A lock strategy, separate
 * from the {@link RedisDriver} store strategy: wire them from the same client, e.g.
 * `new Cache({ store: new RedisDriver(redis), lock: new RedisLock(redis) })`.
 *
 *  - **`acquire`** — atomic `SET … NX PX`: exactly one caller wins and gets an
 *    ownership token; the lock self-heals via its `PX` TTL if a leader dies (analogue
 *    of PHP `Item::lock()`).
 *  - **`release`** — a Lua compare-and-delete (fenced unlock): frees the lock only if
 *    this caller still holds its token, so a leader whose lock TTL-expired (and was
 *    re-acquired by another) cannot delete the new owner's lock.
 */
export class RedisLock implements SingleFlightLock {
  private readonly ns: string;

  constructor(
    private readonly redis: RedisLike,
    options: RedisLockOptions = {},
  ) {
    this.ns = options.namespace ?? 'freshen:lock';
  }

  async acquire(key: string, ttlSec: number): Promise<string | null> {
    const token = randomUUID();
    const won = await this.redis.set(this.lockKey(key), token, {
      pxMs: Math.max(1, ttlSec) * 1000,
      nx: true,
    });
    return won ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_LUA, [this.lockKey(key)], [token]);
  }

  private lockKey(key: string): string {
    return `${this.ns}:${key}`;
  }
}
