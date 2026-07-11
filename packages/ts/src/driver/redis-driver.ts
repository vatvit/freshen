import type { Entry } from '../item.js';
import type { Driver, SingleFlight } from '../ports.js';
import type { RedisLike } from './redis-like.js';

export interface RedisDriverOptions {
  /** Key namespace prefixed to every stored key. Default `'freshen'`. */
  namespace?: string;
  /** Namespace for single-flight lock keys. Default `'{namespace}:lock'`. */
  lockNamespace?: string;
  /** SCAN page size for prefix-subtree deletes. Default 512. */
  scanCount?: number;
}

/**
 * The Redis-aware backend (FRSH-044) — the TS analogue of PHP's `Freshen\Driver\Redis`.
 * Upgrades the core's best-effort guarantees to Freshen's **strong** ones over a
 * {@link RedisLike} client (client-agnostic; inject an ioredis/node-redis adapter):
 *
 *  - **Single-flight** — atomic `SET … NX PX` leader election ({@link SingleFlight}),
 *    the analogue of PHP `Item::lock()`. A lock self-heals via its `PX` TTL.
 *  - **Atomic delete** — exact (`DEL k`), batch (`DEL k1 k2 …`), and prefix-subtree
 *    (`SCAN` + `DEL`, never `KEYS`). Exact delete removes only the named key; prefix
 *    delete removes the key **and** its `key/*` subtree (PARITY §8).
 *  - **Batch read** — `MGET` (feeds getMany, FRSH-049).
 *
 * One instance implements both {@link Driver} (the store) and {@link SingleFlight}
 * (the lock); wire it as both: `new Cache({ store: driver, singleFlight: driver, … })`.
 *
 * Values are stored as JSON of the {@link Entry} envelope, so `T` must be
 * JSON-serialisable. A corrupt/undecodable value is treated as a miss (fail-open
 * spirit) rather than throwing into the read path.
 */
export class RedisDriver<T = unknown> implements Driver<T>, SingleFlight {
  private readonly ns: string;
  private readonly lockNs: string;
  private readonly scanCount: number;

  constructor(
    private readonly redis: RedisLike,
    options: RedisDriverOptions = {},
  ) {
    this.ns = options.namespace ?? 'freshen';
    this.lockNs = options.lockNamespace ?? `${this.ns}:lock`;
    this.scanCount = options.scanCount ?? 512;
  }

  async read(key: string): Promise<Entry<T> | undefined> {
    return this.decode(await this.redis.get(this.k(key)));
  }

  async write(key: string, entry: Entry<T>, ttlSec: number): Promise<void> {
    await this.redis.set(this.k(key), JSON.stringify(entry), { pxMs: Math.max(1, ttlSec) * 1000 });
  }

  async deleteExact(key: string): Promise<void> {
    await this.redis.del([this.k(key)]);
  }

  async deleteExactMany(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    await this.redis.del(keys.map((key) => this.k(key)));
  }

  async readMany(keys: string[]): Promise<Array<Entry<T> | undefined>> {
    if (keys.length === 0) {
      return [];
    }
    const values = await this.redis.mget(keys.map((key) => this.k(key)));
    return values.map((v) => this.decode(v));
  }

  /**
   * Delete the whole subtree under a prefix: the exact prefix key plus every
   * `prefix/*` descendant. Segments are rawurlencoded (glob-safe), so the SCAN
   * MATCH cannot be tricked by a `*`/`?`/`[` inside a key. Non-atomic by design —
   * invalidation is idempotent, and `SCAN` (unlike `KEYS`) never blocks the server.
   */
  async deletePrefix(prefix: string): Promise<void> {
    await this.redis.del([this.k(prefix)]);
    const match = this.k(prefix) + '/*';
    let cursor = '0';
    do {
      const page = await this.redis.scan(cursor, match, this.scanCount);
      cursor = page.cursor;
      if (page.keys.length > 0) {
        await this.redis.del(page.keys);
      }
    } while (cursor !== '0');
  }

  // --- SingleFlight (atomic cross-process leader election) ---

  acquire(key: string, ttlSec: number): Promise<boolean> {
    return this.redis.set(this.lockKey(key), '1', { pxMs: Math.max(1, ttlSec) * 1000, nx: true });
  }

  async release(key: string): Promise<void> {
    await this.redis.del([this.lockKey(key)]);
  }

  // --- internals ---

  private k(key: string): string {
    return `${this.ns}:${key}`;
  }

  private lockKey(key: string): string {
    return `${this.lockNs}:${key}`;
  }

  private decode(raw: string | null): Entry<T> | undefined {
    if (raw === null) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as Entry<T>;
    } catch {
      return undefined;
    }
  }
}
