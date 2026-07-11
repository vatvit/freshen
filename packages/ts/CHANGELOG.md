# Changelog

All notable changes to `@vatvit/freshen` (TS/JS) are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tagged `ts-vX.Y.Z` in the monorepo.

## [Unreleased]

## [1.0.0-rc.1] - 2026-07-12

First release candidate of the TypeScript/JavaScript port of Freshen — the
stale-while-revalidate cache with stampede prevention. Behaviour matches the
language-neutral contract in [`docs/PARITY.md`](https://github.com/vatvit/freshen/blob/main/docs/PARITY.md);
the `Key` model reproduces the frozen cross-language parity oracle byte-for-byte.

### Added
- **Core** — `Key` / `KeyPrefix` (structured, hierarchical keys with canonicalised
  composite ids), `Cache` SWR read state machine (fresh / leader single-flight /
  follower serve-stale / bounded wait / fail-open|closed), `ValueResult`, the `Entry`
  storage envelope, `DefaultJitter` (CRC-32 parity), `CallableLoader`, the default
  in-memory `MemoryStore`, and `InProcessSingleFlight`.
- **Redis driver** — client-agnostic `RedisDriver` over a tiny `RedisLike` port, with
  `ioredisAdapter` / `nodeRedisAdapter` (no hard client dependency): atomic `SET NX`
  single-flight, exact/prefix-subtree/batch delete, and `MGET`. `KeyvStore` for the
  degraded generic-store path.
- **Async model** — per-op events (`InvalidateEvent` / `InvalidateExactEvent` /
  `RefreshEvent`), `AsyncHandler`, and the in-process `InProcessAsyncDispatcher`
  (Node `EventEmitter`); documented BullMQ off-process recipe (no queue dependency).
- **Observability** — a hooks-native lifecycle pipeline (`HookBus`) with metrics as a
  built-in subscriber (`metricsSubscriber`); parity metric names.
- **Two-level caching** — `tieredCache` (L1 bounded-LRU `LruStore` + L2 Redis, read
  cascade + backfill, per-tier TTLs, cross-tier coherence).
- **Resilience** — `staleIfError` (serve last-good on a transient loader error, with a
  retry circuit-breaker) and negative caching (`negativeTtlSec`, via `NotFoundError`),
  sharing one loader-outcome decision point.
- **Batch** — `getMany` (single `MGET`) and a DataLoader-style `CoalescingLoader`
  (`BatchLoader.resolveMany`) with `loopBatchLoader` default.
- **Serialization/compression** — a value `Codec` seam (`withCodec`) with a built-in
  `gzipJsonCodec`; decode failure is treated as a miss (fail-open).

### Packaging
- Dual ESM + CJS + `.d.ts` build (tsup), `target: node16`, Node 16 → 22 dist smoke.
- `tsc --strict`, ESLint zero-warnings, and a Vitest coverage floor gate, all CI-blocking.
