import type { Key } from './key.js';
import type { Metrics, Selector } from './ports.js';

/**
 * Hooks-native observability (FRSH-046). The cache fires a {@link HookEvent} at each
 * lifecycle point; observers subscribe. **Metrics are a built-in subscriber**
 * (`metricsSubscriber`), not a separate emit path — this is the end-state PHP will
 * reach via its FRSH-043 refactor; TS is there from the start (no duplication).
 *
 * Hooks are **fire-and-forget and MUST NOT throw into the cache path** — the bus
 * isolates every listener error (PARITY §10 spirit).
 */

/** The outcome of a `get` (maps to the PARITY §7/§10 tiers). */
export type GetOutcome =
  | 'fresh' // tier 1 (pure or non-elected follower)
  | 'stale' // tier 3 follower serve-stale
  | 'fresh_after_sleep' // tier 4 follower wait resolved
  | 'fill' // tier 2 leader stored a value
  | 'stale_on_error' // FRSH-048 stale-if-error served last-good
  | 'negative' // FRSH-051 negative-cache hit
  | 'fail_open' // tier 5a
  | 'miss'; // tier 5b fail-closed

export type HookEvent =
  | { readonly type: 'get'; readonly key: Key; readonly outcome: GetOutcome }
  | { readonly type: 'put'; readonly key: Key }
  | { readonly type: 'invalidate'; readonly selector: Selector; readonly hierarchical: boolean }
  | { readonly type: 'refresh'; readonly key: Key }
  | { readonly type: 'loaderError'; readonly key: Key; readonly error: unknown }
  | { readonly type: 'evict'; readonly key: string; readonly tier: 'l1' };

export type HookListener = (event: HookEvent) => void;

/** A tiny synchronous pub/sub with per-listener error isolation. */
export class HookBus {
  private readonly listeners = new Set<HookListener>();

  subscribe(listener: HookListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: HookEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Hooks are fire-and-forget; a throwing subscriber must never break the
        // cache path (PARITY §10). Swallow — the sink owns its own error handling.
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

/**
 * The built-in metrics subscriber: translates hook events into the PARITY §10 metric
 * set (identical names & labels to PHP). Emitting `Metrics` is best-effort and MUST
 * NOT affect cache behaviour — the bus already guarantees isolation.
 */
export function metricsSubscriber(metrics: Metrics): HookListener {
  return (event) => {
    switch (event.type) {
      case 'get':
        switch (event.outcome) {
          case 'fresh':
            metrics.inc('cache_hit', { state: 'fresh' });
            break;
          case 'stale':
            metrics.inc('cache_hit', { state: 'stale' });
            break;
          case 'fresh_after_sleep':
            metrics.inc('cache_hit', { state: 'fresh_after_sleep' });
            break;
          case 'stale_on_error':
            metrics.inc('cache_hit', { state: 'stale_on_error' });
            break;
          case 'fill':
            metrics.inc('cache_fill');
            break;
          case 'negative':
            metrics.inc('cache_miss', { cause: 'negative' });
            break;
          case 'fail_open':
            metrics.inc('cache_miss', { cause: 'precompute_race' });
            break;
          case 'miss':
            metrics.inc('cache_miss', { cause: 'precompute_race_fail_closed' });
            break;
        }
        break;
      case 'put':
        metrics.inc('cache_put');
        break;
      case 'invalidate':
        metrics.inc(event.hierarchical ? 'cache_invalidate_hierarchical' : 'cache_invalidate');
        break;
      case 'loaderError':
        metrics.inc('cache_loader_error');
        break;
      case 'refresh':
      case 'evict':
        break; // no PARITY §10 metric (refresh emits cache_put via the underlying put)
    }
  };
}
