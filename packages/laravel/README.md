# Freshen — Laravel bridge

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

(Injecting a bare `Freshen\Cache` is intentionally **not** supported — with many datasets
it would be ambiguous which one you mean.)

## Async invalidation (queue)

Laravel's event dispatcher is **not** PSR-14, so the bridge ships a small PSR-14 adapter
that pushes async operations onto Laravel's **queue**. `invalidate()` / `invalidateExact()`
/ `refresh()` (async by default) dispatch a `ProcessFreshenAsyncEvent` job that runs the
cache's `Freshen\AsyncHandler` on a worker — off the request.

- Configure the connection/queue via `config/freshen.php` `queue` (or the
  `FRESHEN_QUEUE_CONNECTION` / `FRESHEN_QUEUE` env vars).
- Set the connection to `sync` to run invalidation **inline** (no worker needed).
- Run a worker for true off-request async: `php artisan queue:work`.

Each job carries its **target cache name**, so async invalidation is routed to exactly
the right cache (no cross-cache fan-out).

## Versioning

Independent SemVer, released as `laravel-vX.Y.Z`. Depends on `vatvit/freshen` via
`^1.0@rc` (→ `^1.0` once core is stable). A core patch/minor needs no bridge release; a
core major does. See the monorepo `RELEASING.md`.

**Requires PHP 8.2+ and Laravel 11 or 12.** (Laravel 10 — the only 8.1-compatible line —
is EOL and flagged by composer security advisories, so it is not supported.)

## Links

- Core library & full docs: <https://github.com/vatvit/freshen> (`packages/php`)
- Manual (non-bridge) wiring: the core README's "Framework integration" section.
