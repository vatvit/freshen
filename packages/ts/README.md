# @vatvit/freshen (TS / JS)

> **Finally, full control over your caching — in one library.**

[![npm version](https://img.shields.io/npm/v/@vatvit/freshen)](https://www.npmjs.com/package/@vatvit/freshen)
[![node](https://img.shields.io/node/v/@vatvit/freshen)](https://www.npmjs.com/package/@vatvit/freshen)
[![License](https://img.shields.io/npm/l/@vatvit/freshen)](https://github.com/vatvit/freshen/blob/main/LICENSE)

Freshen brings together the caching pieces you normally wire up by hand: **single-flight**
recompute so exactly one worker rebuilds a hot key while everyone else is served the last
good value (**no cache-stampede**); **preemptive refresh** that recomputes an entry *before*
it goes stale, on TTLs and jitter you control; **structured keys** and **effective delete**
— genuinely evict one exact key or a whole prefix, atomically and in one round-trip;
**stale-if-error**, **negative caching**, **batch read + coalescing loader**, and a real
**two-level (in-memory L1 + Redis L2)** cache Node can actually exploit; all observable
through a **lifecycle-hook** pipeline with **metrics** built in. Wrap any expensive read — a
database query, an API call, a rendered fragment — and every cache-related decision is
explicit and yours.

TypeScript-first, ES2020, dual **ESM + CJS** build, **Node 16 → 22**, zero required
dependencies. This is the TS/JS port of the [PHP reference](https://github.com/vatvit/freshen);
behaviour matches the language-neutral contract in
[`docs/PARITY.md`](https://github.com/vatvit/freshen/blob/main/docs/PARITY.md).

## Features

- **Stale-while-revalidate** — serve the cached value instantly and recompute a fresh one
  in the background; reads never block on an expired entry.
- **Cache-stampede prevention** — single-flight leader/follower recompute plus jittered
  TTLs: one caller rebuilds while everyone else is served the current/stale value.
- **Structured, hierarchical keys** — `Key` is `domain / facet [ / schemaVersion ] [ / locale ]
  / id`, with schema **versioning**, **per-locale** variants, and canonicalised composite ids.
- **Effective delete** — evict one **exact** key, a whole **prefix** (`domain/facet/*`), or a
  **batch** — atomically, in a single Redis round-trip (a real delete, not a TTL bump).
- **Client-agnostic Redis driver** — atomic `SET NX` single-flight + exact/prefix/batch
  delete + `MGET`, over a tiny `RedisLike` port with **ioredis** *and* **node-redis** adapters
  (depend on neither; you inject a connected client).
- **Async invalidation & refresh** — non-blocking by default (events + handler); a bundled
  in-process `EventEmitter` binding, or wire a queue (BullMQ) for true off-process refresh.
- **Observability, hooks-native** — a lifecycle-hook pipeline with **metrics as a built-in
  subscriber**; fail-open, so a sink never breaks a read.
- **Two-level / LRU** — a bounded in-memory **L1** in front of **L2** Redis (a genuine
  long-lived-process win PHP can't have), read cascade + backfill, per-tier TTLs.
- **Resilience** — **stale-if-error** (serve last-good when the loader throws) with a retry
  circuit-breaker, and **negative caching** (briefly cache a not-found).
- **Batch** — `getMany` (one `MGET`) and a DataLoader-style **coalescing loader** (`WHERE id
  IN (…)`), with per-key single-flight preserved.
- **Pluggable serialization + compression** — a value codec seam (built-in gzip), or delegate
  to keyv's own compress/serialize hooks.

## Why not just use cachified / cacheable / cache-manager / keyv?

Those are good libraries — Freshen is honest about the overlap and the difference:

- **keyv** is a *storage* abstraction (one value per key over many backends). It has no
  single-flight, no precompute window, no hierarchical delete. Freshen **consumes** a keyv
  store (or its own) and adds the caching *logic* on top.
- **cache-manager / cacheable** give you tiered stores and wrap/TTL helpers, and **cachified**
  gives you a nice SWR + single-flight wrapper. None of them bundle Freshen's *union*:
  a **deterministic** precompute window (not probabilistic), **cluster-wide** single-flight
  via `SET NX`, **structured hierarchical keys** with atomic prefix-subtree delete,
  **metric-on-every-path**, **off-process** refresh, **stale-if-error + negative caching**
  sharing one decision point, *and* a real L1+L2 tier — behind a **2-line** common path.

If you only need "memoize with a TTL", reach for the smaller tool. If you keep re-inventing
the stampede/precompute/invalidation glue around it, that glue is what Freshen is.

## At a glance

The common case is two lines and you never touch the store, a stampede, or serialisation:

```ts
import { Cache, Key } from '@vatvit/freshen';

// One Cache = one dataset = one loader + its own TTLs. Default store is in-memory.
const topSellers = new Cache<Product[]>({
  loader: (key) => repo.topSellers(key.id()),   // your DB query / API call
  hardTtlSec: 3600,
  precomputeSec: 60,
});

const result = await topSellers.get(new Key('product', 'top-sellers', { category: 456 }));
return result.isMiss() ? [] : result.value();   // value() returns what the loader produced
```

On a miss the loader fills the cache and returns the value — no "check store → query → write
back" dance. `isMiss()` even tells a cached `null` apart from an absent entry.

## Install

```bash
npm install @vatvit/freshen
```

Zero required dependencies. For the Redis-backed strong guarantees, also install a client
(**peer dependency, your choice**): `npm install ioredis` **or** `npm install redis`.

## Usage

### 1. A cache is a domain object — one dataset, one loader

A `Cache` is **not a global bucket** — it wraps **one loader** (one dataset) with its own
TTLs. The loader is the heart of the library: Freshen calls it to (re)compute the
authoritative value for a key. **On a read you never write values yourself** — a `get()` on a
cold or due key invokes the loader and stores the result. Need another dataset? That's another
loader and another `Cache`.

```ts
import { Cache, Key } from '@vatvit/freshen';

const cache = new Cache<Product[]>({
  loader: (key) => repo.topSellers(key.id()),   // a Loader, or a bare (key) => value fn
  hardTtlSec: 3600,      // absolute lifetime — the entry is gone 3600s after write
  precomputeSec: 60,     // in the last 60s ONE caller recomputes early (stampede-free)
                         //   while others still read the current value
  // jitter, store, metrics, hooks, failOpen, graceSec, … all optional (see below)
});
```

A **`Key`** is a structured, immutable identity — `domain / facet [ / schemaVersion ] [ /
locale ] / id`. `domain` + `facet` form a **prefix** (a hierarchy), which is what makes
hierarchical invalidation work. The `id` may be a scalar **or a map** — maps are
**canonicalised** (deep key-sorted) so logically-equal inputs produce the same key regardless
of order, then serialised to a deterministic, separator-safe, **cross-language-stable** token
(byte-for-byte identical to the PHP port).

```ts
const key = new Key(
  'product',                         // domain — top-level namespace
  'top-sellers',                     // facet  — the view/query within it
  { category: 456, brand: 'Apple' }, // id     — scalar OR map (canonicalised)
  '2',                               // schemaVersion (optional) — bump to drop all old entries
  'en',                              // locale (optional)
);
```

Now just **read**:

```ts
const r = await cache.get(key);
if (!r.isMiss()) {          // a cached null is a real HIT — isMiss distinguishes it from "absent"
  const value = r.value();  // throws if you call it on a miss — guard with isMiss()/isHit()
  r.isStale();              // true while a background recompute is in flight
  r.createdAt();            // unix seconds the payload was created (null on miss)
  r.softExpiresAt();        // unix seconds the precompute window opens (null on miss)
}
```

### 2. Storage & locking — two independent strategies

Freshen has **two** pluggable collaborators, and they answer different questions:

- **`store`** — *where cached values live* (`read`/`write`/`delete…`). Default:
  `MemoryStore` (in-process, zero deps). Swap in `RedisDriver`, or `KeyvStore` over any
  [keyv](https://keyv.org) backend.
- **`lock`** — *how the stampede lock is coordinated* (single-flight leader election,
  `acquire`/`release`). Default: `InProcessLock`. Swap in `RedisLock` for a true
  cluster-wide lock.

They're separate because **cross-process single-flight fundamentally needs an atomic
conditional write** (Redis `SET NX`), which a plain store (keyv, in-memory) can't provide.
So you choose them independently:

| `store` | `lock` | Values | Stampede prevention | `getMany` (`MGET`) + atomic batch/prefix delete |
|---|---|---|---|---|
| `MemoryStore` (default) | `InProcessLock` (default) | this process | within this process | — |
| `KeyvStore` | `InProcessLock` | shared backend | **best-effort** (per-process) | degraded (N reads) |
| `KeyvStore` | `RedisLock` | shared backend | **cluster-wide** | degraded |
| `RedisDriver` | `RedisLock` | Redis | **cluster-wide** | full |

Single-flight strength follows **`lock`**; batch/atomic-delete follows **`store`** (the cache
feature-detects a driver store). Wire the Redis strategies from the same client:

```ts
import { Cache, RedisDriver, RedisLock, ioredisAdapter } from '@vatvit/freshen';
import Redis from 'ioredis';

const redis = ioredisAdapter(new Redis(process.env.REDIS_URL));
// (or nodeRedisAdapter(createClient(...)) — both support every command Freshen needs)

const cache = new Cache<Product[]>({
  loader: (key) => repo.topSellers(key.id()),
  hardTtlSec: 3600,
  precomputeSec: 60,
  store: new RedisDriver(redis),   // values + atomic deletes + MGET
  lock: new RedisLock(redis),      // cross-process single-flight (SET NX + fenced unlock)
});
```

### 2b. One shared store for many caches — `createFreshen`

A `Cache` is per-dataset, so an app has several. Set the shared store/lock/metrics **once**
and stamp out a cache per dataset (keys are namespaced by `domain`/`facet`, so one store holds
them all):

```ts
import { createFreshen, RedisDriver, RedisLock } from '@vatvit/freshen';

const freshen = createFreshen({
  store: new RedisDriver(redis),
  lock: new RedisLock(redis),
  metrics,
});

const topSellers = freshen.cache<Product[]>({ loader: loadTop, hardTtlSec: 3600, precomputeSec: 60 });
const categories = freshen.cache<Category[]>({ loader: loadCats, hardTtlSec: 600 });
// each inherits the shared store/lock/metrics; per-dataset TTLs & overrides still work
```

### 3. Invalidate & refresh

Three write-side operations plus a direct write. Each defaults to **async** (see §4); pass
`SyncMode.SYNC` to act inline:

```ts
import { SyncMode } from '@vatvit/freshen';

await cache.invalidate(key, SyncMode.SYNC);      // hierarchical: drop the key AND its subtree
await cache.invalidateExact(key, SyncMode.SYNC); // drop ONLY this key — children stay
await cache.refresh(key, SyncMode.SYNC);         // recompute now via the loader, then store
await cache.put(key, value);                     // store a value you ALREADY have — skips the loader
```

`invalidate` also accepts a bare `KeyPrefix` (clear a whole subtree), and all three accept a
**list** to act on many selectors in one call.

### 4. Async invalidation & refresh (the default)

By default the three ops emit a per-operation event instead of touching the backend inline; a
subscribed `AsyncHandler` performs the equivalent SYNC op later. The bundled
`InProcessAsyncDispatcher` wires it with a Node `EventEmitter`:

```ts
import { Cache, AsyncHandler, InProcessAsyncDispatcher } from '@vatvit/freshen';

const dispatcher = new InProcessAsyncDispatcher();
const cache = new Cache({ loader, hardTtlSec: 3600, precomputeSec: 60, dispatcher });
dispatcher.bind(new AsyncHandler(cache));

await cache.invalidate(key);   // async (default): dispatches, handler applies it off the call site
```

Each op has its own event class (`InvalidateEvent` / `InvalidateExactEvent` / `RefreshEvent`),
so one dispatcher routes them by type — a `refresh` and an `invalidate` on the *same* key never
cross. Calling an async op with no dispatcher throws.

**Off-process refresh (BullMQ).** For true off-request recompute, dispatch to a queue instead
of the in-process emitter — Freshen ships the event/handler objects and takes **no queue
dependency**:

```ts
import { Queue, Worker } from 'bullmq';

// Producer: an EventDispatcher that enqueues (dedupe by key via jobId).
const queue = new Queue('freshen');
const cache = new Cache({
  loader, hardTtlSec: 3600, precomputeSec: 60,
  dispatcher: {
    dispatch: (event) => {
      const key = (event as { key: { toString(): string } }).key.toString();
      void queue.add(event.constructor.name, { key }, { jobId: `${event.constructor.name}:${key}` });
    },
  },
});

// Worker (separate process): rebuild the SYNC op from the job and drive the cache.
new Worker('freshen', async (job) => {
  const key = rebuildKey(job.data.key);            // your Key ⇄ string mapping
  if (job.name === 'RefreshEvent') await cache.refresh(key, SyncMode.SYNC);
  else if (job.name === 'InvalidateExactEvent') await cache.invalidateExact(key, SyncMode.SYNC);
  else await cache.invalidate(key, SyncMode.SYNC);
});
```

### 5. Observability — hooks + metrics

Freshen is **hooks-native**: it fires a lifecycle event on every read/write path, and metrics
are just a built-in subscriber. Pass a `metrics` sink (parity metric names) and/or your own
hook listeners; both are fire-and-forget and **cannot break a read**.

```ts
const cache = new Cache({
  loader, hardTtlSec: 3600, precomputeSec: 60,
  metrics: { inc: (name, labels) => statsd.increment(name, labels), observe: () => {} },
  hooks: [(event) => log.debug('freshen', event)],
});
```

Emitted set: `cache_hit{state: fresh|stale|fresh_after_sleep|stale_on_error}`, `cache_fill`,
`cache_put`, `cache_miss{cause: …}`, `cache_invalidate`, `cache_invalidate_hierarchical`,
`cache_loader_error`.

### 6. Two-level cache (L1 in-memory + L2 Redis)

Node is long-lived, so an in-memory L1 in front of Redis is a real win. `tieredCache` composes
a bounded-LRU **L1** over a Redis **L2** — read cascade L1 → L2 → source with automatic L1
backfill, per-tier TTLs, and coherent invalidation across both tiers:

```ts
import { tieredCache, RedisDriver, RedisLock, ioredisAdapter } from '@vatvit/freshen';
import Redis from 'ioredis';

const redis = ioredisAdapter(new Redis());
const cache = tieredCache<Product[]>({
  loader: (key) => repo.topSellers(key.id()),         // the source (DB)
  l1: { max: 10_000, hardTtlSec: 5 },                 // bounded LRU; short TTL = coherence backstop
  l2: { store: new RedisDriver(redis), lock: new RedisLock(redis), hardTtlSec: 3600, precomputeSec: 60 },
});

await cache.get(key);                 // L1 → L2 → source, backfilling L1
await cache.invalidateExact(key);     // evicts BOTH tiers
```

Each process has its own L1: a short L1 TTL bounds cross-process staleness (a Redis pub/sub
eviction channel is a future option).

### 7. Resilience — stale-if-error & negative caching

Two options sharing one loader-outcome decision point:

```ts
import { NotFoundError } from '@vatvit/freshen';

const cache = new Cache({
  loader: async (key) => {
    const row = await db.find(key.id());
    if (!row) throw new NotFoundError();   // definitive not-found → negative caching
    return row;                            // a transient throw → stale-if-error serves last-good
  },
  hardTtlSec: 3600, precomputeSec: 60,
  staleIfError: true,          // (default) serve retained last-good when the loader throws
  staleIfErrorRetrySec: 10,    // circuit-breaker: don't re-hit the loader more than this often
  graceSec: 300,               // keep last-good 300s past hard expiry to serve it on error
  negativeTtlSec: 30,          // cache a not-found for 30s (0 = off)
});
```

A cached `null` stays a real HIT; a **negative** entry reads back as a MISS. A definitive
`NotFoundError` takes precedence over serving a stale positive.

### 8. Batch read & coalescing loader

```ts
import { CoalescingLoader } from '@vatvit/freshen';

// getMany: one MGET on Redis (N reads otherwise), order-preserving.
const results = await cache.getMany([k1, k2, k3]);

// loadMany: batch the miss→source trip. Wrap a BatchLoader; concurrent misses coalesce
// into ONE resolveMany (WHERE id IN (...)), per-key single-flight preserved.
const cache2 = new Cache({
  loader: new CoalescingLoader({
    resolve: (key) => db.find(key.id()),
    resolveMany: (keys) => db.findMany(keys.map((k) => k.id())),
  }),
  hardTtlSec: 3600,
});
```

### 9. Compression & custom serialization

Wrap the store with a value codec (built-in gzip), or delegate to keyv's own compress hooks:

```ts
import { withCodec, gzipJsonCodec, MemoryStore } from '@vatvit/freshen';

const store = withCodec(new MemoryStore(), gzipJsonCodec<Product[]>());
const cache = new Cache({ loader, hardTtlSec: 3600, store });
```

Compression applies to the value only — the envelope timestamps stay readable — and a decode
failure is treated as a miss (fail-open). On a keyv store you can instead use
`@keyv/compress-brotli` etc. and skip this seam.

### Escape hatch & limitations

`cache.asStore()` exposes the underlying store. **Whole-store flush is intentionally
unsupported** — clear by key or prefix. Redis values are JSON of the entry envelope, so stored
values must be JSON-serialisable (use a codec for anything else). The cross-language behaviour
contract is [`docs/PARITY.md`](https://github.com/vatvit/freshen/blob/main/docs/PARITY.md).

## Security

Run `npm audit` to check your install against the npm advisory database. Report vulnerabilities
privately via [GitHub Security Advisories](https://github.com/vatvit/freshen/security/advisories);
the full policy is in [SECURITY.md](https://github.com/vatvit/freshen/blob/main/SECURITY.md).

## Develop / contribute

Everything runs in **Docker** (nothing on the host) — from the repo root:

```bash
scripts/ts-dev.sh        # fast: lint + typecheck + tests
scripts/ts-test.sh       # full gate: build + coverage + Node 16→22 dist smoke
scripts/ts-redis-it.sh   # live-Redis integration lane (ioredis + node-redis)
```

## License

[MIT](./LICENSE)
