# Changelog

All notable changes to `vatvit/freshen` (PHP) are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tagged `php-vX.Y.Z` in the monorepo.

## [Unreleased]

## [1.0.0-rc.2] - 2026-07-10
### Changed
- **BREAKING:** async invalidation/refresh now emit one event **per operation** instead of a
  single `AsyncEvent{key, exact}`. `Freshen\AsyncEvent` is now an abstract base; the concrete
  events are `Freshen\InvalidateEvent` (selector: `KeyPrefixInterface|KeyInterface`),
  `Freshen\InvalidateExactEvent` and `Freshen\RefreshEvent`. `AsyncHandler` gains
  `handleInvalidateExact()`; hosts wire each event class to its handler via a PSR-14 listener
  provider. This lets a single dispatcher route a `refresh` and an `invalidate` on the same key
  unambiguously — previously impossible, as both shared one event shape (FRSH-013).
- **BREAKING:** renamed the Stash enhancement classes for a cleaner public API —
  `Freshen\MyRedisDriver` → `Freshen\Driver\Redis`, `Freshen\MyItem` → `Freshen\Item`.
- `Cache` now wires `Freshen\Item` onto the pool itself (`setItemClass`), so deterministic
  TTLs and exact delete no longer require the host to configure the item class.

### Fixed
- `Freshen\Driver\Redis` now actually reuses an injected client
  (`new Freshen\Driver\Redis(['connection' => $redis])`); it previously fell through to
  `parent::setOptions()`, which overwrote the client with a fresh localhost connection.
- Deterministic TTL: `Freshen\Item` overrides Stash's `executeSet()` to drop Stash's random
  0–15% TTL reduction, so a given key stores an identical TTL every time
  ([Stash #419](https://github.com/tedious/Stash/issues/419)).
- ASYNC `invalidate()` / `invalidateExact()` / `refresh()` now dispatch **every** element of a
  list selector, not just the first.
- ASYNC hierarchical `invalidate()` by a `KeyPrefixInterface` no longer throws a `TypeError`:
  the dispatched `InvalidateEvent` accepts `KeyPrefixInterface|KeyInterface` (was baselined in
  FRSH-008, fixed here in FRSH-013).

## [1.0.0-rc.1] - 2026-07-09
### Added
- Initial project scaffold (namespace, autoloading, test/analyse tooling).
- Migrated the PoC cache implementation into this package: `Cache` (stale-while-revalidate
  with leader/follower single-flight), `Key`, async invalidation/refresh, jitter, Stash
  integration, and the public interfaces — namespace `Cache\` → `Freshen\`.

### Changed
- **PHP floor is 8.1.** Single source runs natively across 8.1 → 8.4 (no Rector downgrade /
  dist step). `tedivm/stash` requires ≥8.0; enums require 8.1.
- `ext-redis` is now a **suggestion**, not a hard requirement — the core works with any
  Stash pool; only `MyRedisDriver` needs the extension.
- `declare(strict_types=1)` added to every source file.
- Fail-open behaviour is now a constructor option (`bool $failOpen = true`).

### Fixed
- `invalidate()` / `invalidateExact()` / `refresh()` mishandled a single `Key` object: the
  `(array)` cast exploded the object's properties instead of wrapping it. Now wraps correctly.
- ASYNC `invalidate()` / `refresh()` without an `EventDispatcher` now throws a clear
  `LogicException` instead of a fatal call on `null`.
- `timestampsFromItem()` safely handles Stash's `DateTime|bool` return (no call on a bool).
