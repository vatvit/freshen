# Compatibility & Versioning Policy

`freshen` is a public library. Its versions and its backward-compatibility
guarantees are a contract with everyone who installs it.

## Versioning is manual

- We follow [Semantic Versioning 2.0.0](https://semver.org).
- **Version numbers are chosen by a human**, deliberately, at release time.
  There is **no** automated version bumping (no semantic-release, no
  conventional-commit inference). The release tag is the source of truth and
  must match the package manifest.
- Each language package is versioned **independently**:
  - PHP → tag `php-vX.Y.Z` (Packagist `vatvit/freshen`)
  - TS/JS → tag `ts-vX.Y.Z` (npm `@vatvit/freshen`)

## What "the public API" means

Backward compatibility is promised **only** for the public API:

- **Covered:** documented public classes, methods, functions, exported types,
  constructor/method signatures, configuration options, thrown exception/error
  types, and observable behaviour of the above.
- **Not covered** (may change any time, no SemVer impact): anything marked
  `@internal` / `#[Internal]`, non-exported TS symbols, `@experimental` / `@beta`
  API, test helpers, and the exact wording of messages/logs.

## SemVer rules

| Change | Bump |
|--------|------|
| Bug fix, internal refactor, no API change | **patch** (`x.y.Z`) |
| Backward-compatible addition (new optional arg with default, new method/type) | **minor** (`x.Y.z`) |
| Remove/rename a public symbol; change a signature; change documented behaviour; narrow a return / widen a required input; **drop a supported runtime** (PHP/Node version) | **major** (`X.y.z`) |

Dropping a supported PHP or Node version is a **breaking change** → major bump.

## Backward-compatibility control (how we enforce it)

BC is not left to memory. Every change is checked three ways:

1. **Design-time** — the `api-design` workflow step classifies the SemVer impact
   of the public-surface change before code is written.
2. **Automated BC check (CI gate)** — a detector compares the branch against the
   last release and **fails CI on an undeclared break**:
   - PHP: [`roave/backward-compatibility-check`](https://github.com/Roave/BackwardCompatibilityCheck)
   - TS: a committed public-API report (via API Extractor) whose diff must be
     reviewed; type-level breaks also checked with `@arethetypeswrong/cli`.
   A break is allowed **only** when the release is a deliberate major and the
   break is recorded in the changelog + upgrade notes.
3. **Review-time** — the `review` step requires explicit BC + cross-language
   parity sign-off before merge to `main`.

## Deprecation policy

Prefer deprecate-then-remove:

1. Mark the symbol `@deprecated` with the replacement and the target removal
   version. Keep it working.
2. Removal happens **only** in a subsequent **major** release, never before.

## Pre-1.0 and Release Candidates

Until the first stable `1.0.0`, and for any `-rc.N` / `0.x` release, the API may
still change between releases — BC guarantees above apply **in full from
`1.0.0`**. Release candidates are for integration feedback, not a stability
promise.

## Migration notes

Every breaking change ships with:
- a `CHANGELOG.md` entry under the new major version, and
- a migration/upgrade note describing what changed and how to adapt.
