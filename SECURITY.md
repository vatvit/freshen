# Security Policy

Freshen ships one package per language/framework; this policy covers all of them:

| Package | Ecosystem |
|---------|-----------|
| [`vatvit/freshen`](https://packagist.org/packages/vatvit/freshen) | Packagist (PHP core) |
| [`vatvit/freshen-symfony`](https://packagist.org/packages/vatvit/freshen-symfony) | Packagist (Symfony bridge) |
| [`vatvit/freshen-laravel`](https://packagist.org/packages/vatvit/freshen-laravel) | Packagist (Laravel bridge) |
| [`@vatvit/freshen`](https://www.npmjs.com/package/@vatvit/freshen) | npm (TS/JS) |

## Supported versions

Security fixes land on the **latest released minor** of each package (Freshen follows
SemVer; see [RELEASING.md](RELEASING.md) / [COMPATIBILITY.md](COMPATIBILITY.md)).

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** — do **not** open a public issue.
Use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/vatvit/freshen/security/advisories/new).
We aim to acknowledge within a few business days and to coordinate a fix and disclosure
with you.

## Advisory database & auditing

The PHP packages are tracked by the [Packagist security advisory
database](https://packagist.org/security-advisories) (the source Packagist surfaces on
each package's page and that Composer's audit uses). Check your installed dependencies at
any time:

```bash
composer audit          # PHP — flags any advisory-affected dependency
npm audit               # TS/JS
```

CI installs with Composer's advisory audit enabled, so a dependency with a known advisory
fails the build rather than shipping silently.
