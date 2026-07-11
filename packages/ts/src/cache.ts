import type { Clock } from './clock.js';
import { systemClock } from './clock.js';
import { AsyncDispatcherError, InvalidArgumentError, NotFoundError } from './errors.js';
import { InvalidateEvent, InvalidateExactEvent, RefreshEvent } from './events.js';
import type { HookListener } from './hooks.js';
import { HookBus, metricsSubscriber } from './hooks.js';
import type { Entry } from './item.js';
import { softExpiresAt } from './item.js';
import type { Key } from './key.js';
import { DefaultJitter } from './jitter.js';
import type { LoaderFn } from './loader.js';
import { toLoader } from './loader.js';
import type {
  EventDispatcher,
  Jitter,
  Loader,
  Metrics,
  Selector,
  SingleFlight,
  Store,
} from './ports.js';
import { isDriver } from './ports.js';
import { MemoryStore } from './store/memory-store.js';
import { InProcessSingleFlight } from './single-flight.js';
import { SyncMode } from './sync-mode.js';
import { ValueResult } from './value-result.js';

/**
 * Construction options for {@link Cache}. Only `loader` + `hardTtlSec` are required;
 * everything else has a bundled default so the common case is a two-line path
 * (PARITY §3.1 / §4; the "simple by default, customizable in every axis" principle).
 */
export interface CacheOptions<T = unknown> {
  /** Recomputes a value for a key. A bare function is wrapped as a `CallableLoader`. */
  loader: Loader<T> | LoaderFn<T>;
  /** Absolute lifetime of a cached entry, seconds. MUST be ≥ 1. */
  hardTtlSec: number;
  /** Seconds before hard expiry the precompute window opens. MUST be in `[0, hardTtlSec]`. Default 0. */
  precomputeSec?: number;
  /** Backend store. Default: a process-local {@link MemoryStore}. */
  store?: Store<T>;
  /** TTL jitter. Default: {@link DefaultJitter} at 15%. */
  jitter?: Jitter;
  /** Single-flight lock. Default: {@link InProcessSingleFlight}. */
  singleFlight?: SingleFlight;
  /** Event dispatcher for ASYNC ops (required only for async). */
  dispatcher?: EventDispatcher;
  /** Observability sink — wired as a built-in hook subscriber (PARITY §10). */
  metrics?: Metrics;
  /** Extra lifecycle-hook listeners (observe/extend; fire-and-forget). */
  hooks?: HookListener[];
  /** Last-resort behaviour under contention. Default `true`. */
  failOpen?: boolean;
  /** Time source (unix seconds). Default: system clock. */
  clock?: Clock;
  /**
   * Extra physical retention past hard expiry, seconds (default 0). The stored
   * value outlives its logical hard TTL by this much so a follower can be served it
   * as STALE while a leader recomputes (and, later, stale-if-error). Physical store
   * TTL = jittered hard TTL + `graceSec`.
   */
  graceSec?: number;
  /** Bounded wait for a leader's fresh value on a cold miss, ms (PARITY §7 tier 4). Default 900. */
  followerWaitMs?: number;
  /** Poll interval within the follower wait, ms. Default 50. */
  followerPollMs?: number;
  /** Single-flight lock TTL, seconds — self-heals a dead leader. Default 30. */
  lockTtlSec?: number;
  /**
   * stale-if-error (FRSH-048): when a recompute *throws* (a transient error, not a
   * {@link NotFoundError}) and a last-known-good value is still retained, serve it as
   * STALE instead of propagating the error. Default `true` (availability bias, like
   * `failOpen`). Retention is the hard TTL, extended by `graceSec` past hard expiry.
   */
  staleIfError?: boolean;
  /**
   * Mini circuit-breaker (FRSH-048): after a recompute fails, do NOT re-hit the loader
   * on every request — serve stale and retry at most once per this many seconds.
   * Default 10.
   */
  staleIfErrorRetrySec?: number;
  /**
   * Negative caching (FRSH-051): when the loader throws {@link NotFoundError}, cache
   * that not-found for this many seconds so a persistently-missing key stops hammering
   * the source. `0` (default) disables it. A cached negative reads back as a MISS
   * (distinct from a cached `null`, which is a real HIT).
   */
  negativeTtlSec?: number;
}

/** Internal classification of a loader call — the single "loader outcome" seam. */
type LoaderOutcome<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'error'; readonly error: unknown };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t === 'object' && typeof t.unref === 'function') {
      t.unref();
    }
  });
}

/**
 * The Freshen cache: a stale-while-revalidate read with stampede prevention
 * (PARITY §1). The read state machine (`get`) and the mutating ops
 * (`put`/`invalidate`/`invalidateExact`/`refresh`) mirror the PHP reference.
 *
 * Behaviour is backend-agnostic: the same state machine runs over the default
 * in-memory store or a Redis driver — only the single-flight lock and the batch/
 * atomic-delete primitives differ, and those are feature-detected.
 */
export class Cache<T = unknown> {
  private readonly loader: Loader<T>;
  private readonly hardTtlSec: number;
  private readonly precomputeSec: number;
  private readonly store: Store<T>;
  private readonly jitter: Jitter;
  private readonly singleFlight: SingleFlight;
  private readonly dispatcher?: EventDispatcher;
  private readonly hooks = new HookBus();
  private readonly failOpen: boolean;
  private readonly clock: Clock;
  private readonly graceSec: number;
  private readonly followerWaitMs: number;
  private readonly followerPollMs: number;
  private readonly lockTtlSec: number;
  private readonly staleIfError: boolean;
  private readonly staleIfErrorRetrySec: number;
  private readonly negativeTtlSec: number;

  constructor(options: CacheOptions<T>) {
    const {
      loader,
      hardTtlSec,
      precomputeSec = 0,
      store,
      jitter,
      singleFlight,
      dispatcher,
      metrics,
      hooks,
      failOpen = true,
      clock = systemClock,
      graceSec = 0,
      followerWaitMs = 900,
      followerPollMs = 50,
      lockTtlSec = 30,
      staleIfError = true,
      staleIfErrorRetrySec = 10,
      negativeTtlSec = 0,
    } = options;

    if (!Number.isInteger(hardTtlSec) || hardTtlSec < 1) {
      throw new InvalidArgumentError('hardTtlSec must be an integer >= 1');
    }
    if (!Number.isInteger(precomputeSec) || precomputeSec < 0 || precomputeSec > hardTtlSec) {
      throw new InvalidArgumentError('precomputeSec must be an integer in [0, hardTtlSec]');
    }
    if (!Number.isInteger(graceSec) || graceSec < 0) {
      throw new InvalidArgumentError('graceSec must be an integer >= 0');
    }

    this.loader = toLoader(loader);
    this.hardTtlSec = hardTtlSec;
    this.precomputeSec = precomputeSec;
    this.store = store ?? new MemoryStore<T>(clock);
    this.jitter = jitter ?? new DefaultJitter();
    this.singleFlight = singleFlight ?? new InProcessSingleFlight();
    this.dispatcher = dispatcher;
    // Metrics are just a built-in hook subscriber — no separate emit path.
    if (metrics !== undefined) {
      this.hooks.subscribe(metricsSubscriber(metrics));
    }
    for (const listener of hooks ?? []) {
      this.hooks.subscribe(listener);
    }
    this.failOpen = failOpen;
    this.clock = clock;
    this.graceSec = graceSec;
    this.followerWaitMs = followerWaitMs;
    this.followerPollMs = followerPollMs;
    this.lockTtlSec = lockTtlSec;

    if (!Number.isInteger(staleIfErrorRetrySec) || staleIfErrorRetrySec < 0) {
      throw new InvalidArgumentError('staleIfErrorRetrySec must be an integer >= 0');
    }
    if (!Number.isInteger(negativeTtlSec) || negativeTtlSec < 0) {
      throw new InvalidArgumentError('negativeTtlSec must be an integer >= 0');
    }
    this.staleIfError = staleIfError;
    this.staleIfErrorRetrySec = staleIfErrorRetrySec;
    this.negativeTtlSec = negativeTtlSec;
  }

  /**
   * SWR read (PARITY §7). Evaluates the tiers in order and returns from the first
   * that produces a result: fresh hit → leader recompute → follower serve-stale →
   * follower bounded-wait → fail-open / fail-closed.
   */
  async get(key: Key): Promise<ValueResult<T>> {
    const keyStr = key.toString();
    const entry = await this.store.read(keyStr);
    const now = this.clock.now();

    if (entry !== undefined && entry.negative !== true) {
      const soft = softExpiresAt(entry, this.precomputeSec);
      // Tier 1 (pure fresh): before the soft boundary, everyone is served fresh
      // with no contention and no recompute.
      if (now < soft) {
        this.hooks.emit({ type: 'get', key, outcome: 'fresh' });
        return ValueResult.hit(entry.value, entry.createdAt, soft);
      }

      // stale-if-error circuit-breaker (FRSH-048): a prior recompute failed and set a
      // retry-after marker. Until then, serve the last-good value as stale WITHOUT
      // re-hitting the loader — one leader retries only at/after nextRetryAt.
      if (entry.nextRetryAt !== undefined && now < entry.nextRetryAt) {
        this.hooks.emit({ type: 'get', key, outcome: 'stale_on_error' });
        return ValueResult.stale(entry.value, entry.createdAt, soft);
      }

      // Soft-expired (or past hard). Elect a single recomputer via the lock.
      const won = await this.singleFlight.acquire(keyStr, this.lockTtlSec);
      if (won) {
        return this.leaderCompute(key, now);
      }

      // Lost the election. Serve the value we already read: FRESH while still
      // within the precompute window (tier 1, non-elected), STALE once past hard
      // expiry (tier 3) — no blocking either way.
      if (now < entry.hardExpiresAt) {
        this.hooks.emit({ type: 'get', key, outcome: 'fresh' });
        return ValueResult.hit(entry.value, entry.createdAt, soft);
      }
      this.hooks.emit({ type: 'get', key, outcome: 'stale' });
      return ValueResult.stale(entry.value, entry.createdAt, soft);
    }

    // A retained negative entry (FRSH-051): short-circuit to a MISS without hitting
    // the loader — the cached "not found" suppresses hammering within its window.
    if (entry !== undefined && entry.negative === true) {
      this.hooks.emit({ type: 'get', key, outcome: 'negative' });
      return ValueResult.miss<T>();
    }

    // Cold key: elect a recomputer.
    const won = await this.singleFlight.acquire(keyStr, this.lockTtlSec);
    if (won) {
      return this.leaderCompute(key, now);
    }

    // Follower with no value to serve: wait a bounded time for the leader's write
    // (tier 4), else fail open/closed (tier 5).
    const fresh = await this.waitForFresh(keyStr);
    if (fresh !== undefined) {
      this.hooks.emit({ type: 'get', key, outcome: 'fresh_after_sleep' });
      return ValueResult.hit(fresh.value, fresh.createdAt, softExpiresAt(fresh, this.precomputeSec));
    }
    return this.failOpenOrMiss(key);
  }

  /** Write/overwrite a value with a fresh (jittered) hard TTL (PARITY §3.1). */
  async put(key: Key, value: T): Promise<void> {
    await this.save(key, value, this.clock.now());
    this.hooks.emit({ type: 'put', key });
  }

  /** Subscribe a lifecycle-hook listener; returns an unsubscribe function (PARITY §10). */
  subscribe(listener: HookListener): () => void {
    return this.hooks.subscribe(listener);
  }

  /** Hierarchical delete by prefix/key subtree (PARITY §8). Defaults to ASYNC. */
  async invalidate(
    selectors: Selector | Selector[],
    mode: SyncMode = SyncMode.ASYNC,
  ): Promise<void> {
    for (const selector of Array.isArray(selectors) ? selectors : [selectors]) {
      if (mode === SyncMode.ASYNC) {
        this.dispatch(new InvalidateEvent(selector));
        continue;
      }
      await this.store.deletePrefix(selector.toString());
      this.hooks.emit({ type: 'invalidate', selector, hierarchical: true });
    }
  }

  /** Exact-key delete (PARITY §8). Defaults to ASYNC. Batches on a Redis driver. */
  async invalidateExact(keys: Key | Key[], mode: SyncMode = SyncMode.ASYNC): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];

    if (mode === SyncMode.ASYNC) {
      for (const key of list) {
        this.dispatch(new InvalidateExactEvent(key));
      }
      return;
    }

    if (list.length === 0) {
      return;
    }

    if (isDriver(this.store)) {
      // Collapse the whole set into one atomic round-trip (Redis DEL k1 k2 …).
      await this.store.deleteExactMany(list.map((key) => key.toString()));
    } else {
      for (const key of list) {
        await this.store.deleteExact(key.toString());
      }
    }
    for (const key of list) {
      this.hooks.emit({ type: 'invalidate', selector: key, hierarchical: false });
    }
  }

  /** Recompute via the loader and store now (PARITY §8). Defaults to ASYNC. */
  async refresh(keys: Key | Key[], mode: SyncMode = SyncMode.ASYNC): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (mode === SyncMode.ASYNC) {
        this.dispatch(new RefreshEvent(key));
        continue;
      }
      await this.put(key, await this.loader.resolve(key));
      this.hooks.emit({ type: 'refresh', key });
    }
  }

  /**
   * Escape hatch: the underlying store (PARITY §12; not a parity requirement). Lets
   * a host reach the raw backend. Whole-store flush is intentionally not offered.
   */
  asStore(): Store<T> {
    return this.store;
  }

  // --- internals ---

  /**
   * Leader path (PARITY §7 tier 2 / §7.1) routed through the single loader-outcome
   * seam shared by fail-open, negative caching (FRSH-051) and stale-if-error
   * (FRSH-048):
   *  - value    → store it, return a fresh HIT (`cache_fill`).
   *  - notFound → negative-cache it (if enabled), return a MISS (`cache_miss{negative}`).
   *  - error    → serve the retained last-good as STALE with a retry-after marker
   *               (stale-if-error); if none/disabled, propagate the error.
   */
  private async leaderCompute(key: Key, now: number): Promise<ValueResult<T>> {
    try {
      const outcome = await this.resolveLoader(key);

      if (outcome.kind === 'value') {
        await this.save(key, outcome.value, now);
        this.hooks.emit({ type: 'get', key, outcome: 'fill' });
        return ValueResult.hit(outcome.value, now, this.postWriteSoft(now));
      }

      if (outcome.kind === 'notFound') {
        await this.recordNotFound(key, now);
        this.hooks.emit({ type: 'get', key, outcome: 'negative' });
        return ValueResult.miss<T>();
      }

      // Transient error.
      this.hooks.emit({ type: 'loaderError', key, error: outcome.error });
      const stale = await this.serveStaleOnError(key, now);
      if (stale !== undefined) {
        this.hooks.emit({ type: 'get', key, outcome: 'stale_on_error' });
        return stale;
      }
      throw outcome.error;
    } finally {
      await this.singleFlight.release(key.toString());
    }
  }

  /** Call the loader once and classify the outcome (the shared decision point). */
  private async resolveLoader(key: Key): Promise<LoaderOutcome<T>> {
    try {
      const value = await this.loader.resolve(key);
      return { kind: 'value', value };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return { kind: 'notFound' };
      }
      return { kind: 'error', error };
    }
  }

  /**
   * stale-if-error: if a last-known-good value is still retained within the grace
   * window, mark it with a retry-after (circuit breaker) and return it as STALE.
   * Returns `undefined` when disabled or nothing is retained.
   */
  private async serveStaleOnError(key: Key, now: number): Promise<ValueResult<T> | undefined> {
    if (!this.staleIfError) {
      return undefined;
    }
    const last = await this.store.read(key.toString());
    if (last === undefined || last.negative === true) {
      return undefined;
    }
    const graceEnd = last.hardExpiresAt + this.graceSec;
    if (now >= graceEnd) {
      return undefined; // grace window elapsed — stop serving stale
    }
    // Persist the retry-after so followers serve stale without re-hitting the loader.
    const nextRetryAt = Math.min(now + this.staleIfErrorRetrySec, graceEnd);
    const remaining = graceEnd - now;
    await this.store.write(key.toString(), { ...last, nextRetryAt }, remaining);
    return ValueResult.stale(last.value, last.createdAt, softExpiresAt(last, this.precomputeSec));
  }

  /**
   * Record a definitive not-found (FRSH-051). With negative caching on, store a
   * short-lived negative entry (overwriting any stale positive — the item is gone at
   * source). With it off, remove any stale positive so we don't keep serving a value
   * the source says no longer exists.
   */
  private async recordNotFound(key: Key, now: number): Promise<void> {
    if (this.negativeTtlSec <= 0) {
      await this.store.deleteExact(key.toString());
      return;
    }
    const entry: Entry<T> = {
      value: undefined as unknown as T,
      createdAt: now,
      hardExpiresAt: now + this.negativeTtlSec,
      negative: true,
    };
    await this.store.write(key.toString(), entry, this.negativeTtlSec);
  }

  /** Persist a value under a jittered hard TTL (+ grace retention) (PARITY §9). */
  private async save(key: Key, value: T, now: number): Promise<void> {
    const jittered = this.jitter.apply(this.hardTtlSec, key);
    const entry: Entry<T> = {
      value,
      createdAt: now,
      hardExpiresAt: now + jittered,
    };
    await this.store.write(key.toString(), entry, jittered + this.graceSec);
  }

  /** Post-write soft boundary from the *nominal* hard TTL (PARITY §7.1). */
  private postWriteSoft(now: number): number {
    return Math.max(now, now + this.hardTtlSec - this.precomputeSec);
  }

  /** Bounded poll for a leader's fresh write (PARITY §7 tier 4). */
  private async waitForFresh(keyStr: string): Promise<Entry<T> | undefined> {
    const deadline = Date.now() + this.followerWaitMs;
    while (Date.now() < deadline) {
      await sleep(this.followerPollMs);
      const entry = await this.store.read(keyStr);
      if (entry !== undefined && entry.negative !== true) {
        const now = this.clock.now();
        if (now < softExpiresAt(entry, this.precomputeSec)) {
          return entry;
        }
      }
    }
    return undefined;
  }

  /**
   * Last resort (PARITY §7 tier 5): compute-without-store (fail-open) or miss. The
   * leader (not this racing follower) owns storing/negative-caching, so tier 5a only
   * computes a value to return; a not-found becomes a MISS and a transient error
   * propagates.
   */
  private async failOpenOrMiss(key: Key): Promise<ValueResult<T>> {
    if (this.failOpen) {
      const outcome = await this.resolveLoader(key);
      if (outcome.kind === 'value') {
        const now = this.clock.now();
        this.hooks.emit({ type: 'get', key, outcome: 'fail_open' });
        return ValueResult.hit(outcome.value, now, this.postWriteSoft(now));
      }
      if (outcome.kind === 'error') {
        throw outcome.error;
      }
      // not found
    }
    this.hooks.emit({ type: 'get', key, outcome: 'miss' });
    return ValueResult.miss<T>();
  }

  private dispatch(event: object): void {
    if (this.dispatcher === undefined) {
      throw new AsyncDispatcherError();
    }
    this.dispatcher.dispatch(event);
  }
}
