# Contributing

`freshen` is a monorepo with one package per language stack. Each package is
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
```

Quality gates: PHPUnit + **PHPStan (level max)**.

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
