# Contributing

Freshen is a monorepo with one package per language stack. Each package is
self-contained and built/tested with its own toolchain. **All toolchains run in
Docker — nothing is installed or run on the host.**

## Branching (GitFlow)

Branch off `develop` for features (`feature/*`), off `main` for hotfixes
(`hotfix/*`). See [RELEASING.md](RELEASING.md) for the full model. CI must be
green before merge.

## Supported runtimes

| Stack | Supported | How it's supported |
|-------|-----------|--------------------|
| PHP   | 8.1 → 8.4 | Single source (PHP 8.1+); runs natively across the range — no downgrade. |
| TS/JS | Node 16 → 22 | **ES2020** build target; dev toolchain runs on Node ≥18. |

New PHP/Node releases are adopted as they land: add the version to the matrix.

The PHP source is tested in each version's container directly (Composer resolves a
version-appropriate PHPUnit). The TS dev toolchain can't run on the oldest Node, so
TS is built/quality-gated on a modern Node and the **built bundle** is smoke-loaded
across the full Node range (see [`scripts/`](scripts/README.md)).

## PHP — `packages/php`

```bash
scripts/php-test.sh              # full matrix: 8.1 8.2 8.3 8.4 (phpunit + phpstan)
scripts/php-test.sh 8.1          # a single version
scripts/php-coverage.sh          # unit coverage + floor gate (PCOV, PHP 8.3, floor 90%)
scripts/php-coverage.sh 8.4 92   # a specific version + floor
scripts/php-redis-it.sh          # live-Redis integration lane (ext-redis + redis:7)
```

Quality gates: PHPUnit + **PHPStan (level max)** + a **coverage floor gate**.

### Test lanes

- **Unit suite** (default `composer test`) — deterministic and dependency-free;
  external backends are mocked, no live Redis (REQUIREMENTS §5).
- **Integration lane** (`composer test:integration` / `scripts/php-redis-it.sh`) —
  the `integration` PHPUnit suite, excluded from the default run. Covers
  `Freshen\Driver\Redis` against a real Redis (needs `ext-redis`); run in Docker
  with a `redis:7` service.

### Coverage gate (REQUIREMENTS §4)

Coverage is tracked and **must not regress**. `scripts/php-coverage.sh` (and the CI
`coverage` job) run the unit suite under PCOV and fail if line coverage drops below
the floor (**90%**; current ~94%). `Freshen\Driver\Redis` is excluded from the gate
denominator — it has no unit coverage by design and is exercised by the integration
lane instead. Raise the floor as coverage improves; never lower it to make CI pass.

## TS / JS — `packages/ts`

```bash
scripts/ts-test.sh               # build+lint+typecheck+coverage on Node 20, smoke on 16/18/20/22
scripts/ts-test.sh 16            # smoke-load the dist on one version
```

Quality gates: ESLint + `tsc --strict` + Vitest coverage.

## Framework bridges — `packages/symfony`, `packages/laravel`

The bridges are **thin glue**: config → DI → services. Each ships its own PHP toolchain
(the core `packages/php` is the reference library they wire up).

```bash
scripts/symfony-test.sh          # matrix 8.1–8.4: phpunit (unit) + phpstan max
scripts/symfony-it.sh            # live-Redis lane (ext-redis + redis:7)
scripts/bridge-coverage.sh symfony      # unit coverage + floor gate (PCOV, floor 90%)

scripts/laravel-test.sh          # matrix 8.2–8.4: phpunit (unit) + phpstan max
scripts/laravel-it.sh            # live-Redis lane (ext-redis + redis:7)
scripts/bridge-coverage.sh laravel      # unit coverage + floor gate (PCOV, floor 90%)
```

> The **Laravel bridge requires PHP 8.2 / Laravel 11+**: PHP 8.1's only Laravel line is
> 10.x, which is EOL and blocked by composer's security advisories. The Symfony bridge and
> core support PHP 8.1.

Quality gates (CI-blocking, per bridge): **PHPUnit + PHPStan (level max) + a coverage
floor gate**, plus a live-Redis integration job. Each bridge has its own workflow
(`ci-symfony.yml`, `ci-laravel.yml`).

### The bridge-test standard — what to test (and what NOT to)

A bridge test suite proves the **wiring seam only**, in three layers:

1. **Config parsing/validation** — the config tree applies defaults and rejects bad input.
2. **Service wiring** (the bulk; **no live backend**) — the container builds a correct
   `Freshen\Cache` from config, async listeners/handlers are registered, single-cache
   aliases `Freshen\Cache` and multi-cache uses named binding. Assert on service
   *definitions* / container bindings, not behaviour.
3. **One live end-to-end smoke** (`*-it.sh`, ext-redis) — boot the real framework/container
   against real Redis and run cold-fill → hit → async `invalidate()`, confirming the entry
   actually drops. This is the honesty linchpin (REQUIREMENTS / FRSH-017).
   Framework-specific async seams get their own test — e.g. Laravel's PSR-14-adapter +
   queue routing.

**Do NOT re-test cache semantics** — SWR, stampede prevention, TTL/jitter are the core
library's job (`packages/php`). Duplicating them per bridge is a DRY violation; the bridge
only proves its wiring hands the core the right things.

### Coverage gate (REQUIREMENTS §4)

Each bridge mirrors core's gate: unit line coverage **must not drop below 90%**
(`scripts/bridge-coverage.sh`, and the CI `coverage` job). As in core — where
`Freshen\Driver\Redis` is excluded because it is integration-tested — a bridge's
**live-Redis wiring path is excluded from the denominator**: none for Symfony (the
extension builds definitions, fully unit-covered), `src/FreshenManager.php` for Laravel
(it reuses Laravel's live phpredis client). Raise the floor as coverage improves; never
lower it to make CI pass.

## Releasing

See [RELEASING.md](RELEASING.md). Tags are `php-vX.Y.Z` / `ts-vX.Y.Z` /
`symfony-vX.Y.Z` / `laravel-vX.Y.Z`.

## License

By contributing you agree your contributions are licensed under the [MIT
License](LICENSE).
