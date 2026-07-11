import type { SingleFlight } from './ports.js';

/**
 * Best-effort, process-local single-flight (PARITY §7 tier 2). The default when no
 * Redis driver is wired: `acquire` is a synchronous check-and-set on a `Set`, so
 * within one event loop exactly one concurrent caller wins the lock per key. A
 * safety timer self-heals the lock if the leader never releases it (e.g. throws
 * without cleanup), mirroring the Redis lock's TTL.
 *
 * This is *best-effort*: it does not coordinate across processes. The Redis driver
 * (FRSH-044) swaps in an atomic cross-process `SET NX` lock with no change to the
 * cache's read state machine.
 */
export class InProcessSingleFlight implements SingleFlight {
  private readonly held = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  acquire(key: string, ttlSec: number): Promise<boolean> {
    if (this.held.has(key)) {
      return Promise.resolve(false);
    }
    this.held.add(key);
    const timer = setTimeout(() => this.forget(key), Math.max(1, ttlSec) * 1000);
    // Do not keep the event loop alive for a lock safety timer.
    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref();
    }
    this.timers.set(key, timer);
    return Promise.resolve(true);
  }

  release(key: string): Promise<void> {
    this.forget(key);
    return Promise.resolve();
  }

  private forget(key: string): void {
    this.held.delete(key);
    const timer = this.timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
}
