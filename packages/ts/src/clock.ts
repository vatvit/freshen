/**
 * Time source (unix seconds). Injectable so the precompute window and
 * `ValueResult` timestamps are deterministic under test. Mirrors PHP's `time()`.
 */
export interface Clock {
  /** Current time as integer unix seconds. */
  now(): number;
}

/** Default clock backed by the system wall clock. */
export const systemClock: Clock = {
  now(): number {
    return Math.floor(Date.now() / 1000);
  },
};
