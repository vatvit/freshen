# Releasing

Freshen uses **GitFlow** branching and **independent, per-package SemVer**
versioning. The two packages release on their own cadence.

## Branching model (GitFlow)

| Branch | Purpose |
|--------|---------|
| `main` | Always-releasable. Every merge is production-quality. Tags are cut here. |
| `develop` | Integration branch for the next release. |
| `feature/*` | Branch off `develop`, merge back into `develop`. |
| `release/*` | Branch off `develop` to stabilize a release; merge into `main`, tag, then merge `main` → `develop`. |
| `hotfix/*` | Branch off `main` for urgent fixes; merge into `main`, tag, then merge `main` → `develop`. |

CI (tests, quality gates) must be green before any merge to `develop` or `main`.

**Reconcile via `main`, not the release branch.** After tagging on `main`, bring the
release back to `develop` by merging **`main` → `develop`** (`--no-ff`) — *not* the
`release/*` branch. Merging the release branch into both `main` and `develop` creates
two independent merge commits, so `main` is never an ancestor of `develop` and the two
histories drift apart (harmless in content, but noisy). Merging `main` into `develop`
keeps `main` a true ancestor of `develop`, so `develop` is always "`main` plus the
unreleased work."

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

1. Cut `release/php-v1.2.0` off `develop`.
2. Move `packages/php/CHANGELOG.md` Unreleased → the version (on the release branch).
3. Verify the full matrix: `scripts/php-test.sh` (and `scripts/php-redis-it.sh` if the
   release touches the live-Redis path).
4. Merge the release branch `--no-ff` into `main`, then tag on `main` and push:
   ```bash
   git checkout main && git merge --no-ff release/php-v1.2.0
   git tag php-v1.2.0 && git push origin main php-v1.2.0
   ```
5. **Reconcile:** merge `main` back into `develop` (`--no-ff`) — *not* the release
   branch — and push; then delete the release branch:
   ```bash
   git checkout develop && git merge --no-ff main && git push origin develop
   git branch -d release/php-v1.2.0 && git push origin --delete release/php-v1.2.0
   ```
6. The `php-v1.2.0` tag triggers `release-php.yml`, which publishes `packages/php`
   (source) to the Packagist mirror repo. Packagist exposes it as `vatvit/freshen`
   `1.2.0`.

## Publishing (shared workflow)

Every package publishes through **one reusable workflow**,
`.github/workflows/publish-package.yml` — `release-<pkg>.yml` is just a thin caller that
passes `package_dir` / `composer_name` / `mirror_repo`. The shared workflow:

- **Injects monorepo metadata** into the published `composer.json` — `homepage` +
  `support.{issues,source}` point at this monorepo (`.../tree/main/<package_dir>`), not
  the mirror repo Packagist watches, so the Packagist page links home (FRSH-028).
- **Publishes on the tag only** — never an installable default branch, so Packagist
  surfaces no `dev-*` version (FRSH-021).
- **Syncs the mirror README** — the package README onto the mirror's default branch,
  README-only, using the shared banner `.github/mirror/banner.md.tmpl` with relative
  links rewritten to absolute monorepo URLs (FRSH-027).

**Adding a package:** create its mirror repo (default branch = a `composer.json`-free
placeholder), register it on Packagist, then add a `release-<pkg>.yml` caller. No
per-package publish logic, banner, or `composer.json` metadata to maintain.

## TS release

Same GitFlow flow as PHP (release branch → `main` → tag → reconcile `main` → `develop`);
only the package-specific steps differ:

1. Cut `release/ts-v1.2.0` off `develop`; bump `packages/ts/package.json` `version`
   and update its `CHANGELOG.md` on that branch.
2. Verify the matrix: `scripts/ts-test.sh`.
3. Merge `--no-ff` into `main`, then tag on `main` (tag must match `package.json`) and
   push:
   ```bash
   git checkout main && git merge --no-ff release/ts-v1.2.0
   git tag ts-v1.2.0 && git push origin main ts-v1.2.0
   ```
4. Reconcile: `git checkout develop && git merge --no-ff main && git push origin develop`,
   then delete the release branch.
5. The `ts-v1.2.0` tag triggers `release-ts.yml`, which builds and `npm publish`es
   `@vatvit/freshen` with provenance.

## One-time setup (secrets & mirror)

- **PHP:** create the `vatvit/freshen-php` mirror repo, add `MIRROR_TOKEN`
  (PAT with push access) as an Actions secret, register the mirror on Packagist.
- **TS:** add `NPM_TOKEN` (npm automation token) as an Actions secret.

## Stable-build guarantees

- Every supported runtime is tested in its own container **before** release:
  PHP **8.1 → 8.4** (native) and Node **16/18/20/22** (built artifact).
- The published artifact is exactly what CI tested — the dist, not raw source.
