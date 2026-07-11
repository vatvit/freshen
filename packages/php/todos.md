# Freshen PHP — README & docs TODO

Public, living list of improvement work that's been identified but not yet done. Mostly
README polish and gaps an enterprise adopter will ask about. Open to PRs — see
[Develop / contribute](./README.md#develop--contribute).

This file lives in `packages/php` in the [Freshen monorepo](https://github.com/vatvit/freshen);
it is subtree-split alongside the package into the read-only Packagist mirror.

---

## Trust & governance

- [ ] **Adoption signal.** Add a "Used in production by" or short quote block once there are
      reference users. Today the only trust signal is the Packagist downloads badge. The
      `1.x` stability note in the README is a stopgap, not a substitute.
- [ ] **Formal support / LTS policy.** No published support window for older PHP minors or
      the previous N-1 minor of Freshen itself. Add a short SUPPORT.md or a section in the
      README stating: which PHP versions get security fixes, EOL dates, and the `1.x` → `2.0`
      transition plan.
- [ ] **Release cadence note.** State expected cadence (e.g. "patch as needed, minor
      monthly-ish") so teams can plan upgrade windows. Low effort, removes an unknown.

## Performance

- [ ] **Back the round-trip / single-flight claims with numbers.** README currently hedges
      to "single round-trip in the common case" — add a one-line benchmark (ops/sec, p99
      latency under N concurrent readers of one cold key) vs. raw Redis `SET NX` and Symfony
      Cache's lock. Even a rough `bench/` script + a results table would convert the hedge
      back to a firm claim. Target section: README §Features / a new §Benchmarks.
- [ ] **Prefix-delete cost.** "atomic, single round-trip" for prefix delete should state the
      Redis primitive (`UNLINK` over `SCAN`?) and any scaling caveat (large keyspaces).

## Operations / runbook

- [ ] **"What to monitor" runbook.** A 5–10 line section: which `cache_*` metrics to alert
      on (spike in `cache_miss`, recompute latency, fail-open `HIT` rate), suggested
      thresholds, and the on-call diagnostic for a stampede that leaks through. Links to
      `docs/METRICS.md` but doesn't repeat the full catalog.
- [ ] **Failure-mode playbook.** What an operator sees when Redis is down (fail-open
      behaviour), when the PSR-14 dispatcher backs up, and when a loader throws. Today this
      is implicit in `docs/PARITY.md` §7 — surface it as a scannable list.

## Onboarding

- [ ] **Quickstart verified.** The README §Quickstart was executed against `vatvit/freshen-php`
      v1.0.1 + a local Redis (2026-07-11) and produced the documented MISS→FILL / HIT /
      invalidate / MISS→FILL cycle. Re-verify on each minor release; the last-known-good
      runner is sketched in the PR that introduced it.
- [ ] **Framework bridge quickstarts.** Symfony & Laravel bridges are listed in a table but
      have no copy-paste "first 10 lines" each. Even a collapsed `<details>` per framework
      would close the gap vs. the generic PHP quickstart.

## README polish

- [ ] **Anchor-link audit.** The Contents list assumes GitHub's default slugification;
      verify every link resolves (notably `#escape-hatch--limitations` with the double hyphen).
- [ ] **Mermaid on Packagist.** Packagist renders READMEs but not always mermaid — confirm
      any sequence diagram degrades gracefully (a static image fallback or an `alt` note) on
      the rendered package page. (The PHP README currently has no diagram; revisit if one is
      added.)
