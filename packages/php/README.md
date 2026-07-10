# freshen (PHP)

PHP implementation of **freshen** — a **stale-while-revalidate** cache with
**cache-stampede prevention** (single-flight leader/follower recompute + jittered
TTLs).

Runs natively on **PHP 8.1 → 8.4** (single source, no downgrade build). See
[`COMPATIBILITY.md`](../../COMPATIBILITY.md).

> This directory is the source of truth. It is subtree-split by CI into a
> read-only mirror repository that Packagist serves.

## Install

```bash
composer require vatvit/freshen
```

Requires a [PSR-6](https://www.php-fig.org/psr/psr-6/) cache pool
([Stash](https://github.com/tedious/Stash)). `ext-redis` is *suggested* for a Redis
backend.

## Usage

### 1. Wire a backend

`Freshen\Cache` uses [Stash](https://github.com/tedious/Stash) under the hood —
configure your pool per Stash's documentation. For the **full** guarantees (atomic
single-flight recompute and **exact**, non-hierarchical invalidation) use Freshen's
Redis driver, `Freshen\Driver\Redis`, in place of `Stash\Driver\Redis`:

```php
use Freshen\Driver\Redis as FreshenRedis;

$pool = new \Stash\Pool(new FreshenRedis(['connection' => new \Redis()]));
```

`Cache` wires its own item class (`Freshen\Item`, for deterministic TTLs and exact
delete) onto the pool automatically — you don't set it yourself. Strong single-flight
needs a backend with a conditional write: **Redis** (`SET NX`) today; other Stash
drivers work but fall back to Stash's best-effort lock (see
[`docs/PARITY.md`](../../docs/PARITY.md) §12, §14).

### 2. Build the cache and read

```php
use Freshen\Cache;
use Freshen\CallableLoader;
use Freshen\DefaultJitter;
use Freshen\Key;

$loader = new CallableLoader(fn (Key $key) => expensiveQuery($key));

$cache = new Cache(
    $pool,
    $loader,
    hardTtlSec: 3600,       // absolute lifetime
    precomputeSec: 60,      // recompute in the last 60s before expiry (stampede-free)
    jitter: new DefaultJitter(15),
);

$key = new Key('product', 'top-sellers', ['category' => 456, 'brand' => 'Apple'], schemaVersion: '2', locale: 'en');

$result = $cache->get($key);          // fresh hit, stale-while-revalidate, or miss
if (!$result->isMiss()) {
    $value = $result->value();
    // $result->isStale() === true while a background recompute is in flight
}

$cache->put($key, $value);            // store a value explicitly
```

### 3. Invalidate & refresh (synchronous)

```php
use Freshen\SyncMode;

$cache->invalidate($key, SyncMode::SYNC);        // hierarchical: the key and its subtree
$cache->invalidateExact($key, SyncMode::SYNC);   // this exact key only (keeps children)
$cache->refresh($key, SyncMode::SYNC);           // recompute now via the loader, then store
```

### 4. Invalidate & refresh (asynchronous)

Invalidation and refresh default to `SyncMode::ASYNC`: instead of touching the
backend inline they emit a per-operation event through a
[PSR-14](https://www.php-fig.org/psr/psr-14/) event dispatcher, and a subscribed
`Freshen\AsyncHandler` performs the equivalent synchronous operation later. Each
operation has its own event class — `Freshen\InvalidateEvent`,
`Freshen\InvalidateExactEvent`, `Freshen\RefreshEvent` (all extend the abstract
`Freshen\AsyncEvent`) — so your listener provider routes each op to the right
handler by event class alone. Pass the dispatcher to the constructor:

```php
use Freshen\AsyncHandler;
use Freshen\InvalidateEvent;
use Freshen\InvalidateExactEvent;
use Freshen\RefreshEvent;

// $dispatcher is your PSR-14 EventDispatcherInterface (Symfony, League, …).
$cache = new Cache(
    $pool, $loader,
    hardTtlSec: 3600, precomputeSec: 60, jitter: new DefaultJitter(15),
    eventDispatcher: $dispatcher,
);

// In your app's event wiring, route each event class to its handler method:
$handler = new AsyncHandler($cache);
// $provider->addListener(InvalidateEvent::class,      [$handler, 'handleInvalidation']);
// $provider->addListener(InvalidateExactEvent::class, [$handler, 'handleInvalidateExact']);
// $provider->addListener(RefreshEvent::class,         [$handler, 'handleRefresh']);

$cache->invalidate($key);        // async (default): dispatches InvalidateEvent
$cache->invalidateExact($key);   // async (default): dispatches InvalidateExactEvent
$cache->refresh($key);           // async (default): dispatches RefreshEvent
```

Calling an async operation when no dispatcher was configured throws a
`LogicException`.

### Escape hatch & limitations

`$cache->asPool()` exposes the underlying Stash
[PSR-6](https://www.php-fig.org/psr/psr-6/) pool for advanced/host use. Note that
**whole-store clear is intentionally unsupported**: `$cache->asPool()->clear()` throws a
`RuntimeException`. Stash's pool-wide clear maps to Redis `FLUSHDB`, which wipes the entire
database — every key, not just cached ones — so Freshen does not expose it. Clear cached data
by key or prefix with `invalidate()` / `invalidateExact()` instead.

The cross-language behaviour contract is [`docs/PARITY.md`](../../docs/PARITY.md).

## Develop

Everything runs in Docker — nothing on the host.

```bash
composer install
composer test          # PHPUnit
scripts/php-test.sh    # full 8.1 → 8.4 matrix (from repo root)
```

## License

[MIT](../../LICENSE)
