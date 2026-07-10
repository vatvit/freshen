# Freshen — Symfony bundle

`vatvit/freshen-symfony` is the drop-in Symfony bundle for
[Freshen](https://github.com/vatvit/freshen), the stale-while-revalidate cache with
stampede prevention. It wires the manual pool/loader/listener setup from the core
README into declarative config: `composer require` + a little YAML gives you autowired
`Freshen\Cache` instances with async invalidation already registered.

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

```yaml
# config/packages/freshen.yaml
freshen:
    connection: Redis                 # default \Redis client service id (optional if each cache sets its own)
    caches:
        top_sellers:
            loader: App\Cache\TopSellersLoader   # required — Freshen\Interface\LoaderInterface service
            hard_ttl: 3600                        # required, seconds (>= 1)
            precompute: 60                        # default 0 — soft window before hard TTL
            jitter: 15                            # default 15 (percent)
            fail_open: true                       # default true
            # connection: Redis                   # optional per-cache override
            # metrics: App\Cache\Metrics          # optional — Freshen\Interface\MetricsInterface service
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

With **one** cache configured, inject `Freshen\Cache` directly:

```php
public function __construct(private \Freshen\Cache $cache) {}

$result = $this->cache->get(new \Freshen\Key('product', 'detail', $id));
$result->value();      // the loader's value (fresh or stale-while-revalidate)
$this->cache->invalidate($key);   // async by default — see below
```

With **several** caches, use named-argument autowiring — the argument name is the
camel-cased cache name plus `Cache`:

```php
public function __construct(
    private \Freshen\Cache $topSellersCache,   // freshen.caches.top_sellers
    private \Freshen\Cache $pricesCache,       // freshen.caches.prices
) {}
```

## Async invalidation

The bundle registers each cache's `Freshen\AsyncHandler` on Symfony's PSR-14
`event_dispatcher`, so `invalidate()` / `invalidateExact()` / `refresh()` (async by
default) dispatch `Freshen\{Invalidate,InvalidateExact,Refresh}Event` and are handled
without you wiring listeners.

> **Caveat — shared dispatcher fan-out.** These events carry a **key only, not a cache
> id**, so an async `invalidate($key)` is delivered to *every* configured cache's
> handler. Where a cache doesn't hold that key it's a harmless no-op, but caches that
> use **colliding key namespaces** would cross-invalidate. Give each cache a distinct
> `Key` domain/facet (they naturally differ per dataset) and this is a non-issue.

## Versioning

Independent SemVer, released as `symfony-vX.Y.Z`. Depends on `vatvit/freshen` via
`^1.0@rc` (→ `^1.0` once core is stable). A core patch/minor needs no bridge release; a
core major does. See the monorepo `RELEASING.md`.

## Links

- Core library & full docs: <https://github.com/vatvit/freshen> (`packages/php`)
- Manual (non-bundle) wiring: the core README's "Framework integration" section.
