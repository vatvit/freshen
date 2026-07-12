import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { Store } from '../ports.js';

interface Slot {
  /** The opaque packed string (the Cache owns its encoding). */
  packed: string;
  /** Physical expiry, unix seconds; `Infinity` for no TTL. */
  expiresAt: number;
}

/**
 * The bundled default backend: a process-local in-memory store (PARITY §12 — an
 * in-memory reference backend). Deterministic and dependency-free, so the library
 * is usable and unit-testable out of the box.
 *
 * Byte-agnostic (FRSH-060): it holds the same opaque packed string every other backend
 * holds — so an in-memory dev run round-trips values identically to a Redis prod run
 * (no live-reference fidelity skew). Physical expiry is evaluated lazily on read against
 * an injectable {@link Clock} (share the cache's clock in tests for deterministic
 * expiry). Prefix delete drops the whole subtree by string prefix — the
 * exact/hierarchical distinction the cache relies on (PARITY §8).
 *
 * It provides only best-effort single-flight (via the in-process lock) and
 * non-atomic deletes; for the strong cross-process guarantees use the Redis driver.
 */
export class MemoryStore implements Store {
  private readonly map = new Map<string, Slot>();

  constructor(private readonly clock: Clock = systemClock) {}

  read(key: string): Promise<string | undefined> {
    const slot = this.map.get(key);
    if (slot === undefined) {
      return Promise.resolve(undefined);
    }
    if (this.clock.now() >= slot.expiresAt) {
      this.map.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(slot.packed);
  }

  write(key: string, packed: string, ttlSec: number): Promise<void> {
    const expiresAt = ttlSec > 0 ? this.clock.now() + ttlSec : Infinity;
    this.map.set(key, { packed, expiresAt });
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
}
