# Changelog

All notable changes to `vatvit/freshen-symfony` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tagged `symfony-vX.Y.Z` in the monorepo.

## [Unreleased]
### Added
- Initial Symfony bundle (`Freshen\Bridge\Symfony\FreshenBundle`): declarative
  **named-cache** config (`freshen.caches.<name>`) building one `Freshen\Cache` service
  each (pool → `Freshen\Driver\Redis` → `Cache`), with a single cache aliased to
  `Freshen\Cache` and multiple exposed via named-argument autowiring (FRSH-023).
- Async invalidation wired out of the box: each cache's `Freshen\AsyncHandler` is
  registered on Symfony's PSR-14 `event_dispatcher` for the three event classes.
- Live-Redis integration lane (`scripts/symfony-it.sh`) and CI (`ci-symfony.yml`).
- Requires `vatvit/freshen` `^1.0@rc`; Symfony `^6.4 || ^7.0`; PHP `>= 8.1`.
