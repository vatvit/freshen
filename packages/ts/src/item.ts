/**
 * The Freshen-controlled storage envelope (PARITY §5 / §12 — the analogue of PHP's
 * `Freshen\Item`). We wrap every stored value with our own timestamps rather than
 * trusting the backend's TTL, because the deterministic precompute window and the
 * `ValueResult` timestamps depend on an authoritative creation + hard-expiry pair.
 *
 * The envelope is stored under a *physical* store TTL that MAY exceed `hardExpiresAt`
 * (see `graceSec`) so a value can be retained past its logical hard expiry to serve
 * as STALE while a leader recomputes, and (later) to power stale-if-error.
 *
 * Optional fields are reserved for the adjacent features and are absent on a plain
 * positive entry:
 *  - `negative`    — this entry records a loader not-found/failure (negative caching).
 *  - `nextRetryAt` — mini circuit-breaker: unix seconds before which the loader must
 *                    not be re-hit (stale-if-error / negative caching backoff).
 */
export interface Entry<T = unknown> {
  value: T;
  /** Unix seconds the payload was created. */
  createdAt: number;
  /** Unix seconds of logical hard expiry (`createdAt + jitteredHardTtl`). */
  hardExpiresAt: number;
  negative?: boolean;
  nextRetryAt?: number;
}

/**
 * Soft expiry for an entry given a reader's `precomputeSec` (PARITY §5):
 * `max(createdAt, hardExpiresAt − precomputeSec)`. Never earlier than creation.
 */
export function softExpiresAt(entry: Entry, precomputeSec: number): number {
  return Math.max(entry.createdAt, entry.hardExpiresAt - precomputeSec);
}
