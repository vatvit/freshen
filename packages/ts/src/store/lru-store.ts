import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { Entry } from '../item.js';
import type { Store } from '../ports.js';

interface Slot<T> {
  entry: Entry<T>;
  expiresAt: number; // physical expiry, unix seconds; Infinity = none
}

/**
 * A bounded in-memory LRU store — the L1 tier for two-level caching (FRSH-047).
 * Bounded is mandatory: at most `max` entries; a write past the bound evicts the
 * least-recently-used key. Physical TTL is evaluated lazily on read against an
 * injectable {@link Clock} (share the cache clock in tests). Recency is refreshed on
 * both read and write.
 *
 * Dependency-free (a minimal LRU over an insertion-ordered `Map`, matching
 * {@link MemoryStore}'s no-deps stance); swap in `lru-cache`/`keyv` behind the same
 * {@link Store} port if you prefer.
 */
export class LruStore<T = unknown> implements Store<T> {
  private readonly map = new Map<string, Slot<T>>();
  private readonly max: number;

  constructor(max: number, private readonly clock: Clock = systemClock) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error('LruStore: max must be an integer >= 1');
    }
    this.max = max;
  }

  read(key: string): Promise<Entry<T> | undefined> {
    const slot = this.map.get(key);
    if (slot === undefined) {
      return Promise.resolve(undefined);
    }
    if (this.clock.now() >= slot.expiresAt) {
      this.map.delete(key);
      return Promise.resolve(undefined);
    }
    // Refresh recency: re-insert at the tail (most-recently-used).
    this.map.delete(key);
    this.map.set(key, slot);
    return Promise.resolve(slot.entry);
  }

  write(key: string, entry: Entry<T>, ttlSec: number): Promise<void> {
    this.map.delete(key); // ensure re-insert at the tail
    this.map.set(key, { entry, expiresAt: ttlSec > 0 ? this.clock.now() + ttlSec : Infinity });
    if (this.map.size > this.max) {
      // Evict the least-recently-used (the first/oldest key in insertion order).
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
    return Promise.resolve();
  }

  deleteExact(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }

  deletePrefix(prefix: string): Promise<void> {
    const childPrefix = prefix + '/';
    for (const key of this.map.keys()) {
      if (key === prefix || key.startsWith(childPrefix)) {
        this.map.delete(key);
      }
    }
    return Promise.resolve();
  }

  /** Current number of live entries (test/introspection helper). */
  get size(): number {
    return this.map.size;
  }
}
