# Changelog

All notable changes to `vatvit/freshen` (PHP) are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tagged `php-vX.Y.Z` in the monorepo.

## [Unreleased]

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
