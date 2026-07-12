import type { Store } from '../ports.js';

/**
 * The subset of a `keyv` instance {@link KeyvStore} uses (structural — no `keyv`
 * dependency). Freshen hands keyv an opaque **packed string** (the Cache owns the
 * value's encoding, FRSH-060), so keyv only ever stores/returns a string.
 */
export interface KeyvLike {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlMs?: number): Promise<unknown>;
  delete(key: string): Promise<boolean>;
  /** Present on keyv stores that support iteration; enables best-effort prefix delete. */
  iterator?: (namespace?: string) => AsyncIterableIterator<[string, string]>;
}

/**
 * Adapts any `keyv` store to the Freshen {@link Store} port — the "swap any keyv
 * store (Redis, Mongo, DynamoDB, …) with no code change" path (FRSH-044 architecture).
 *
 * **Degraded guarantees** (the JS twin of FRSH-036): a generic keyv store gives no
 * atomic single-flight (pair with {@link InProcessLock} — best-effort within
 * one process) and no atomic subtree delete. `deletePrefix` is best-effort via keyv's
 * `iterator()` when available, and throws otherwise — for real hierarchical
 * invalidation across processes, use the Redis driver.
 */
export class KeyvStore implements Store {
  constructor(private readonly keyv: KeyvLike) {}

  async read(key: string): Promise<string | undefined> {
    return (await this.keyv.get(key)) ?? undefined;
  }

  async write(key: string, packed: string, ttlSec: number): Promise<void> {
    await this.keyv.set(key, packed, Math.max(1, ttlSec) * 1000);
  }

  async deleteExact(key: string): Promise<void> {
    await this.keyv.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    if (typeof this.keyv.iterator !== 'function') {
      throw new Error(
        'KeyvStore: hierarchical (prefix) invalidation is not supported on a store ' +
          'without iterator(). Use the Redis driver for atomic subtree deletes, or ' +
          'invalidateExact for single keys.',
      );
    }
    const childPrefix = prefix + '/';
    for await (const [key] of this.keyv.iterator()) {
      if (key === prefix || key.startsWith(childPrefix)) {
        await this.keyv.delete(key);
      }
    }
  }
}
