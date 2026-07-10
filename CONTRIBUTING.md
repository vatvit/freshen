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

## Releasing

See [RELEASING.md](RELEASING.md). Tags are `php-vX.Y.Z` / `ts-vX.Y.Z`.

## License

By contributing you agree your contributions are licensed under the [MIT
License](LICENSE).
