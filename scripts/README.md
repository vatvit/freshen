# scripts

All scripts run their language toolchains **inside Docker** — nothing is
installed or executed on the host.

| Script | What it does |
|--------|--------------|
| `php-test.sh` | Run PHPUnit + PHPStan in each PHP container (8.1 → 8.4). The PHP source runs natively across the whole range. |
| `ts-test.sh` | Build + lint + typecheck + coverage on Node 20, then smoke-load the built dist on Node 16/18/20/22. |

## Why the split differs by language

The **PHP** source runs natively on every supported PHP version, so it's tested
directly in each container (Composer resolves a version-appropriate PHPUnit —
10.x on 8.1, 11.x on 8.2+). There is no downgrade or dist step.

The **TS** dev toolchain (ESLint 9, Vitest 2, tsup) needs Node ≥18, so TS is
built/quality-gated on a modern Node and the built bundle — exactly what
consumers install — is smoke-loaded across the full Node range.

## Examples

```bash
scripts/php-test.sh              # full PHP matrix (8.1 → 8.4)
scripts/php-test.sh 8.1          # just PHP 8.1

scripts/ts-test.sh               # full Node matrix
scripts/ts-test.sh 16            # build on 20, smoke-load on 16
```
