import { Cache } from './cache.js';
import type { CacheOptions } from './cache.js';
import type { Clock } from './clock.js';
import type { HookListener } from './hooks.js';
import { InProcessLock } from './lock/in-process-lock.js';
import type { EventDispatcher, Jitter, Metrics, SingleFlightLock, Store } from './ports.js';
import { MemoryStore } from './store/memory-store.js';

/**
 * Collaborators shared by every {@link Cache} a {@link Freshen} builds — configured
 * **once**. Any of these can still be overridden per dataset in `cache(...)`.
 */
export interface FreshenOptions {
  /** Shared backend store. Default: a single {@link MemoryStore} shared by all caches. */
  store?: Store<unknown>;
  /** Shared single-flight lock. Default: a single {@link InProcessLock}. */
  lock?: SingleFlightLock;
  /** Shared event dispatcher for ASYNC ops. */
  dispatcher?: EventDispatcher;
  /** Shared metrics sink (wired as a hook subscriber on every cache). */
  metrics?: Metrics;
  /** Shared clock. */
  clock?: Clock;
  /** Shared TTL jitter. */
  jitter?: Jitter;
  /** Shared hook listeners (merged with any per-cache hooks). */
  hooks?: HookListener[];
}

/**
 * A small factory so you set the store / lock / metrics **in one place** and stamp out
 * a `Cache` per dataset — each inheriting the shared collaborators, with its own loader
 * and TTLs (the "one loader = one dataset" model). Keys are namespaced by
 * `domain`/`facet`, so a single shared store holds every dataset without collision.
 *
 * ```ts
 * const freshen = createFreshen({ store: new RedisDriver(redis), lock: new RedisLock(redis), metrics });
 * const topSellers = freshen.cache<Product[]>({ loader: loadTop, hardTtlSec: 3600, precomputeSec: 60 });
 * const categories = freshen.cache<Category[]>({ loader: loadCats, hardTtlSec: 600 });
 * ```
 *
 * Per-cache options always win over the shared ones (so a single dataset can, say, use
 * a different store or disable `staleIfError`). It does not replace `new Cache(...)` —
 * it's a convenience over it.
 */
export class Freshen {
  private readonly sharedStore: Store<unknown>;
  private readonly sharedLock: SingleFlightLock;

  constructor(private readonly shared: FreshenOptions = {}) {
    this.sharedStore = shared.store ?? new MemoryStore();
    this.sharedLock = shared.lock ?? new InProcessLock();
  }

  /** Build a `Cache` for one dataset, inheriting the shared collaborators. */
  cache<T = unknown>(options: CacheOptions<T>): Cache<T> {
    return new Cache<T>({
      ...options,
      store: (options.store ?? this.sharedStore) as Store<T>,
      lock: options.lock ?? this.sharedLock,
      jitter: options.jitter ?? this.shared.jitter,
      dispatcher: options.dispatcher ?? this.shared.dispatcher,
      metrics: options.metrics ?? this.shared.metrics,
      clock: options.clock ?? this.shared.clock,
      hooks: [...(this.shared.hooks ?? []), ...(options.hooks ?? [])],
    });
  }

  /** The shared store (escape hatch). */
  store(): Store<unknown> {
    return this.sharedStore;
  }

  /** The shared lock (escape hatch). */
  lock(): SingleFlightLock {
    return this.sharedLock;
  }
}

/** Create a {@link Freshen} factory that shares one store / lock / metrics across caches. */
export function createFreshen(shared?: FreshenOptions): Freshen {
  return new Freshen(shared);
}
