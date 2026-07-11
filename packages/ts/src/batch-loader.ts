import type { Key } from './key.js';
import type { LoaderFn } from './loader.js';
import { toLoader } from './loader.js';
import type { BatchLoader, Loader } from './ports.js';

/**
 * The default {@link BatchLoader} (FRSH-050): wraps a plain `Loader`/function and
 * implements `resolveMany` by looping the single `resolve()`. So batching works out
 * of the box; a user implements `resolveMany` only for true coalescing (`WHERE id IN
 * (…)`). All-or-nothing on error — a per-key throw rejects the batch (see
 * {@link CoalescingLoader} docs).
 */
export function loopBatchLoader<T>(loader: Loader<T> | LoaderFn<T>): BatchLoader<T> {
  const inner = toLoader(loader);
  return {
    resolve: (key) => inner.resolve(key),
    resolveMany: (keys) => Promise.all(keys.map((key) => Promise.resolve(inner.resolve(key)))),
  };
}

/**
 * A coalescing loader (FRSH-050, DataLoader-style): batches every `resolve()` call
 * made within the same microtask tick into ONE `batchLoader.resolveMany(keys)`, so N
 * concurrent misses (e.g. from `getMany`) collapse into a single source round-trip
 * (`WHERE id IN (…)`). Per-key single-flight is unaffected — each `Cache.get` still
 * elects its own leader; only the leaders' loader calls are coalesced.
 *
 * Pass it as the cache's `loader`:
 * ```ts
 * const cache = new Cache({ loader: new CoalescingLoader(myBatchLoader), hardTtlSec: 60 });
 * ```
 *
 * **Error semantics:** a batch is all-or-nothing — if `resolveMany` rejects, every
 * coalesced caller rejects with that error. For per-key isolation, a custom
 * `resolveMany` should resolve every key (throwing only for a genuine whole-batch
 * failure).
 */
export class CoalescingLoader<T = unknown> implements Loader<T> {
  private queue: Array<{
    key: Key;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  }> = [];
  private scheduled = false;

  constructor(private readonly batchLoader: BatchLoader<T>) {}

  resolve(key: Key): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      if (!this.scheduled) {
        this.scheduled = true;
        queueMicrotask(() => void this.flush());
      }
    });
  }

  private async flush(): Promise<void> {
    const batch = this.queue;
    this.queue = [];
    this.scheduled = false;
    try {
      const values = await this.batchLoader.resolveMany(batch.map((item) => item.key));
      batch.forEach((item, i) => item.resolve(values[i] as T));
    } catch (error) {
      for (const item of batch) {
        item.reject(error);
      }
    }
  }
}
