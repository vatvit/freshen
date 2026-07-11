# Freshen — Symfony bundle

[![Packagist Version](https://img.shields.io/packagist/v/vatvit/freshen-symfony)](https://packagist.org/packages/vatvit/freshen-symfony)
[![PHP Version](https://img.shields.io/packagist/php-v/vatvit/freshen-symfony)](https://packagist.org/packages/vatvit/freshen-symfony)
[![License](https://img.shields.io/packagist/l/vatvit/freshen-symfony)](https://github.com/vatvit/freshen/blob/main/LICENSE)

> **Security** — tracked by the [Packagist security advisory database](https://packagist.org/packages/vatvit/freshen-symfony); run `composer audit` to check your install. Report privately via [GitHub Security Advisories](https://github.com/vatvit/freshen/security/advisories); policy in [SECURITY.md](https://github.com/vatvit/freshen/blob/main/SECURITY.md).

`vatvit/freshen-symfony` is the drop-in Symfony bundle for
[Freshen](https://github.com/vatvit/freshen), the stale-while-revalidate cache with
stampede prevention. It wires the manual pool/loader/listener setup from the core
README into declarative config: `composer require` + a little YAML gives you one autowired,
per-dataset `Freshen\Cache` per data structure, injected by name, with async invalidation
already registered.

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

## Versioning

Independent SemVer, released as `symfony-vX.Y.Z`. Depends on `vatvit/freshen-php` via
`^1.0`. A core patch/minor needs no bridge release; a core major does. See the monorepo
`RELEASING.md`.

## Links

- Core library & full docs: <https://github.com/vatvit/freshen> (`packages/php`)
- Manual (non-bundle) wiring: the core README's "Framework integration" section.
