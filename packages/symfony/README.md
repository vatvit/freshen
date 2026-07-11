# Freshen — Symfony bundle

> **Drop-in stale-while-revalidate caching for Symfony.** `composer require` + a little
> YAML gives you autowired, per-dataset caches with cache-stampede prevention and async
> invalidation — no boilerplate.

[![Packagist Version](https://img.shields.io/packagist/v/vatvit/freshen-symfony)](https://packagist.org/packages/vatvit/freshen-symfony)
[![PHP Version](https://img.shields.io/packagist/php-v/vatvit/freshen-symfony)](https://packagist.org/packages/vatvit/freshen-symfony)
[![License](https://img.shields.io/packagist/l/vatvit/freshen-symfony)](https://github.com/vatvit/freshen/blob/main/LICENSE)

The Symfony bundle for [Freshen](https://github.com/vatvit/freshen) brings the caching
pieces you normally wire up by hand into declarative config: **single-flight** recompute so
exactly one worker rebuilds a hot key while everyone else is served the last good value
(**no cache-stampede**); **preemptive refresh** that recomputes an entry *before* it goes
stale, on TTLs and jitter you control; **structured keys** and **effective delete** —
genuinely evict one exact key or a whole prefix, atomically and in one round-trip; and
**built-in metrics** on every hit, miss, and rebuild. Declare a cache per dataset in YAML,
inject it **by name**, and every cache-related decision is explicit and yours — no container
plumbing.

## Features

**Symfony integration**

- **Drop-in bundle** — `composer require` + a little YAML; the bundle wires the pool,
  loader, and invalidation listener for you (no manual container plumbing).
- **Declarative named caches** — define one `Freshen\Cache` per dataset in
  `config/packages/freshen.yaml` (loader + TTLs), each **autowired by name**
  (`Freshen\Cache $topSellersCache`).
- **Async invalidation, pre-wired** — each cache's `Freshen\AsyncHandler` is registered on
  Symfony's PSR-14 `event_dispatcher`, so `invalidate()` / `refresh()` dispatch and are
  handled with no listener wiring.
- **Symfony `^6.4 || ^7.0`, PHP 8.1 → 8.4** — PHPStan-max, MIT.

**Powered by Freshen core**

- **Stale-while-revalidate** — serve the cached value instantly and recompute a fresh one
  in the background; reads never block on an expired entry.
- **Cache-stampede prevention** — single-flight leader/follower recompute plus jittered
  TTLs: one worker rebuilds while everyone else is served the stale value (no thundering herd).
- **Structured, hierarchical keys** — `Freshen\Key` is `domain / facet [ / schemaVersion ]
  [ / locale ] / id`, with built-in schema **versioning** and **per-locale** variants.
- **Effective delete** — genuinely evict one exact key, a whole **prefix**
  (`domain/facet/*`), or a **batch** of selectors — atomically, in a single round-trip.
- **Redis-backed, PSR-6 core** — an atomic Redis driver (single-flight + exact/prefix
  delete) over a Stash PSR-6 pool; swap in any PSR-6 backend.
- **Built-in metrics & fail-open** — hit/miss/recompute metrics out of the box, and it
  serves through backend hiccups instead of failing the request.

Full detail in the [core README](https://github.com/vatvit/freshen/tree/main/packages/php).

## At a glance

`composer require`, declare a cache in one YAML block, then inject it **by name** — reading
is two lines, and you never touch the store, a stampede, or serialisation:

```php
use Freshen\Key;

// in any service — the argument name selects the cache (freshen.caches.top_sellers)
public function __construct(private \Freshen\Cache $topSellersCache) {}

$item = $this->topSellersCache->get(new Key('product', 'top-sellers', ['category' => 456]));

return $item->isMiss() ? [] : $item->value();
```

On a miss the cache calls your loader, stores the result, and returns it; later reads are
served **stale-while-revalidate** with **stampede protection** — all automatic.

## Install

```bash
composer require vatvit/freshen-symfony
```

Register the bundle (Symfony Flex does this automatically):

```php
// config/bundles.php
return [
    // ...
    Freshen\Bridge\Symfony\FreshenBundle::class => ['all' => true],
];
```

## Configure

`Freshen\Cache` is **per-dataset** — each cache binds one loader + TTL — so you declare
**named caches**. Each references a loader service (yours, implementing
`Freshen\Interface\LoaderInterface`) and a `\Redis` client service.

A Freshen cache is **one dataset**, so you define **one entry per data structure** (top
sellers, prices, …) — a real app has several:

```yaml
# config/packages/freshen.yaml
freshen:
    connection: Redis                 # shared \Redis client service id (optional if each cache sets its own)
    caches:
        top_sellers:
            loader: App\Cache\TopSellersLoader   # required — Freshen\Interface\LoaderInterface service
            hard_ttl: 3600                        # required, seconds (>= 1)
            precompute: 60                        # default 0 — soft window before hard TTL
            jitter: 15                            # default 15 (percent)
            fail_open: true                       # default true
            # connection: Redis                   # optional per-cache override
            # metrics: App\Cache\Metrics          # optional — Freshen\Interface\MetricsInterface service
        prices:                                   # a second dataset — its own loader + TTLs
            loader: App\Cache\PricesLoader
            hard_ttl: 600
            precompute: 30
```

The `connection` value is a **service id** for a connected `\Redis` client. Bring your
own, e.g.:

```yaml
# config/services.yaml
services:
    Redis:
        class: Redis
        calls:
            - connect: ['%env(REDIS_HOST)%', '%env(int:REDIS_PORT)%']
```

## Use

Inject each cache **by name** with named-argument autowiring — the argument name is the
camel-cased cache name plus `Cache`. This is how you reference a dataset whether you have
one cache or many (there is no bare `Freshen\Cache` "default" — with several datasets it
would be ambiguous, and it would silently break the day you add the second one):

```php
public function __construct(
    private \Freshen\Cache $topSellersCache,   // freshen.caches.top_sellers
    private \Freshen\Cache $pricesCache,       // freshen.caches.prices
) {}

$key    = new \Freshen\Key('product', 'detail', $id);
$result = $this->topSellersCache->get($key);
$result->value();                          // fresh or stale-while-revalidate value
$this->topSellersCache->invalidate($key);  // async by default — see below
```

## Async invalidation

The bundle registers each cache's `Freshen\AsyncHandler` on Symfony's PSR-14
`event_dispatcher`, so `invalidate()` / `invalidateExact()` / `refresh()` (async by
default) dispatch `Freshen\{Invalidate,InvalidateExact,Refresh}Event` and are handled
without you wiring listeners.

Call it wherever your data changes — e.g. an application service — and the bundle's
registered handler does the rest:

```php
use Freshen\Key;

// An app service that mutates a product — drop its cached view when it does.
final class ProductUpdater
{
    public function __construct(private \Freshen\Cache $topSellersCache) {}

    public function update(Product $product): void
    {
        // ... persist the change ...

        $key = new Key('product', 'detail', $product->getId());
        $this->topSellersCache->invalidate($key);   // async → dispatches InvalidateEvent, handled by the bundle
        // $this->topSellersCache->refresh($key);     // async → recompute + store
    }
}
```

Symfony's `event_dispatcher` is **synchronous**, so the handler runs within the same
request: the async default *decouples* invalidation from the call site, it does not by
itself move the work off-process (unlike the Laravel bridge's queue). To skip the event
and invalidate inline, pass `SyncMode::SYNC`:

```php
use Freshen\SyncMode;

$this->topSellersCache->invalidate($key, SyncMode::SYNC);   // invalidates now, no event dispatched
```

> **Caveat — shared dispatcher fan-out.** These events carry a **key only, not a cache
> id**, so an async `invalidate($key)` is delivered to *every* configured cache's
> handler. Where a cache doesn't hold that key it's a harmless no-op, but caches that
> use **colliding key namespaces** would cross-invalidate. Give each cache a distinct
> `Key` domain/facet (they naturally differ per dataset) and this is a non-issue.

## Security

Tracked by the [Packagist security advisory database](https://packagist.org/packages/vatvit/freshen-symfony)
— run `composer audit` to check your install. Report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/vatvit/freshen/security/advisories); the full
policy is in [SECURITY.md](https://github.com/vatvit/freshen/blob/main/SECURITY.md).

## Versioning

Independent SemVer, released as `symfony-vX.Y.Z`. Depends on `vatvit/freshen-php` via
`^1.0`. A core patch/minor needs no bridge release; a core major does. See the monorepo
`RELEASING.md`.

## Links

- Core library & full docs: <https://github.com/vatvit/freshen> (`packages/php`)
- Manual (non-bundle) wiring: the core README's "Framework integration" section.
