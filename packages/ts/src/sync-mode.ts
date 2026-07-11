/**
 * How a mutating operation (`invalidate` / `invalidateExact` / `refresh`) is
 * applied (PARITY §3.4 / §8). Defaults to `ASYNC` on all three methods.
 *
 *  - `SYNC`  — perform the operation immediately against the backend.
 *  - `ASYNC` — dispatch an event; a subscribed handler performs the equivalent
 *              SYNC op later (requires an event dispatcher — see the async model).
 */
export enum SyncMode {
  SYNC = 'sync',
  ASYNC = 'async',
}
