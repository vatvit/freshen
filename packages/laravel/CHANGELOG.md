# Changelog

All notable changes to `vatvit/freshen-laravel` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tagged `laravel-vX.Y.Z` in the monorepo.

## [Unreleased]
### Added
- Initial Laravel bridge (`Freshen\Bridge\Laravel\FreshenServiceProvider`, auto-discovered):
  declarative **named-cache** config (`config/freshen.php`) building one `Freshen\Cache`
  per dataset (Laravel's phpredis client → `Freshen\Driver\Redis` → `Cache`), resolved by
  name through the auto-registered **`Freshen` facade** — `Freshen::cache('top_sellers')`,
  the idiomatic manager+facade pattern (cf. `Cache::store()`) (FRSH-024). A cache is one
  dataset, so there is **no "default" cache** and no bare `Freshen\Cache` binding.
- Async invalidation/refresh via a **PSR-14 dispatcher adapter over Laravel's queue**
  (`QueueDispatcher` → `ProcessFreshenAsyncEvent` job → `Freshen\AsyncHandler`), so
  invalidation runs on a worker off the request; a `sync` queue connection runs it inline.
- Publishable config (`php artisan vendor:publish --tag=freshen-config`).
- Live-Redis integration lane (`scripts/laravel-it.sh`) and CI (`ci-laravel.yml`).
- Requires `vatvit/freshen` `^1.0@rc`; Laravel `^11 || ^12`; PHP `>= 8.2`. (Laravel 10 —
  the only PHP 8.1 line — is EOL and blocked by composer security advisories, so the
  bridge floor is PHP 8.2 / Laravel 11.)
