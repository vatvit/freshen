# Releasing

`freshen` uses **GitFlow** branching and **independent, per-package SemVer**
versioning. The two packages release on their own cadence.

## Branching model (GitFlow)

| Branch | Purpose |
|--------|---------|
| `main` | Always-releasable. Every merge is production-quality. Tags are cut here. |
| `develop` | Integration branch for the next release. |
| `feature/*` | Branch off `develop`, merge back into `develop`. |
| `release/*` | Branch off `develop` to stabilize a release; merge into `main` **and** `develop`. |
| `hotfix/*` | Branch off `main` for urgent fixes; merge into `main` **and** `develop`. |

CI (tests, quality gates) must be green before any merge to `develop` or `main`.

## Versioning

- **[SemVer](https://semver.org)**, independent per package.
- **Chosen manually** — no automated bumping. The human picks the version per the
  SemVer rules in [COMPATIBILITY.md](COMPATIBILITY.md); the release tag is the
  source of truth and must match the package manifest.
- **Backward compatibility is enforced**, not assumed — a CI BC-check gate fails
  on any undeclared break; see [COMPATIBILITY.md](COMPATIBILITY.md).
- Tags are **prefixed** so both packages coexist in one repo:
  - PHP → `php-vX.Y.Z`
  - TS  → `ts-vX.Y.Z`
- Each package keeps its own `CHANGELOG.md` (Keep a Changelog format).

## PHP release

1. On `main`, update `packages/php/CHANGELOG.md` (move Unreleased → the version).
2. Verify the full matrix locally: `scripts/php-test.sh`.
3. Tag and push:
   ```bash
   git tag php-v1.2.0 && git push origin php-v1.2.0
   ```
4. `release-php.yml` publishes `packages/php` (source) to the Packagist mirror
   repo. Packagist exposes it as `vatvit/freshen` `1.2.0`.

## TS release

1. Bump `packages/ts/package.json` `version` and update its `CHANGELOG.md`.
2. Verify the matrix locally: `scripts/ts-test.sh`.
3. Tag and push (tag must match `package.json`):
   ```bash
   git tag ts-v1.2.0 && git push origin ts-v1.2.0
   ```
4. `release-ts.yml` builds and `npm publish`es `@vatvit/freshen` with provenance.

## One-time setup (secrets & mirror)

- **PHP:** create the `vatvit/freshen-php` mirror repo, add `MIRROR_TOKEN`
  (PAT with push access) as an Actions secret, register the mirror on Packagist.
- **TS:** add `NPM_TOKEN` (npm automation token) as an Actions secret.

## Stable-build guarantees

- Every supported runtime is tested in its own container **before** release:
  PHP **8.1 → 8.4** (native) and Node **16/18/20/22** (built artifact).
- The published artifact is exactly what CI tested — the dist, not raw source.
