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

  incr(key: string): Promise<number> {
    const cur = this.live(key)?.value;
    const n = (cur === undefined ? 0 : parseInt(cur, 10)) + 1;
    // Generation counters never expire (mirror Stash's pathdb — no TTL).
    this.map.set(key, { value: String(n), expireAt: Infinity });
    return Promise.resolve(n);
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

  /**
   * Minimal EVAL: supports the only script Freshen uses — the fenced-unlock
   * compare-and-delete (`GET KEYS[1] == ARGV[1] ? DEL : 0`). Not a general Lua VM.
   */
  eval(_script: string, keys: string[], args: string[]): Promise<unknown> {
    const key = keys[0];
    const token = args[0];
    if (key !== undefined && token !== undefined && this.live(key)?.value === token) {
      this.map.delete(key);
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
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
