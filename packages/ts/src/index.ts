/**
 * freshen — stale-while-revalidate cache with stampede prevention.
 *
 * TS/JS port of the PHP reference (`packages/php`), built to satisfy the
 * language-neutral parity contract in `docs/PARITY.md`.
 */

export const VERSION = '1.0.0-rc.1';

// Core value types
export { Key, KeyPrefix, rawurlencode } from './key.js';
export type { KeyId, IdScalar, IdComposite, KeyPrefixLike } from './key.js';
export { ValueResult, CacheReadState } from './value-result.js';
export { SyncMode } from './sync-mode.js';
export type { Entry } from './item.js';
export { softExpiresAt } from './item.js';

// Cache entry point
export { Cache } from './cache.js';
export type { CacheOptions } from './cache.js';

// Collaborators (interfaces + bundled defaults)
export type {
  Loader,
  BatchLoader,
  Jitter,
  Metrics,
  Store,
  Driver,
  SingleFlight,
  EventDispatcher,
  Selector,
} from './ports.js';
export { isDriver } from './ports.js';
export { CallableLoader, toLoader } from './loader.js';
export type { LoaderFn } from './loader.js';
export { CoalescingLoader, loopBatchLoader } from './batch-loader.js';
export { DefaultJitter } from './jitter.js';
export { MemoryStore } from './store/memory-store.js';
export { KeyvStore } from './store/keyv-store.js';
export type { KeyvLike } from './store/keyv-store.js';
export { InProcessSingleFlight } from './single-flight.js';
export { withCodec, gzipJsonCodec } from './codec.js';
export type { Codec } from './codec.js';

// Redis driver (client-agnostic; inject an ioredis/node-redis adapter)
export { RedisDriver } from './driver/redis-driver.js';
export type { RedisDriverOptions } from './driver/redis-driver.js';
export { ioredisAdapter, nodeRedisAdapter } from './driver/adapters.js';
export type { IoredisLike, NodeRedisLike } from './driver/adapters.js';
export type { RedisLike, RedisSetOptions, RedisScanPage } from './driver/redis-like.js';
export type { Clock } from './clock.js';
export { systemClock } from './clock.js';

// Observability — lifecycle hooks + metrics-as-subscriber
export { HookBus, metricsSubscriber } from './hooks.js';
export type { HookEvent, HookListener, GetOutcome } from './hooks.js';

// Async model — events + handler + in-process EventEmitter binding
export { AsyncEvent, InvalidateEvent, InvalidateExactEvent, RefreshEvent } from './events.js';
export { AsyncHandler, InProcessAsyncDispatcher } from './async-handler.js';
export type { AsyncErrorSink } from './async-handler.js';

// Errors
export {
  InvalidArgumentError,
  MissingValueError,
  AsyncDispatcherError,
  NotFoundError,
} from './errors.js';
