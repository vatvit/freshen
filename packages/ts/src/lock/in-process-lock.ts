import { randomUUID } from 'node:crypto';
import type { SingleFlightLock } from '../ports.js';

/**
 * Best-effort, process-local single-flight (PARITY §7 tier 2). The default when no
 * Redis driver is wired: `acquire` is a synchronous check-and-set on a `Map`, so
 * within one event loop exactly one concurrent caller wins the lock per key and gets
 * an ownership **token**. `release(key, token)` frees the lock only if that token
 * still owns it (a fenced unlock), and a safety timer self-heals the lock if the
 * leader never releases it — mirroring the Redis lock's TTL. So a leader whose lock
 * timed out (and was re-taken by another) can't free the new owner's lock.
 *
 * This is *best-effort*: it does not coordinate across processes. The Redis driver
 * (FRSH-044) swaps in an atomic cross-process `SET NX` lock with no change to the
 * cache's read state machine.
 */
export class InProcessLock implements SingleFlightLock {
  private readonly held = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  acquire(key: string, ttlSec: number): Promise<string | null> {
    if (this.held.has(key)) {
      return Promise.resolve(null);
    }
    const token = randomUUID();
    this.held.set(key, token);
    const timer = setTimeout(() => this.forget(key, token), Math.max(1, ttlSec) * 1000);
    // Do not keep the event loop alive for a lock safety timer.
    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref();
    }
    this.timers.set(key, timer);
    return Promise.resolve(token);
  }

  release(key: string, token: string): Promise<void> {
    this.forget(key, token);
    return Promise.resolve();
  }

  /** Drop the lock only if `token` still owns it (fenced). */
  private forget(key: string, token: string): void {
    if (this.held.get(key) !== token) {
      return;
    }
    this.held.delete(key);
    const timer = this.timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
}
