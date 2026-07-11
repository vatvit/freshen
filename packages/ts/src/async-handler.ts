import { EventEmitter } from 'node:events';
import type { Cache } from './cache.js';
import {
  AsyncEvent,
  InvalidateEvent,
  InvalidateExactEvent,
  RefreshEvent,
} from './events.js';
import type { EventDispatcher } from './ports.js';
import { SyncMode } from './sync-mode.js';

/**
 * Worker side of the async model (FRSH-045 / PARITY §11) — the TS analogue of PHP's
 * `AsyncHandler`. Consumes an {@link AsyncEvent} and drives the {@link Cache}
 * **synchronously**. Each op has its own event class and its own handler method, so
 * routing is by event type alone — the type *is* the discriminator, no `op`/`exact`
 * field. A single dispatcher can therefore serve all three ops unambiguously,
 * including a `refresh` and an `invalidate` on the *same* key (the FRSH-013 property).
 */
export class AsyncHandler<T = unknown> {
  constructor(private readonly cache: Cache<T>) {}

  handleInvalidate(event: InvalidateEvent): Promise<void> {
    return this.cache.invalidate(event.key, SyncMode.SYNC);
  }

  handleInvalidateExact(event: InvalidateExactEvent): Promise<void> {
    return this.cache.invalidateExact(event.key, SyncMode.SYNC);
  }

  handleRefresh(event: RefreshEvent): Promise<void> {
    return this.cache.refresh(event.key, SyncMode.SYNC);
  }
}

/** Called when a bound async handler op rejects (off the request path). */
export type AsyncErrorSink = (error: unknown, event: AsyncEvent) => void;

/**
 * The bundled in-process async transport (PARITY §11): a Node {@link EventEmitter}
 * that routes each dispatched {@link AsyncEvent} to the {@link AsyncHandler} by
 * event class. This is the "ship the event/handler objects + an in-process binding"
 * default; for **true off-process** refresh, a host swaps this for a queue adapter
 * (see the BullMQ recipe in the README) — Freshen takes no queue dependency.
 *
 * Handler ops run asynchronously off the caller's `dispatch()`; a rejection is
 * routed to `onError` (defaults to `console.error`) rather than becoming an
 * unhandled rejection.
 */
export class InProcessAsyncDispatcher implements EventDispatcher {
  private readonly emitter = new EventEmitter();

  constructor(private readonly onError: AsyncErrorSink = defaultErrorSink) {
    // Avoid the EventEmitter 'error'-with-no-listener crash if 'error' events flow.
    this.emitter.on('error', () => undefined);
  }

  dispatch(event: object): void {
    if (event instanceof AsyncEvent) {
      this.emitter.emit(event.constructor.name, event);
    }
  }

  /** Wire an {@link AsyncHandler} to receive all three op events. Chainable. */
  bind(handler: AsyncHandler): this {
    this.route(InvalidateEvent, (e) => handler.handleInvalidate(e));
    this.route(InvalidateExactEvent, (e) => handler.handleInvalidateExact(e));
    this.route(RefreshEvent, (e) => handler.handleRefresh(e));
    return this;
  }

  private route<E extends AsyncEvent>(
    ctor: { new (...args: never[]): E; name: string },
    run: (event: E) => Promise<void>,
  ): void {
    this.emitter.on(ctor.name, (event: E) => {
      run(event).catch((err: unknown) => this.onError(err, event));
    });
  }
}

function defaultErrorSink(error: unknown): void {
  console.error('[freshen] async handler error:', error);
}
