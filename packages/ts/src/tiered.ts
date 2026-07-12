import { Cache } from './cache.js';
import type { CacheOptions } from './cache.js';
import type { Clock } from './clock.js';
import { NotFoundError } from './errors.js';
import type { Key } from './key.js';
import type { LoaderFn } from './loader.js';
import type { Loader, Selector, SingleFlightLock } from './ports.js';
import { LruStore } from './store/lru-store.js';
import { SyncMode } from './sync-mode.js';
import type { ValueResult } from './value-result.js';

/** L1 (in-memory LRU) tier configuration. */
export interface L1Options {
  /** Bounded LRU size in entries (mandatory bound). */
  max: number;
  /**
   * L1 hard TTL, seconds. Keep it **short** — it doubles as the multi-instance
   * coherence backstop: each process has its own L1, so a short L1 TTL bounds how
   * long a stale local copy can survive an invalidation applied on another process
   * (a Redis pub/sub eviction channel is a future option; not in RC1).
   */
  hardTtlSec: number;
  precomputeSec?: number;
  clock?: Clock;
  lock?: SingleFlightLock;
}

export interface TieredCacheOptions<T = unknown> {
  /** The source (DB) loader — L2's loader. */
  loader: Loader<T> | LoaderFn<T>;
  /** L1 (in-memory LRU) tier. */
  l1: L1Options;
  /** L2 (e.g. Redis) tier — a full `Cache` config minus its loader (supplied above). */
  l2: Omit<CacheOptions<T>, 'loader'>;
}

/**
 * Two-level cache (FRSH-047) — **Approach A: stacked `Cache` instances**. L1 is a
 * `Cache` over a bounded {@link LruStore} whose loader is L2; L2 is a `Cache` (e.g.
 * over the Redis driver) whose loader is the DB. Reads cascade L1 → L2 → source and
 * backfill L1 automatically (pure composition — the core `Cache` is unchanged, so the
 * parity oracle is untouched; tiering is additive). Each tier keeps its own TTLs, and
 * L2 retains its atomic single-flight.
 *
 * This wrapper exists only for **wiring ergonomics + coherence**: a single-instance
 * invalidation must evict **both** tiers, so the mutating ops fan out to L1 and L2.
 */
export class TieredCache<T = unknown> {
  private constructor(
    private readonly l1: Cache<T>,
    private readonly l2: Cache<T>,
  ) {}

  static create<T>(options: TieredCacheOptions<T>): TieredCache<T> {
    const l2 = new Cache<T>({ ...options.l2, loader: options.loader });
    const clock = options.l1.clock ?? options.l2.clock;
    const l1 = new Cache<T>({
      store: new LruStore(options.l1.max, clock),
      // L1's loader is L2: a cascade read. A MISS from L2 becomes a not-found so L1
      // does not cache a phantom value.
      loader: (key: Key) =>
        l2.get(key).then((r) => {
          if (r.isMiss()) {
            throw new NotFoundError();
          }
          return r.value();
        }),
      hardTtlSec: options.l1.hardTtlSec,
      precomputeSec: options.l1.precomputeSec,
      clock,
      lock: options.l1.lock,
      // L2 owns resilience (stale-if-error / negative caching); keep L1 a plain,
      // short-lived mirror so it never masks an L2 recovery.
      staleIfError: false,
    });
    return new TieredCache<T>(l1, l2);
  }

  /** Cascading SWR read: L1 → L2 → source, backfilling L1. */
  get(key: Key): Promise<ValueResult<T>> {
    return this.l1.get(key);
  }

  /** Batch cascading read. */
  getMany(keys: Key[]): Promise<Array<ValueResult<T>>> {
    return this.l1.getMany(keys);
  }

  /** Write-through both tiers. */
  async put(key: Key, value: T): Promise<void> {
    await this.l2.put(key, value);
    await this.l1.put(key, value);
  }

  /**
   * Hierarchical invalidation across BOTH tiers (single-instance coherence). Defaults
   * to SYNC so both tiers are evicted immediately without needing a dispatcher.
   */
  async invalidate(selectors: Selector | Selector[], mode: SyncMode = SyncMode.SYNC): Promise<void> {
    await this.l2.invalidate(selectors, mode);
    await this.l1.invalidate(selectors, mode);
  }

  /** Exact invalidation across BOTH tiers. */
  async invalidateExact(keys: Key | Key[], mode: SyncMode = SyncMode.SYNC): Promise<void> {
    await this.l2.invalidateExact(keys, mode);
    await this.l1.invalidateExact(keys, mode);
  }

  /** Recompute into L2 from the source, then drop L1 so the next read cascades fresh. */
  async refresh(keys: Key | Key[], mode: SyncMode = SyncMode.SYNC): Promise<void> {
    await this.l2.refresh(keys, mode);
    await this.l1.invalidateExact(keys, SyncMode.SYNC);
  }

  /** Escape hatches to the individual tiers (advanced use). */
  l1Cache(): Cache<T> {
    return this.l1;
  }

  l2Cache(): Cache<T> {
    return this.l2;
  }
}

/** Convenience factory for {@link TieredCache}. */
export function tieredCache<T = unknown>(options: TieredCacheOptions<T>): TieredCache<T> {
  return TieredCache.create(options);
}
