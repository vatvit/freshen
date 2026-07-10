# Freshen

High-performance cache library implementing **stale-while-revalidate** with
**cache-stampede prevention** (single-flight leader/follower recomputation and
jittered TTLs).

This is a **monorepo** containing independent implementations for multiple
language stacks. Consumers install **only** the package for their language from
its native registry — they never depend on this repository as a whole.

| Language | Package | Supported runtimes | Registry | Source |
|----------|---------|--------------------|----------|--------|
| PHP | `vatvit/freshen`  | **8.1 → 8.4** | Packagist | [`packages/php`](packages/php) |
| TS / JS | `@vatvit/freshen` | **Node 16 → 22** (ES2020) | npm | [`packages/ts`](packages/ts) |

## Install

```bash
composer require vatvit/freshen      # PHP
npm install @vatvit/freshen          # TS / JS
```

## Repository layout

```
freshen/
├── packages/
│   ├── php/        # single source, PHP 8.1+ (runs natively 8.1→8.4)
│   └── ts/         # ES2020 build (esm + cjs + d.ts)
├── scripts/        # Docker per-version test runners (no host runtimes)
├── .github/workflows/
│   ├── ci-php.yml       # test matrix 8.1→8.4 + static analysis
│   ├── ci-ts.yml        # build/quality on Node 20 + smoke on 16/18/20/22
│   ├── release-php.yml  # php-v* tag → publish source → Packagist mirror
│   └── release-ts.yml   # ts-v* tag → npm publish
├── RELEASING.md    # GitFlow + SemVer + release steps
└── LICENSE         # MIT
```

## Stable-build strategy

**Every supported version is tested in its own Docker container** before release.
The PHP package is a single source that runs natively across 8.1→8.4 (Composer
resolves a version-appropriate PHPUnit — 10.x on 8.1, 11.x on 8.2+). The TS
package is built once and the bundle is smoke-loaded on Node 16→22. What CI
tests is exactly what consumers install.

## Versioning & releases

Independent, per-package **SemVer**, **chosen manually** (no automated bumping);
tags are prefixed `php-vX.Y.Z` / `ts-vX.Y.Z`. Backward compatibility is a
CI-enforced contract — see [COMPATIBILITY.md](COMPATIBILITY.md). Branching
follows **GitFlow**. See [RELEASING.md](RELEASING.md).

## Parity

The implementations are maintained **independently**; behavioral parity is
tracked by documentation and each package's own test suite (no shared
conformance harness at this stage). The language-neutral feature contract every
package implements is [docs/PARITY.md](docs/PARITY.md).

## License

[MIT](LICENSE) — free for commercial, open-source, and any other use. The only
condition is preserving the copyright/license notice in source copies.
