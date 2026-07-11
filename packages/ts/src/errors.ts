/**
 * Error taxonomy (PARITY §13 — the *category* is contract, the class name is the
 * host's). Mirrors the PHP reference's three error categories:
 *
 *  - `InvalidArgumentError`  ↔ PHP `InvalidArgumentException` — bad config / empty key segment.
 *  - `MissingValueError`     ↔ PHP `RuntimeException`         — `value()` called on a miss.
 *  - `AsyncDispatcherError`  ↔ PHP `LogicException`           — an ASYNC op with no dispatcher.
 *
 * Defined once here so the sibling tasks (Redis driver, async model) reuse them
 * rather than reinvent parallel error types.
 */

/** Invalid construction argument (e.g. `hardTtlSec < 1`, empty `Key` segment). */
export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
}

/** Thrown by `ValueResult.value()` when the result is a miss (no value present). */
export class MissingValueError extends Error {
  constructor(message = 'ValueResult: no value (miss).') {
    super(message);
    this.name = 'MissingValueError';
  }
}

/** Thrown when a mutating op is called with `SyncMode.ASYNC` but no dispatcher was configured. */
export class AsyncDispatcherError extends Error {
  constructor(message = 'ASYNC mode requires an EventDispatcher to be configured.') {
    super(message);
    this.name = 'AsyncDispatcherError';
  }
}
