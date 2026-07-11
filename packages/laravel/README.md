# Freshen — Laravel bridge

> **Drop-in stale-while-revalidate caching for Laravel.** `composer require`, publish one
> config, and resolve caches by name through the `Freshen` facade — with cache-stampede
> prevention and queued async invalidation.

[![Packagist Version](https://img.shields.io/packagist/v/vatvit/freshen-laravel)](https://packagist.org/packages/vatvit/freshen-laravel)
[![PHP Version](https://img.shields.io/packagist/php-v/vatvit/freshen-laravel)](https://packagist.org/packages/vatvit/freshen-laravel)
[![License](https://img.shields.io/packagist/l/vatvit/freshen-laravel)](https://github.com/vatvit/freshen/blob/main/LICENSE)

The Laravel bridge for [Freshen](https://github.com/vatvit/freshen) brings the caching
pieces you normally wire up by hand into a service provider + facade: **single-flight**
recompute so exactly one worker rebuilds a hot key while everyone else is served the last
good value (**no cache-stampede**); **preemptive refresh** that recomputes an entry *before*
it goes stale, on TTLs and jitter you control; **structured keys** and **effective delete**
— genuinely evict one exact key or a whole prefix, atomically and in one round-trip; and
**built-in metrics** on every hit, miss, and rebuild. Define a cache per dataset in
`config/freshen.php`, reach it with `Freshen::cache('...')` (async invalidation on the
queue), and every cache-related decision is explicit and yours.

## Features

**Laravel integration**

- **Drop-in bridge** — auto-discovered service provider + `Freshen` facade; `composer
  require`, publish one config file, and go.
- **Declarative named caches** — define one `Freshen\Cache` per dataset in
  `config/freshen.php`, resolved by name via `Freshen::cache('top_sellers')` or the
  injected `FreshenManager`.
- **Queued async invalidation** — `invalidate()` / `refresh()` run on Laravel's **queue**
  (off the request) via a PSR-14→queue adapter; a `sync` connection runs them inline.
- **Laravel `^11 || ^12`, PHP 8.2 → 8.4** — PHPStan-max, MIT.

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

`composer require`, define a cache in `config/freshen.php`, then reach it by name through
the `Freshen` facade — reading is two lines, and you never touch the store, a stampede, or
serialisation:

```php
use Freshen\Bridge\Laravel\Facades\Freshen;
use Freshen\Key;

$item = Freshen::cache('top_sellers')->get(new Key('product', 'top-sellers', ['category' => 456]));

return $item->isMiss() ? [] : $item->value();
```

On a miss the cache calls your loader, stores the result, and returns it; later reads are
served **stale-while-revalidate** with **stampede protection** — all automatic.

## Install

```bash
composer require vatvit/freshen-laravel
```

The `FreshenServiceProvider` is auto-discovered (package discovery). Publish the config:

```bash
php artisan vendor:publish --tag=freshen-config
```

## Configure

A Freshen cache is **one dataset** — its own loader + TTLs — so a real app defines **one
cache per data structure** (top sellers, prices, categories, …). You declare each under
`caches` in `config/freshen.php`, keyed by the name you'll resolve it with. Each references
a loader (yours, implementing `Freshen\Interface\LoaderInterface`) resolved from the
container, and a Laravel **redis connection name** whose phpredis client Freshen reuses.

```php
// config/freshen.php
return [
    'queue' => [
        'connection' => env('FRESHEN_QUEUE_CONNECTION'), // null = default; 'sync' = inline
        'queue' => env('FRESHEN_QUEUE'),                 // null = default queue name
    ],

    // one entry per dataset — the key is the name you pass to Freshen::cache('<name>')
    'caches' => [
        'top_sellers' => [
            'loader' => App\Cache\TopSellersLoader::class, // required — LoaderInterface
            'hard_ttl' => 3600,                            // required, seconds (>= 1)
            'precompute' => 60,                            // default 0 — soft window
            'jitter' => 15,                                // default 15 (percent)
            'fail_open' => true,                           // default true
            'connection' => 'default',                     // Laravel redis connection name
            // 'metrics' => App\Cache\Metrics::class,      // optional — MetricsInterface
        ],
        'prices' => [
            'loader' => App\Cache\PricesLoader::class,
            'hard_ttl' => 600,
            'precompute' => 30,
        ],
    ],
];
```

Freshen reuses the phpredis client from `config/database.php`'s `redis.<connection>` — no
second connection is opened. Use the phpredis client (`'client' => 'phpredis'`).

## Use

Resolve a cache **by name** with the `Freshen` facade — there is no "default" cache, since
each one is a distinct dataset:

```php
use Freshen\Bridge\Laravel\Facades\Freshen;
use Freshen\Key;

$key    = new Key('product', 'detail', $id);
$result = Freshen::cache('top_sellers')->get($key);
$result->value();                             // fresh or stale-while-revalidate value

Freshen::cache('top_sellers')->invalidate($key);   // async by default — see below
```

Prefer constructor injection? Inject the manager and pick the dataset:

```php
use Freshen\Bridge\Laravel\FreshenManager;

public function __construct(private FreshenManager $freshen) {}

$this->freshen->cache('prices')->get($key);
```

(You inject **`FreshenManager`** (or use the `Freshen` facade), never a bare
`Freshen\Cache`: with several datasets Laravel can't autowire `Freshen\Cache` by type, so
it isn't bound — you always ask for a cache **by name**.)

## Async invalidation (queue)

Laravel's event dispatcher is **not** PSR-14, so the bridge ships a small PSR-14 adapter
that pushes async operations onto Laravel's **queue**. `invalidate()` / `invalidateExact()`
/ `refresh()` (async by default) dispatch a `ProcessFreshenAsyncEvent` job that runs the
cache's `Freshen\AsyncHandler` on a worker — off the request.

```php
use Freshen\Bridge\Laravel\Facades\Freshen;
use Freshen\Key;

// e.g. a model observer: when a product changes, drop its cached view
class ProductObserver
{
    public function saved(Product $product): void
    {
        $key = new Key('product', 'detail', $product->id);

        Freshen::cache('top_sellers')->invalidate($key);   // async → enqueues a job
        // Freshen::cache('top_sellers')->refresh($key);    // async recompute + store
    }
}
```

```bash
php artisan queue:work        # a worker runs the invalidation off the request
```

Need a specific call to run inline (no worker)? Pass `SyncMode::SYNC`:

```php
use Freshen\SyncMode;

Freshen::cache('top_sellers')->invalidate($key, SyncMode::SYNC);   // runs now, skips the queue
```

- Configure the connection/queue via `config/freshen.php` `queue` (or the
  `FRESHEN_QUEUE_CONNECTION` / `FRESHEN_QUEUE` env vars).
- Set the connection to `sync` to run **all** of a cache's invalidations inline (no worker).
- Run a worker for true off-request async: `php artisan queue:work`.

Each job carries its **target cache name**, so async invalidation is routed to exactly
the right cache (no cross-cache fan-out).

## Security

Tracked by the [Packagist security advisory database](https://packagist.org/packages/vatvit/freshen-laravel)
— run `composer audit` to check your install. Report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/vatvit/freshen/security/advisories); the full
policy is in [SECURITY.md](https://github.com/vatvit/freshen/blob/main/SECURITY.md).

## Versioning

Independent SemVer, released as `laravel-vX.Y.Z`. Depends on `vatvit/freshen-php` via
`^1.0`. A core patch/minor needs no bridge release; a
core major does. See the monorepo `RELEASING.md`.

**Requires PHP 8.2+ and Laravel 11 or 12.** (Laravel 10 — the only 8.1-compatible line —
is EOL and flagged by composer security advisories, so it is not supported.)

## Links

- Core library & full docs: <https://github.com/vatvit/freshen> (`packages/php`)
- Manual (non-bridge) wiring: the core README's "Framework integration" section.
