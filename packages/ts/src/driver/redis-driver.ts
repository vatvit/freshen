import type { Driver } from '../ports.js';
import type { RedisLike } from './redis-like.js';

export interface RedisDriverOptions {
  /** Key namespace prefixed to every stored key. Default `'freshen'`. */
  namespace?: string;
}

/**
 * The Redis-aware **store** (FRSH-044) — the TS analogue of PHP's `Freshen\Driver\Redis`.
 * Upgrades the core's best-effort delete/read to Freshen's **strong** ones over a
 * {@link RedisLike} client (client-agnostic; inject an ioredis/node-redis adapter):
 *
 *  - **Hierarchical invalidation = one atomic `INCR`** (FRSH-056) — generation-versioned,
 *    O(1), never `SCAN`/`KEYS`. Mirrors Stash's path-index increment: every physical value
 *    key embeds the current generation of **each of its ancestor path segments**
 *    (`domain`, `facet`, `[schema]`, `[locale]`, `id`). `invalidate(prefix)` bumps that
 *    prefix's counter, so every key underneath instantly resolves to a new physical key and
 *    the old subtree is unreachable at once; orphans expire on their own TTL. A key written
 *    **concurrently** with an invalidate is handled correctly — it embeds whichever
 *    generation was current, so the invalidate still wins (the race the old `SCAN` loop lost).
 *  - **Exact / batch delete** — `DEL k` / `DEL k1 k2 …` of the resolved physical key(s).
 *  - **Batch read** — `MGET` (feeds getMany, FRSH-049).
 *
 * This is a **store strategy only**. The cross-process single-flight **lock** is the
 * separate {@link RedisLock} strategy (`src/lock/`); wire them from the same client:
 * `new Cache({ store: new RedisDriver(redis), lock: new RedisLock(redis) })`.
 *
 * Byte-agnostic (FRSH-060): the driver stores the opaque **packed string** the Cache hands
 * it, verbatim — no JSON encode/decode here.
 *
 * **Read-side cost:** resolving a key's physical location reads its ancestor generations
 * first — one pipelined `MGET` of ≤ (key depth) counters — then the value `GET`. So a read
 * is ~2 round-trips (getMany batches all generation lookups + values into ~2 total). This is
 * the deterministic trade for O(1) atomic invalidation, and matches how the PHP reference
 * (Stash) resolves its per-segment path index.
 */
export class RedisDriver implements Driver {
  private readonly ns: string;

  constructor(
    private readonly redis: RedisLike,
    options: RedisDriverOptions = {},
  ) {
    this.ns = options.namespace ?? 'freshen';
  }

  async read(key: string): Promise<string | undefined> {
    return (await this.redis.get(await this.physicalKey(key))) ?? undefined;
  }

  async write(key: string, packed: string, ttlSec: number): Promise<void> {
    await this.redis.set(await this.physicalKey(key), packed, { pxMs: Math.max(1, ttlSec) * 1000 });
  }

  async deleteExact(key: string): Promise<void> {
    await this.redis.del([await this.physicalKey(key)]);
  }

  async deleteExactMany(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    await this.redis.del(await this.physicalKeys(keys));
  }

  async readMany(keys: string[]): Promise<Array<string | undefined>> {
    if (keys.length === 0) {
      return [];
    }
    const values = await this.redis.mget(await this.physicalKeys(keys));
    return values.map((v) => v ?? undefined);
  }

  /**
   * Hierarchical subtree invalidation (PARITY §8) — a single atomic `INCR` of the prefix's
   * generation counter. O(1), no `SCAN`/`KEYS`. Every key whose physical location embedded
   * the old generation of this prefix becomes unreachable at once (the exact prefix node and
   * its whole `prefix/*` subtree); the orphaned entries expire on their own TTL.
   */
  async deletePrefix(prefix: string): Promise<void> {
    await this.redis.incr(this.genKey(prefix));
  }

  // --- internals: generation-versioned key resolution ---

  /** `${ns}:g:${cumulativePath}` — the generation counter for one path node. */
  private genKey(path: string): string {
    return `${this.ns}:g:${path}`;
  }

  /** Resolve one logical key to its current physical Redis key. */
  private async physicalKey(key: string): Promise<string> {
    const segments = key.split('/');
    const gens = await this.resolveGenerations(cumulativePaths(segments));
    return this.buildPhysicalKey(segments, gens);
  }

  /**
   * Resolve many logical keys to physical keys in ONE generation `MGET` (all distinct
   * ancestor-path counters across the batch, deduped), then build each physical key.
   */
  private async physicalKeys(keys: string[]): Promise<string[]> {
    const perKey = keys.map((k) => {
      const segments = k.split('/');
      return { segments, paths: cumulativePaths(segments) };
    });
    const distinct = [...new Set(perKey.flatMap((e) => e.paths))];
    const gens = await this.resolveGenerations(distinct);
    const genOf = new Map<string, number>(distinct.map((p, i): [string, number] => [p, gens[i] ?? 0]));
    return perKey.map((e) =>
      this.buildPhysicalKey(
        e.segments,
        e.paths.map((p) => genOf.get(p) ?? 0),
      ),
    );
  }

  /** Batch-read the current generation of each path (absent counter ⇒ 0). */
  private async resolveGenerations(paths: string[]): Promise<number[]> {
    if (paths.length === 0) {
      return [];
    }
    const raw = await this.redis.mget(paths.map((p) => this.genKey(p)));
    return raw.map((v) => {
      if (v === null) {
        return 0;
      }
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : 0;
    });
  }

  /**
   * Interleave each segment with the generation of its cumulative ancestor path:
   * `${ns}:d:seg1#g1/seg2#g2/…`. `#` is segment-safe — segments are rawurlencoded, which
   * always percent-encodes `#`, so it can never appear literally inside a segment.
   */
  private buildPhysicalKey(segments: string[], gens: number[]): string {
    const body = segments.map((seg, i) => `${seg}#${gens[i] ?? 0}`).join('/');
    return `${this.ns}:d:${body}`;
  }
}

/** `['a','b','c'] → ['a', 'a/b', 'a/b/c']` — each segment's cumulative ancestor path. */
function cumulativePaths(segments: string[]): string[] {
  const out: string[] = [];
  let acc = '';
  segments.forEach((seg, i) => {
    acc = i === 0 ? seg : `${acc}/${seg}`;
    out.push(acc);
  });
  return out;
}
