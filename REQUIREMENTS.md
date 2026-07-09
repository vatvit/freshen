# freshen — Project Requirements

The standards this library is built and maintained to. Applies to every language
package. These are requirements, not aspirations — CI enforces the automatable
ones, and review enforces the rest.

## 1. Purpose

A high-performance cache library implementing **stale-while-revalidate** with
**cache-stampede prevention** (single-flight leader/follower recompute + jittered
TTLs), shipped as a reusable, shareable open-source package in multiple languages.

## 2. Licensing

- **MIT** — free for commercial, open-source, and any other use.
- A single `LICENSE` file at the repo root; no per-file headers required.
- Contributions are accepted under MIT (see `CONTRIBUTING.md`).
- No dependency may impose a stricter license than MIT permits to combine with.

## 3. Languages & runtimes (wide support)

| Package | Source baseline | Shipped support | How |
|---------|-----------------|-----------------|-----|
| PHP | **8.1** (single source) | **8.1 → 8.4** | one source, runs natively (no downgrade) |
| TS/JS | TypeScript (latest) | **Node 16 → 22** | ES2020 build (esm + cjs + d.ts) |

- PHP is a single source that runs natively across the range (Composer resolves a
  version-appropriate PHPUnit per container). TS ships a **built artifact** (bundle)
  which is what consumers install and what CI smoke-tests.
- Adopt new runtimes as they land; **dropping a supported runtime is a major bump.**

## 4. Quality gates (mandatory, CI-blocking)

- **PHP:** PHPUnit green; **PHPStan level max** (baseline only with a filed
  tech-debt ticket, shrinking over time); PSR-12 style; `declare(strict_types=1)`
  in every file; public symbols documented.
- **TS:** Vitest green; `tsc --strict` (+ `noUncheckedIndexedAccess`); ESLint zero
  warnings.
- **Coverage** tracked and not allowed to regress.
- No secrets, credentials, or personal data in code, tests, or fixtures.
- No `TODO`/`FIXME` without a linked ticket.

## 5. Testing

- Unit tests must be deterministic and dependency-free (mock external backends;
  no live Redis in unit tests).
- Every supported runtime is exercised in **its own Docker container** before
  release (`scripts/`), against the shipped artifact.
- All toolchains run in Docker — **nothing on the host**.

## 6. Versioning & backward compatibility

- **[SemVer 2.0.0](https://semver.org), chosen manually** — no automated bumping.
- Independent per package; tags `php-vX.Y.Z` / `ts-vX.Y.Z`.
- **Backward compatibility is a CI-enforced contract** — see `COMPATIBILITY.md`
  (public-API definition, bump rules, deprecation policy, BC-check gate).
- Cross-language **parity**: the same behaviour in every language package; a
  language-neutral feature contract is the source of truth.

## 7. CI/CD

- **GitHub Actions**, path-filtered per package:
  - `ci-php.yml` — test matrix 8.1→8.4 + static analysis.
  - `ci-ts.yml` — build/quality on modern Node + smoke matrix (16→22).
- **Release** on tags: `release-php.yml` (publish source → Packagist mirror),
  `release-ts.yml` (npm publish with provenance).
- **GitFlow** branching; CI green required before merge to `develop`/`main`.
- Published versions are **immutable** — never re-publish or move a tag.

## 8. Architecture & code standards

- Depend on **interfaces**, not implementations; backends are pluggable (any
  PSR-6/Stash pool for PHP). Optional backends are `suggest`, not hard `require`
  (e.g. `ext-redis`).
- Structured cache keys (domain/facet/id) with hierarchical invalidation.
- Prefer async (event-dispatched) invalidation/refresh; degrade safely.
- Fail-open under contention where correctness allows.
- Small, single-responsibility units; no dead code shipped to consumers.

## 9. Security

- Least surprise on untrusted input; validate public entry points.
- Keep the dependency surface minimal and auditable.
- A documented way to report vulnerabilities (`SECURITY.md`, to be added).

## 10. Documentation

- Per-package `README` with install + usage; root `README` overview.
- `CHANGELOG.md` per package (Keep a Changelog).
- `CONTRIBUTING.md`, `RELEASING.md`, `COMPATIBILITY.md`, this `REQUIREMENTS.md`.
- Public API documented; runnable examples kept working.

## 11. Definition of done (per change)

Quality gates green · compatibility matrix green · docs updated · BC classified ·
parity preserved · reviewed. Releases additionally: changelog moved, tag pushed,
published artifact verified from a clean install.
