import type { Key } from './key.js';
import type { Selector } from './ports.js';

/**
 * Marker base for the async invalidation/refresh events (PARITY §11). There is one
 * concrete event per async operation, so a listener provider routes each op to its
 * handler by event *type* alone — the type is the discriminator, there is no
 * `op`/`exact` field. Mirrors PHP's `AsyncEvent` hierarchy.
 *
 * The full async model (handler, EventEmitter binding, BullMQ off-process recipe)
 * is FRSH-045; the event objects live here because the core `Cache` dispatches them.
 */
export abstract class AsyncEvent {}

/** Async hierarchical invalidation: remove everything under the selector (prefix or key subtree). */
export class InvalidateEvent extends AsyncEvent {
  constructor(public readonly key: Selector) {
    super();
  }
}

/** Async exact-key invalidation: remove only this key, leaving neighbours intact. */
export class InvalidateExactEvent extends AsyncEvent {
  constructor(public readonly key: Key) {
    super();
  }
}

/** Async refresh: recompute via the loader and store the result now. */
export class RefreshEvent extends AsyncEvent {
  constructor(public readonly key: Key) {
    super();
  }
}
