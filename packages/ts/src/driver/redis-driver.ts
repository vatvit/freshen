import type { Driver } from '../ports.js';
import type { RedisLike } from './redis-like.js';

export interface RedisDriverOptions {
  /** Key namespace prefixed to every stored key. Default `'freshen'`. */
  namespace?: string;
  /** SCAN page size for prefix-subtree deletes. Default 512. */
  scanCount?: number;
}

/**
 * The Redis-aware **store** (FRSH-044) — the TS analogue of PHP's `Freshen\Driver\Redis`.
 * Upgrades the core's best-effort delete/read to Freshen's **strong** ones over a
 * {@link RedisLike} client (client-agnostic; inject an ioredis/node-redis adapter):
 *
 *  - **Atomic delete** — exact (`DEL k`), batch (`DEL k1 k2 …`), and prefix-subtree
 *    (`SCAN` + `DEL`, never `KEYS`). Exact delete removes only the named key; prefix
 *    delete removes the key **and** its `key/*` subtree (PARITY §8).
 *  - **Batch read** — `MGET` (feeds getMany, FRSH-049).
 *
 * This is a **store strategy only**. The cross-process single-flight **lock** is the
 * separate {@link RedisLock} strategy (`src/lock/`); wire them from the same client:
 * `new Cache({ store: new RedisDriver(redis), lock: new RedisLock(redis) })`.
 *
 * Byte-agnostic (FRSH-060): the driver stores the opaque **packed string** the Cache
 * hands it, verbatim — no JSON encode/decode here. All (de)serialisation + compression
 * is the Cache's {@link Codec}, so Redis holds the same bytes the in-memory store does.
 */
export class RedisDriver implements Driver {
  private readonly ns: string;
  private readonly scanCount: number;

  constructor(
    private readonly redis: RedisLike,
    options: RedisDriverOptions = {},
  ) {
    this.ns = options.namespace ?? 'freshen';
    this.scanCount = options.scanCount ?? 512;
  }

  async read(key: string): Promise<string | undefined> {
    return (await this.redis.get(this.k(key))) ?? undefined;
  }

  async write(key: string, packed: string, ttlSec: number): Promise<void> {
    await this.redis.set(this.k(key), packed, { pxMs: Math.max(1, ttlSec) * 1000 });
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

  async readMany(keys: string[]): Promise<Array<string | undefined>> {
    if (keys.length === 0) {
      return [];
    }
    const values = await this.redis.mget(keys.map((key) => this.k(key)));
    return values.map((v) => v ?? undefined);
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

  // --- internals ---

  private k(key: string): string {
    return `${this.ns}:${key}`;
  }
}
