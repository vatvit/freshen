# Freshen (PHP)

[![Packagist Version](https://img.shields.io/packagist/v/vatvit/freshen-php)](https://packagist.org/packages/vatvit/freshen-php)
[![PHP Version](https://img.shields.io/packagist/php-v/vatvit/freshen-php)](https://packagist.org/packages/vatvit/freshen-php)
[![License](https://img.shields.io/packagist/l/vatvit/freshen-php)](https://github.com/vatvit/freshen/blob/main/LICENSE)

> **Security** — tracked by the [Packagist security advisory database](https://packagist.org/packages/vatvit/freshen-php); run `composer audit` to check your install. Report privately via [GitHub Security Advisories](https://github.com/vatvit/freshen/security/advisories); policy in [SECURITY.md](https://github.com/vatvit/freshen/blob/main/SECURITY.md).

PHP implementation of **Freshen** — a **stale-while-revalidate** cache with
**cache-stampede prevention** (single-flight leader/follower recompute + jittered
TTLs) and **built-in metrics**.

Runs natively on **PHP 8.1 → 8.4** (single source, no downgrade build). See
[`COMPATIBILITY.md`](../../COMPATIBILITY.md).

## Features

- **Stale-while-revalidate** — serve the cached value instantly and recompute a fresh one
  in the background; reads never block on an expired entry.
- **Cache-stampede prevention** — single-flight leader/follower recompute plus jittered
  TTLs: one worker rebuilds while everyone else is served the stale value (no thundering herd).
- **Async invalidation & refresh** — `invalidate()` / `refresh()` are non-blocking by
  default (PSR-14 events, handled off the call site); pass `SyncMode::SYNC` to run inline.
- **Structured, hierarchical keys** — `Freshen\Key` is `domain / facet [ / schemaVersion ]
  [ / locale ] / id`, with built-in schema **versioning** and **per-locale** variants.
- **Flexible invalidation** — drop one exact key, a whole **prefix** (`domain/facet/*`), or
  a **batch** of selectors in a single call/round-trip.
- **Redis-backed, PSR-6 core** — an atomic Redis driver (single-flight + exact/prefix
  delete) over a Stash PSR-6 pool; swap in any PSR-6 backend.
- **Built-in metrics & fail-open** — hit/miss/recompute metrics out of the box, and it
  serves through backend hiccups instead of failing the request.
- **Drop-in framework bridges** — first-class Symfony
  ([`vatvit/freshen-symfony`](https://packagist.org/packages/vatvit/freshen-symfony)) and
  Laravel ([`vatvit/freshen-laravel`](https://packagist.org/packages/vatvit/freshen-laravel))
  packages.
- **Modern, typed PHP** — native PHP 8.1 → 8.4 (single source, no downgrade build),
  PHPStan-max, MIT.

## At a glance

Once a cache is wired (a few lines — see [Usage](#usage)), reading is two lines and
you never touch the store, a stampede, or serialisation:

```php
use Freshen\Key;

$item = $topSellersCache->get(
    new Key('product', 'top-sellers', ['category' => 456, 'brand' => 'Apple'], locale: 'en'),
);

return $item->isMiss() ? [] : $item->value();   // value() returns what the loader produced — here, an array
```

On a miss, `$topSellersCache` calls your loader, stores the result, and returns it —
no "check store → query → write back" dance, no stampede handling. `value()` gives
back exactly what the loader returned (an array stays an array; Stash (de)serialises
for you), and `isMiss()` even tells a cached `null` apart from an absent entry.

> This directory is the source of truth. It is subtree-split by CI into a
> read-only mirror repository that Packagist serves.

## Install

> **Pre-1.0 — release candidate.** The public API may still change before `1.0.0`
> (see [`COMPATIBILITY.md`](../../COMPATIBILITY.md)). Until a stable tag ships,
> require the RC explicitly (Composer's default `minimum-stability` is `stable`, so
> a bare `require` won't resolve an RC):

```bash
composer require vatvit/freshen-php:^1.0@rc      # or a pinned :1.0.0-rc.2
```

Requires a [PSR-6](https://www.php-fig.org/psr/psr-6/) cache pool
([Stash](https://github.com/tedious/Stash)). `ext-redis` is *suggested* for a Redis
backend.

## Usage

### 1. Wire a backend

`Freshen\Cache` reads and writes through a [Stash](https://github.com/tedious/Stash)
pool. For the **full** guarantees (atomic single-flight recompute and **exact**,
non-hierarchical invalidation) use Freshen's Redis driver, `Freshen\Driver\Redis`,
in place of `Stash\Driver\Redis`. Two equivalent ways to build the pool:

```php
use Freshen\Driver\Redis as FreshenRedis;

// (a) reuse a \Redis client you already created — one shared connection app-wide
$pool = new \Stash\Pool(              // Stash\Pool: the PSR-6 backend Freshen reads/writes through
    new FreshenRedis([                // Freshen's Redis driver: adds atomic single-flight + exact delete
        'connection' => new \Redis(), //   your already-connected client — you own the socket
    ]),
);

// (b) …or hand the driver connection options and let it open the client for you
$pool = new \Stash\Pool(
    new FreshenRedis(['servers' => [['127.0.0.1', 6379]]]),   // standard Stash-Redis options
);
```

`$pool` is a plain **PSR-6** pool (`\Stash\Pool` implements
`Psr\Cache\CacheItemPoolInterface`) — Freshen *consumes* it, it isn't a Freshen
type; if you already cache with Stash it's the pool you already have. `Cache` wires
its own item class (`Freshen\Item`, for deterministic TTLs and exact delete) onto
the pool automatically — you don't set it yourself. Strong single-flight needs a
backend with a conditional write: **Redis** (`SET NX`) today; other Stash drivers
work but fall back to Stash's best-effort lock (see
[`docs/PARITY.md`](../../docs/PARITY.md) §12, §14).

### 2. Build a cache for one dataset, and read

A `Freshen\Cache` is **not a global cache** — it wraps **one loader**, i.e. one
dataset, with its own TTLs. The loader is the heart of the library: Freshen calls
it to (re)compute the authoritative value for a key (your DB query, an API call, a
heavy computation). **On a read you never write values yourself** — a `get()`
on a cold or due key invokes the loader and Freshen stores the result. That's the
whole point: *read, and the cache keeps itself fresh, stampede-free.*

Need another dataset (say, categories)? That's **another loader and another
`Cache`**, with its own TTLs — see [Framework integration](#framework-integration)
for the per-dataset wiring.

```php
use Freshen\Cache;
use Freshen\CallableLoader;
use Freshen\DefaultJitter;
use Freshen\Key;

// This loader IS the "top sellers" dataset — the source of truth for that value.
// CallableLoader adapts a plain `fn (Key) => mixed`; in an app you'd inject a Loader service.
$topSellers = new CallableLoader(fn (Key $key) => $repo->topSellers($key->id()));

$topSellersCache = new Cache(
    $pool,
    $topSellers,
    hardTtlSec: 3600,      // absolute lifetime — the entry is gone 3600s after it's written
    precomputeSec: 60,     // in the last 60s before expiry, ONE caller recomputes early
                           //   (stampede-free) while others still read the current value
    jitter: new DefaultJitter(15),   // spread each key's TTL by ±15% so sibling keys
                                     //   don't all expire at the same instant (a stampede cause)
);
```

A **`Key`** is a structured, immutable identity —
`domain / facet [ / schemaVersion ] [ / locale ] / id`:

```php
$key = new Key(
    'product',                                 // domain — top-level namespace for the entry
    'top-sellers',                             // facet  — the kind of thing within that domain
    ['category' => 456, 'brand' => 'Apple'],   // id     — a scalar OR a map; maps are canonicalised
                                               //          (key order doesn't matter → same key)
    schemaVersion: '2',                        // optional — bump on a value-shape change to
                                               //            invalidate every old entry at once
    locale: 'en',                              // optional — vary the cached entry per locale
);
```

**Why `domain` + `facet`?** Together they form the key's **prefix** — a hierarchy,
not just a namespace. `domain` is the bounded context / entity type (`product`,
`user`, `order`); `facet` is the specific view or query within it (`top-sellers`,
`profile`, `detail`). Grouping entries under a shared prefix is what makes
**hierarchical invalidation** work: `invalidate()` on a prefix drops *every* entry
beneath it in one call (e.g. clear all `product/top-sellers/*` variants at once),
while `invalidateExact()` removes just the single entry.

**Why the `id` can be complex (a map).** A cached value is usually a function of
*several* inputs — filters, pagination, options — not one scalar. Rather than make
you hand-build and normalise a string, `Key` takes the whole parameter map and
**canonicalises** it: keys are deep-sorted so logically-equal inputs produce the
*same* key regardless of order (`['brand' => 'Apple', 'category' => 456]` is the
same key as the example above), then serialised to a deterministic, separator-safe,
cross-language-stable token. So multi-dimensional keys stay correct and
collision-free with no effort on your side.

Now just **read**. On a miss the loader fills the cache; within the precompute
window one caller refreshes while the rest are served the current value; under a
recompute a follower is served the previous (stale) value — all automatic:

```php
$result = $topSellersCache->get($key);
if (!$result->isMiss()) {   // isMiss() distinguishes "no entry" from "entry whose value IS null":
                            //   a cached null is a real HIT, so a plain `$value === null` can't tell them apart
    $value = $result->value();
    // $result->isStale() === true while a background recompute is in flight
    $result->createdAt();       // unix seconds the payload was created (null on miss)
    $result->softExpiresAt();   // unix seconds the precompute window opens (null on miss)
}
```

`value()` throws a `RuntimeException` on a miss — guard with `isMiss()` (or
`isHit()` / `isStale()`) first.

> **To update an entry, pick by whether you already hold the value.** If you *don't*
> have it, drive the loader: `invalidate()` drops the entry (next `get()` recomputes)
> and `refresh()` recomputes it now (§3/§4). If you *already* have a fresh value — you
> just computed it, or a write path produced it — `put($key, $value)` stores it
> directly and **skips the loader**; using `refresh()` there would waste a recompute.

### A cache is a domain object — wrap it like a repository

This is the architectural intent of the class layout: a `Freshen\Cache` instance is
**the complete logic for one piece of business data** — how it's loaded (the loader),
how long it lives (TTLs), how it's refreshed and invalidated. It is *not* a generic
key-value bucket you reach into from everywhere.

You already do this for the database: raw SQL doesn't get sprinkled across the app,
it's wrapped in a `ProductRepository`. **Cached data is no different** — so isolate
each dataset behind a small business object that owns its cache and hides the keys:

```php
final class TopSellers                         // a domain object, like a repository
{
    public function __construct(private Cache $cache) {}   // its own per-dataset Freshen\Cache

    /** @return Product[] */
    public function forCategory(int $categoryId, string $locale): array
    {
        $r = $this->cache->get($this->key($categoryId, $locale));
        return $r->isMiss() ? [] : $r->value();
    }

    public function refresh(int $categoryId, string $locale): void
    {
        $this->cache->refresh($this->key($categoryId, $locale));   // recompute via the loader
    }

    private function key(int $categoryId, string $locale): Key
    {
        return new Key('product', 'top-sellers', ['category' => $categoryId], locale: $locale);
    }
}
```

Callers write `$topSellers->forCategory(456, 'en')` — they never touch a `Key`, a TTL,
or the word "cache". Each dataset (top sellers, categories, a user profile) is its own
such object with its own `Cache`, loader, and TTLs. **Split and isolate your cached
data**; treat it as the first-class domain concept it is.

### 3. Invalidate & refresh

Three write-side operations. Each defaults to **async** (§4); pass `SyncMode::SYNC`
to act inline against the backend:

```php
use Freshen\SyncMode;

$topSellersCache->invalidate($key, SyncMode::SYNC);      // hierarchical: drop the key AND its subtree
$topSellersCache->invalidateExact($key, SyncMode::SYNC); // drop ONLY this key — its subtree (children) stays
$topSellersCache->refresh($key, SyncMode::SYNC);         // recompute now via the loader, then store
$topSellersCache->put($key, $value);                     // store a value you ALREADY have — skips the loader (cheaper than refresh)
```

**Prefix selector.** `invalidate()` also accepts a `Freshen\Interface\KeyPrefixInterface`
— clear a whole subtree without a concrete `Key`:

```php
$topSellersCache->invalidate($prefix, SyncMode::SYNC);   // e.g. every product/top-sellers/* entry
```

**Batching.** All three accept a **list** to act on many selectors in one call:

```php
$topSellersCache->refresh([$key1, $key2], SyncMode::SYNC);
```

### 4. Invalidate & refresh — asynchronous (the default)

`invalidate()` / `invalidateExact()` / `refresh()` default to `SyncMode::ASYNC`:
instead of touching the backend inline they emit a per-operation event through a
[PSR-14](https://www.php-fig.org/psr/psr-14/) dispatcher, and a subscribed
`Freshen\AsyncHandler` performs the equivalent **SYNC** operation later. Each
operation has its own event class — `Freshen\InvalidateEvent`,
`Freshen\InvalidateExactEvent`, `Freshen\RefreshEvent` (all extend the abstract
`Freshen\AsyncEvent`) — so a listener provider routes each op to the right handler
by event class alone. Give the cache a dispatcher, then wire the handler:

```php
use Freshen\AsyncHandler;
use Freshen\InvalidateEvent;
use Freshen\InvalidateExactEvent;
use Freshen\RefreshEvent;

// build the same cache WITH a PSR-14 dispatcher (Symfony's, League's, …)
$topSellersCache = new Cache(
    $pool, $topSellers,
    hardTtlSec: 3600, precomputeSec: 60, jitter: new DefaultJitter(15),
    eventDispatcher: $dispatcher,
);

// register each event class with its handler method.
// `addListener` here is illustrative — the exact call belongs to YOUR PSR-14
// listener provider (Symfony's, League's, etc.); the routing idea is the same.
$handler = new AsyncHandler($topSellersCache);
$provider->addListener(InvalidateEvent::class,      [$handler, 'handleInvalidation']);
$provider->addListener(InvalidateExactEvent::class, [$handler, 'handleInvalidateExact']);
$provider->addListener(RefreshEvent::class,         [$handler, 'handleRefresh']);

// then, from your request path, fire-and-forget:
$topSellersCache->invalidate($key);        // async (default): dispatches InvalidateEvent
$topSellersCache->invalidateExact($key);   // async (default): dispatches InvalidateExactEvent
$topSellersCache->refresh($key);           // async (default): dispatches RefreshEvent
```

Calling an async operation when no dispatcher was configured throws a
`LogicException`.

### 5. Observability — metrics, built in

Freshen emits a **named metric on every read/write path**, so hit / stale / fill /
miss / invalidate visibility is built in, not bolted on. Implement `MetricsInterface`
to forward them to StatsD, Prometheus, your logger — anything. No sink? Metrics are
simply off, at zero cost.

```php
use Freshen\Interface\MetricsInterface;

$topSellersCache = new Cache(
    $pool, $topSellers,
    hardTtlSec: 3600, precomputeSec: 60, jitter: new DefaultJitter(15),
    metrics: $metrics,   // your MetricsInterface: inc(name, labels) / observe(name, value, labels)
);
```

Emitted set: `cache_hit{state: fresh|stale|fresh_after_sleep}`, `cache_fill`,
`cache_put`, `cache_miss{cause: …}`, `cache_invalidate`,
`cache_invalidate_hierarchical`. Fire-and-forget — a sink **must not** throw into
the cache path. See [`docs/PARITY.md`](../../docs/PARITY.md) §10.

### 6. Fail-open

`failOpen` (constructor, default `true`) is the last-resort behaviour under
contention when there is no value to serve: `true` recomputes via the loader and
returns it **without caching** (a `HIT`) — availability over a cold store; `false`
returns a `MISS` instead. See [`docs/PARITY.md`](../../docs/PARITY.md) §7.

```php
$topSellersCache = new Cache(
    $pool, $topSellers,
    hardTtlSec: 3600, precomputeSec: 60, jitter: new DefaultJitter(15),
    failOpen: false,     // prefer an explicit MISS over an uncached recompute
);
```

### How it wires into your app (PSR + DI)

Freshen ships **no framework of its own** — it's a small core that plugs into
standards you already use, so wire it like any other service:

- **Backend** — a **PSR-6** pool (Stash). Freshen consumes the pool you hand it; it
  bundles no store and forces no cache abstraction on you.
- **`Loader`, `Jitter`, `Metrics`** — plain interfaces
  (`Freshen\Interface\{LoaderInterface, JitterInterface, MetricsInterface}`).
  `CallableLoader` and `DefaultJitter` are bundled *defaults* for a quick start; in a
  real app you implement (or bind) these and **inject them via your DI container**
  like anything else. The constructor takes the interfaces, never a concrete.
- **Async events & handler** — `AsyncEvent` / `InvalidateEvent` /
  `InvalidateExactEvent` / `RefreshEvent` and `AsyncHandler` are plain PHP objects
  with **no dispatcher of their own**. They travel through **any PSR-14
  `EventDispatcherInterface`** — Symfony's, League's, your framework's — so Freshen
  reuses your existing event bus instead of shipping one. The one hard rule: async
  ops need *a* dispatcher wired in (else `LogicException`).

## Framework integration

**Use a bridge — `composer require` and you're done.** Drop-in packages wire the pool,
loader, jitter and async listeners from declarative config so you don't hand-wire
anything:

| Framework | Package | Docs |
|-----------|---------|------|
| Symfony `^6.4 \|\| ^7.0` | [`vatvit/freshen-symfony`](https://packagist.org/packages/vatvit/freshen-symfony) | [bridge README](../symfony/README.md) |
| Laravel `^11 \|\| ^12` (PHP 8.2+) | [`vatvit/freshen-laravel`](https://packagist.org/packages/vatvit/freshen-laravel) | [bridge README](../laravel/README.md) |

Three principles hold whichever path you take: (1) Freshen needs a **Stash** pool (not the
framework's own PSR-6 pool); (2) async needs a **PSR-14** dispatcher — **Symfony's is**
PSR-14, **Laravel's is not** (its bridge ships a PSR-14 adapter + queue); and (3) **a
`Cache` is per-dataset** — one loader, its own TTLs. A second dataset is a second loader +
a second cache, each with its own config.

If you're **not** on those frameworks (or want to wire it by hand), see
[Manual wiring](#manual-wiring) below.

### Manual wiring

On Symfony or Laravel, prefer the **bridge** (above) — it does all of this for you. Wire it
by hand only for another framework, a plain PSR-6 setup, or full control. A `Cache` composes
four things; build them as shared services and inject a cache **per dataset**:

```php
use Freshen\{Cache, DefaultJitter, SyncMode};
use Freshen\Driver\Redis as FreshenRedis;

// shared backend — build ONCE, reuse for every cache (don't rebuild the pool per dataset)
$pool   = new \Stash\Pool(new FreshenRedis(['connection' => $redis]));  // $redis: a connected \Redis
$jitter = new DefaultJitter(15);                                        // TTL jitter percent

// one cache PER dataset: its own loader (implements Freshen\Interface\LoaderInterface) + TTLs
$topSellers = new Cache(
    $pool,
    $topSellersLoader,        // your LoaderInterface for THIS dataset
    hardTtlSec: 3600,
    precomputeSec: 60,        // soft window before hard TTL
    jitter: $jitter,
    eventDispatcher: $psr14,  // a PSR-14 dispatcher for async; omit → drive with SyncMode::SYNC
);

$topSellers->get($key);
$topSellers->refresh($key, SyncMode::SYNC);   // no dispatcher? use SYNC; else async is the default
```

For async invalidation, register one `Freshen\AsyncHandler($cache)` per cache on a PSR-14
dispatcher, routing each event class to its method (`InvalidateEvent → handleInvalidation`,
`InvalidateExactEvent → handleInvalidateExact`, `RefreshEvent → handleRefresh`). **Symfony's
`event_dispatcher` is PSR-14; Laravel's is not** — which is exactly what the bridges handle
(Symfony natively, Laravel via a PSR-14 adapter + queue). A second dataset is a second
loader + a second `Cache` reusing the same shared pool.

## Escape hatch & limitations

`$cache->asPool()` exposes the underlying Stash
[PSR-6](https://www.php-fig.org/psr/psr-6/) pool for advanced/host use. Note that
**whole-store clear is intentionally unsupported**: `$cache->asPool()->clear()` throws a
`RuntimeException`. Stash's pool-wide clear maps to Redis `FLUSHDB`, which wipes the entire
database — every key, not just cached ones — so Freshen does not expose it. Clear cached data
by key or prefix with `invalidate()` / `invalidateExact()` instead.

The cross-language behaviour contract is [`docs/PARITY.md`](../../docs/PARITY.md).

## Develop / contribute

The test and quality tooling runs across the full PHP version matrix in **Docker**
(each script spins up the right container) — install Docker, then from the repo root:

```bash
scripts/php-test.sh       # PHPUnit + PHPStan (level max) across PHP 8.1 → 8.4
scripts/php-coverage.sh   # unit coverage + floor gate
scripts/php-redis-it.sh   # live-Redis integration lane
```

If you have PHP 8.1+ and Composer locally, you can also run the suite directly
inside `packages/php`:

```bash
composer install && composer test
```

## License

[MIT](../../LICENSE)
