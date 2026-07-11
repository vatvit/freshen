# Freshen — Laravel bridge

[![Packagist Version](https://img.shields.io/packagist/v/vatvit/freshen-laravel)](https://packagist.org/packages/vatvit/freshen-laravel)
[![PHP Version](https://img.shields.io/packagist/php-v/vatvit/freshen-laravel)](https://packagist.org/packages/vatvit/freshen-laravel)
[![License](https://img.shields.io/packagist/l/vatvit/freshen-laravel)](https://github.com/vatvit/freshen/blob/main/LICENSE)

> **Security** — tracked by the [Packagist security advisory database](https://packagist.org/packages/vatvit/freshen-laravel); run `composer audit` to check your install. Report privately via [GitHub Security Advisories](https://github.com/vatvit/freshen/security/advisories); policy in [SECURITY.md](https://github.com/vatvit/freshen/blob/main/SECURITY.md).

`vatvit/freshen-laravel` is the drop-in Laravel package for
[Freshen](https://github.com/vatvit/freshen), the stale-while-revalidate cache with
stampede prevention. It wires the manual pool/loader/listener setup from the core README
into a service provider + config file: `composer require`, publish the config, define one
cache per dataset, and resolve them by name — with async invalidation already on the queue.

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

## Versioning

Independent SemVer, released as `laravel-vX.Y.Z`. Depends on `vatvit/freshen-php` via
`^1.0@rc` (→ `^1.0` once core is stable). A core patch/minor needs no bridge release; a
core major does. See the monorepo `RELEASING.md`.

**Requires PHP 8.2+ and Laravel 11 or 12.** (Laravel 10 — the only 8.1-compatible line —
is EOL and flagged by composer security advisories, so it is not supported.)

## Links

- Core library & full docs: <https://github.com/vatvit/freshen> (`packages/php`)
- Manual (non-bridge) wiring: the core README's "Framework integration" section.
