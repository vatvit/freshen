import type { RedisLike, RedisScanPage, RedisSetOptions } from '../driver/redis-like.js';

interface Slot {
  value: string;
  expireAt: number; // ms epoch; Infinity = no expiry
}

/**
 * An in-memory {@link RedisLike} for unit tests — enough of Redis's semantics to
 * exercise the driver deterministically without a live server: `SET NX/PX`, lazy
 * `PX` expiry, `DEL`, `MGET`, and glob `SCAN`. Not for production use.
 */
export class FakeRedis implements RedisLike {
  private readonly map = new Map<string, Slot>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.live(key)?.value ?? null);
  }

  set(key: string, value: string, opts?: RedisSetOptions): Promise<boolean> {
    if (opts?.nx === true && this.live(key) !== undefined) {
      return Promise.resolve(false);
    }
    const expireAt = opts?.pxMs !== undefined ? Date.now() + opts.pxMs : Infinity;
    this.map.set(key, { value, expireAt });
    return Promise.resolve(true);
  }

  del(keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.map.delete(key)) {
        removed++;
      }
    }
    return Promise.resolve(removed);
  }

  mget(keys: string[]): Promise<Array<string | null>> {
    return Promise.resolve(keys.map((key) => this.live(key)?.value ?? null));
  }

  scan(cursor: string, match: string, _count: number): Promise<RedisScanPage> {
    // One-shot scan: return every live match in a single page (cursor '0').
    const re = globToRegExp(match);
    const keys: string[] = [];
    for (const key of this.map.keys()) {
      if (this.live(key) !== undefined && re.test(key)) {
        keys.push(key);
      }
    }
    return Promise.resolve({ cursor: '0', keys });
  }

  /** Test helper: how many live keys are stored. */
  size(): number {
    let n = 0;
    for (const key of this.map.keys()) {
      if (this.live(key) !== undefined) {
        n++;
      }
    }
    return n;
  }

  private live(key: string): Slot | undefined {
    const slot = this.map.get(key);
    if (slot === undefined) {
      return undefined;
    }
    if (Date.now() >= slot.expireAt) {
      this.map.delete(key);
      return undefined;
    }
    return slot;
  }
}

function globToRegExp(glob: string): RegExp {
  let out = '^';
  for (const ch of glob) {
    out += ch === '*' ? '.*' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out + '$');
}
