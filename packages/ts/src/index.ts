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

// Factory — configure a shared store/lock/metrics once, stamp out a Cache per dataset
export { Freshen, createFreshen } from './factory.js';
export type { FreshenOptions } from './factory.js';

// Collaborators (interfaces + bundled defaults)
export type {
  Loader,
  BatchLoader,
  Jitter,
  Metrics,
  Store,
  Driver,
  SingleFlightLock,
  EventDispatcher,
  Selector,
} from './ports.js';
export { isDriver } from './ports.js';
export { CallableLoader, toLoader } from './loader.js';
export type { LoaderFn } from './loader.js';
export { CoalescingLoader, loopBatchLoader } from './batch-loader.js';
export { DefaultJitter } from './jitter.js';
export { MemoryStore } from './store/memory-store.js';
export { LruStore } from './store/lru-store.js';
export { KeyvStore } from './store/keyv-store.js';
export type { KeyvLike } from './store/keyv-store.js';
export { withCodec, gzipJsonCodec } from './codec.js';
export type { Codec } from './codec.js';

// Lock strategies (single-flight): in-memory default + Redis
export { InProcessLock } from './lock/in-process-lock.js';
export { RedisLock } from './lock/redis-lock.js';
export type { RedisLockOptions } from './lock/redis-lock.js';

// Redis driver (client-agnostic store; inject an ioredis/node-redis adapter)
export { RedisDriver } from './driver/redis-driver.js';
export type { RedisDriverOptions } from './driver/redis-driver.js';
export { ioredisAdapter, nodeRedisAdapter } from './driver/adapters.js';
export type { IoredisLike, NodeRedisLike } from './driver/adapters.js';
export type { RedisLike, RedisSetOptions, RedisScanPage } from './driver/redis-like.js';
export type { Clock } from './clock.js';
export { systemClock } from './clock.js';

// Two-level caching (L1 LRU + L2) — Approach A: stacked Cache instances
export { TieredCache, tieredCache } from './tiered.js';
export type { TieredCacheOptions, L1Options } from './tiered.js';

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
