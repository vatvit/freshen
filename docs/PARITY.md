# freshen — Parity Contract

This is the **language-neutral feature specification** for `freshen`. It defines
the behaviour and observable API that *every* language package must implement
identically. It is the source of truth for cross-language **parity**: the PHP
package (`packages/php`) is the reference implementation, and the TS/JS package
(`packages/ts`) is built to satisfy this document.

- **Audience:** implementers of a language port and reviewers checking parity.
- **Scope:** *behaviour and observable API*, not any one language's syntax. Where a
  mechanism is described in host-specific terms (PSR-6, Stash, a PSR-14 event
  dispatcher), the **required behaviour** is normative and the host mechanism is
  one valid *binding* — see [§12](#12-backend-contract) and
  [§14](#14-php-binding-notes).
- **Conformance keywords:** **MUST**, **MUST NOT**, **SHOULD**, **MAY** as in
  RFC 2119.
- **Versioning:** this contract is covered by [`COMPATIBILITY.md`](../COMPATIBILITY.md).
  Behaviour described here is public API; the carve-outs in [§13](#13-what-is-not-contract)
  are not.

> **Reference:** the normative source is `packages/php/src`. Any disagreement
> between this document and that code is a defect in one of them; the
> discrepancies known at authoring time are listed in [§13](#13-what-is-not-contract).

---

## 1. Purpose

`freshen` is a **stale-while-revalidate (SWR)** cache with **stampede
prevention**. On a read it serves a fresh cached value when one exists; when the
value is due for recomputation it elects a **single** caller (the *leader*) to
recompute while every other caller (a *follower*) is served the previous value or
briefly waits — so a hot key is never recomputed by a thundering herd. TTLs are
**jittered** per key so unrelated keys do not all expire at once.

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **Hard TTL** | Absolute lifetime of a cached entry, in seconds. After it, the entry is gone. |
| **Precompute window** | The last `precomputeSec` seconds before hard expiry, during which a recompute is proactively triggered. |
| **Soft expiry** | `hardExpiresAt − precomputeSec`. The instant the precompute window opens. |
| **Fresh** | A value read before soft expiry (or after, if this caller was not the one elected to recompute and the entry has not hard-expired). |
| **Leader** | The single caller that wins the recompute lock and recomputes the value. |
| **Follower** | A caller that did not win the lock while a leader is recomputing. |
| **Single-flight** | Guarantee that at most one leader recomputes a given key at a time. |
| **Fail-open** | Under contention with no value to serve, compute the value directly (bypassing the cache) rather than failing. |

---

## 3. Public API surface

Types are given in language-neutral notation: `name: Type`, `?T` = nullable,
`A | B` = union, `T[]` = list of `T`, `mixed` = any value. Defaults follow `=`.

### 3.1 `Cache` — the entry point

Constructor parameters, in order:

| # | Param | Type | Default | Notes |
|---|-------|------|---------|-------|
| 1 | `pool` | backend pool | — | storage backend (see [§12](#12-backend-contract)) |
| 2 | `loader` | `Loader` | — | recomputes a value for a key ([§3.5](#35-extension-interfaces)) |
| 3 | `hardTtlSec` | `int` | — | MUST be `≥ 1` |
| 4 | `precomputeSec` | `int` | — | MUST be in `[0, hardTtlSec]` |
| 5 | `jitter` | `Jitter` | — | TTL jitter strategy ([§9](#9-jitter)) |
| 6 | `eventDispatcher` | `?EventDispatcher` | `null` | required only for async ops ([§11](#11-async-model)) |
| 7 | `metrics` | `?Metrics` | `null` | optional observability sink ([§10](#10-observability-metrics)) |
| 8 | `failOpen` | `bool` | `true` | last-resort behaviour ([§7](#7-the-read-state-machine-get)) |

Methods:

| Method | Signature | Purpose |
|--------|-----------|---------|
| `get` | `get(key: Key): ValueResult` | SWR read ([§7](#7-the-read-state-machine-get)) |
| `put` | `put(key: Key, value: mixed): void` | Write/overwrite a value with a fresh (jittered) hard TTL |
| `invalidate` | `invalidate(selectors: KeyPrefix \| Key \| (KeyPrefix\|Key)[], mode = ASYNC): void` | **Hierarchical** delete by prefix ([§8](#8-invalidation--refresh)) |
| `invalidateExact` | `invalidateExact(keys: Key \| Key[], mode = ASYNC): void` | **Exact-key** delete ([§8](#8-invalidation--refresh)) |
| `refresh` | `refresh(keys: Key \| Key[], mode = ASYNC): void` | Recompute and store now ([§8](#8-invalidation--refresh)) |
| `asPool` | `asPool(): Psr6Pool` | Escape hatch: the raw backend pool ([§12](#12-backend-contract)) |

`mode` is a `SyncMode` ([§3.4](#34-enums)); it **defaults to `ASYNC`** on all three
mutating methods.

### 3.2 `Key`

An immutable structured cache key. See [§6](#6-key-model) for the full model.

Constructor: `Key(domain: string, facet: string, id: string | int | (string|int|array)[map], schemaVersion: ?string = null, locale: ?string = null)`

Accessors (all pure, no side effects):

| Accessor | Returns | Meaning |
|----------|---------|---------|
| `toString` / string coercion | `string` | storage-ready key: `prefix/idString` |
| `domain` | `string` | |
| `facet` | `string` | |
| `schemaVersion` | `?string` | `null` when not set |
| `locale` | `?string` | `null` when not set |
| `id` | `string \| map` | original id as provided (arrays canonicalised) |
| `idString` | `string` | deterministic, separator-safe id |
| `prefixString` | `string` | encoded `domain/facet[/schema][/locale]` |
| `segments` | `string[]` | `[domain, facet, (schema), (locale), idString]` |
| `prefixSegments` | `string[]` | `[domain, facet, (schema), (locale)]` |

### 3.3 `ValueResult`

Immutable read result. See [§7.2](#72-value-result--time-model).

| Member | Signature | Meaning |
|--------|-----------|---------|
| `isHit` | `(): bool` | value present and fresh |
| `isStale` | `(): bool` | value present but past soft expiry |
| `isMiss` | `(): bool` | no value |
| `value` | `(): mixed` | the value; **MUST throw** if `isMiss` |
| `createdAt` | `(): ?int` | unix seconds the payload was created; `null` on miss |
| `softExpiresAt` | `(): ?int` | unix seconds of soft expiry; `null` on miss |

### 3.4 Enums

- `CacheReadState` = `HIT` | `STALE` | `MISS`.
- `SyncMode` = `SYNC` | `ASYNC`.

### 3.5 Extension interfaces

Consumers plug in behaviour by implementing:

| Interface | Method(s) | Contract |
|-----------|-----------|----------|
| `Loader` | `resolve(key: Key): mixed` | Produce the authoritative value for a key. MAY be slow; MUST be side-effect-safe to call from a leader or a fail-open path. |
| `Jitter` | `apply(ttlSec: int, key: Key): int` | Return an adjusted TTL. MUST be `≥ 1`. SHOULD be deterministic per key ([§9](#9-jitter)). |
| `Metrics` | `inc(name: string, labels: map = {})`, `observe(name: string, value: float, labels: map = {})` | Fire-and-forget counters/observations. MUST NOT throw into the cache path. |
| `KeyPrefix` | `segments(): string[]`, `toString(): string` | A hierarchical selector for invalidation ([§8](#8-invalidation--refresh)). A `Key` also satisfies prefix selection. |

Bundled default implementations that a port SHOULD provide equivalents of:

- **CallableLoader** — adapts a plain function `(Key) => mixed` to `Loader`.
- **DefaultJitter** — the deterministic jitter of [§9](#9-jitter) (default 15%).

---

## 4. Configuration & validation

At construction the cache **MUST** validate:

- `hardTtlSec ≥ 1` — else raise an *invalid-argument* error.
- `0 ≤ precomputeSec ≤ hardTtlSec` — else raise an *invalid-argument* error.

Defaults: `eventDispatcher = null`, `metrics = null`, `failOpen = true`,
`DefaultJitter` percent `= 15`.

`precomputeSec = 0` disables the precompute window (soft expiry equals hard
expiry). `precomputeSec = hardTtlSec` opens the window immediately on write.

---

## 5. Data & time model overview

All timestamps are **unix seconds**. For a stored entry the backend tracks a
**creation** time and an **expiration** time (= creation + the jittered hard TTL).
Derived values:

```
hardExpiresAt = creation + jitteredHardTtl
softExpiresAt = hardExpiresAt − precomputeSec         (floored to ≥ creation)
```

The soft boundary is never earlier than creation: if `precomputeSec` exceeds the
remaining lifetime the entry is considered already in its precompute window.

---

## 6. Key model

A key is `domain / facet [ / schemaVersion ] [ / locale ] / idString`.

**Segment rules:**

- `domain` and `facet` are trimmed; an empty segment (after trim) **MUST** raise an
  *invalid-argument* error.
- `schemaVersion` and `locale` are optional. An empty string is treated as *unset*
  (normalised to `null`) — it MUST NOT appear as a segment.
- Present optional segments appear in fixed order: `schemaVersion` before `locale`.

**Id normalisation:**

- A scalar id (`string`/`int`) is used as-is for `idString` (int coerced to its
  decimal string). `id()` returns the original scalar as a string.
- A **map/array id** is *canonicalised*: keys sorted (recursively, deep) so that
  logically equal maps produce identical keys regardless of insertion order. The
  canonical map is then serialised to a deterministic, separator-safe token:
  - Default scheme: canonical JSON (unescaped unicode & slashes) → base64url
    (no padding) → prefixed with `j:`. Example marker: `idString = "j:<base64url>"`.
  - This token is **stable and deterministic** but **not required to be
    reversible**. A port MUST produce the *same* token as PHP for the same input
    so keys match across languages.

**Encoding:** each *prefix* segment is percent-encoded (RFC 3986 `rawurlencode`
semantics) and joined with `/`. The full key is `prefixString + "/" +
rawurlencode(idString)`.

**Extensibility:** the map-id → token scheme is an override point (PHP exposes a
protected `idStringify`). A port SHOULD offer an equivalent hook. Overriding it
changes the on-the-wire key and is therefore a consumer decision, not a parity
concern — but the **default** scheme above IS parity.

---

## 7. The read state machine (`get`)

`get(key)` evaluates the following tiers **in order** and returns from the first
that produces a result. This ordering is normative.

| # | Tier | Precondition | Returns | Metric |
|---|------|-------------|---------|--------|
| 1 | **Fresh hit** | An entry exists and this caller is served it as fresh (present, not elected for precompute recompute, not hard-expired) | `HIT` | `cache_hit{state: fresh}` |
| 2 | **Leader** | No fresh hit **and** this caller wins the single-flight recompute lock | recompute via `loader`, store it, then `HIT` | `cache_fill` |
| 3 | **Follower — serve stale** | Lost the lock **and** a previous value exists | that previous value as `STALE` | `cache_hit{state: stale}` |
| 4 | **Follower — wait for fresh** | Lost the lock, no stale value, but the leader finishes within the bounded wait (~900 ms; see below) | leader's fresh value as `HIT` | `cache_hit{state: fresh_after_sleep}` |
| 5a | **Fail-open** (`failOpen = true`) | None of the above | recompute via `loader`, return it as `HIT` **without storing it** | `cache_miss{cause: precompute_race}` |
| 5b | **Fail-closed** (`failOpen = false`) | None of the above | `MISS` | `cache_miss{cause: precompute_race_fail_closed}` |

Notes that are part of the contract:

- **Single-flight (tier 2):** at most one caller per key recomputes at a time. The
  lock MUST be released when the leader finishes (including on error).
- **Precompute election (tier 1 vs 2):** during the precompute window the cache
  triggers *early* recompute by treating the entry as due for **one** caller (who
  becomes the leader) while others still see a fresh hit. Implementations MAY
  realise this election differently as long as the observable effect holds: within
  the precompute window exactly one caller recomputes and the rest are served
  without blocking.
- **Bounded wait (tier 4):** the follower waits for the leader up to a bounded time
  — the reference is **6 polls × 150 ms ≈ 900 ms** maximum. The exact granularity
  is *not* contract (see [§13](#13-what-is-not-contract)); the *bounded, sub-second*
  nature is.
- **Fail-open value (tier 5a):** the returned value is freshly computed but **not
  cached**. Its result state is **`HIT`** (a usable value), even though it did not
  come from and was not written to the store. `createdAt`/`softExpiresAt` are
  computed as if it had just been created.

### 7.1 Post-write time stamps

On tiers 2 and 5a the result's `createdAt = now`, `softExpiresAt = max(now,
(now + hardTtlSec) − precomputeSec)` — computed from the *nominal* `hardTtlSec`
(not the jittered stored TTL), so the caller sees a consistent soft boundary.

### 7.2 Value result & time model

`ValueResult` carries `state ∈ {HIT, STALE, MISS}`, an optional value, and the two
timestamps of [§5](#5-data--time-model-overview). `value()` on a `MISS` **MUST**
raise a runtime error rather than return a sentinel. On `MISS` both timestamps are
`null`.

---

## 8. Invalidation & refresh

Three mutating operations, each accepting a single selector **or a list**, and a
`SyncMode` that **defaults to `ASYNC`**:

| Operation | Selector type | Effect |
|-----------|---------------|--------|
| `invalidate` | `KeyPrefix` \| `Key` (or list) | **Hierarchical** delete: removes everything under the prefix (a `Key` used here selects its whole subtree). |
| `invalidateExact` | `Key` (or list) | **Exact** delete: removes only that key, leaving hierarchical neighbours intact. |
| `refresh` | `Key` (or list) | Recompute via `loader` and `put` the result now. |

**Sync path (`mode = SYNC`):** perform the operation immediately against the
backend and emit the corresponding metric (`cache_invalidate_hierarchical`,
`cache_invalidate`, or — for refresh — `cache_put` via the underlying `put`).

**Async path (`mode = ASYNC`):** emit an event describing the operation (see
[§11](#11-async-model)) instead of touching the backend inline; a subscribed
handler performs the equivalent **SYNC** operation later. Async **MUST** degrade to
exactly the same observable effect as SYNC — only the *timing* differs.

For a **list** selector, every element MUST be processed (each dispatched in async
mode, each applied in sync mode).

---

## 9. Jitter

Jitter spreads TTLs so sibling keys do not co-expire (a stampede cause). It is
applied to the **hard TTL at write time** (`put`, and the leader's store); the
value returned to callers uses the *nominal* TTL for its soft boundary
([§7.1](#71-post-write-time-stamps)).

**DefaultJitter** (the parity default, `percent = 15`):

```
δ      = floor(ttlSec × percent / 100)
if δ == 0:  return max(1, ttlSec)
offset = (crc32(key.toString()) mod (2δ + 1)) − δ        // integer, in [−δ, +δ]
return max(1, ttlSec + offset)
```

Properties a port MUST preserve: **deterministic per key** (same key ⇒ same TTL),
symmetric range `[−δ, +δ]`, result floored to `≥ 1`. The specific hash (CRC-32 of
the storage key string) is part of the default so ports jitter identically.

---

## 10. Observability (metrics)

When a `Metrics` sink is provided, the cache emits the following. The **names and
label keys are the parity target**; a port MUST emit the same set at the same
points. (Metrics are best-effort: a missing sink disables them; an emitting sink
MUST NOT affect cache behaviour.)

| Metric | Labels | Emitted when |
|--------|--------|--------------|
| `cache_hit` | `state: fresh` | tier 1 fresh hit |
| `cache_hit` | `state: stale` | tier 3 follower-stale |
| `cache_hit` | `state: fresh_after_sleep` | tier 4 follower-wait resolved |
| `cache_fill` | — | tier 2 leader stored a value |
| `cache_put` | — | `put` (and thus `refresh`) stored a value |
| `cache_miss` | `cause: precompute_race` | tier 5a fail-open |
| `cache_miss` | `cause: precompute_race_fail_closed` | tier 5b fail-closed |
| `cache_invalidate` | — | sync exact invalidation |
| `cache_invalidate_hierarchical` | — | sync hierarchical invalidation |

`observe` is part of the `Metrics` interface for consumers but is not emitted by
the core paths above.

---

## 11. Async model

Async invalidation/refresh decouples the request path from backend work:

1. The mutating method emits a single **event** carrying the selector and a flag
   distinguishing *exact* from *hierarchical* (refresh reuses the same event
   shape). Fields: `key` (the selector), `exact: bool`.
2. A **handler** subscribed to that event performs the equivalent **SYNC**
   operation: `handleInvalidation` routes to `invalidateExact` (when `exact`) or
   `invalidate` (hierarchical); `handleRefresh` routes to `refresh`.
3. Async mode **requires** an event dispatcher. If a mutating method is called with
   `mode = ASYNC` and no dispatcher was configured, it **MUST** raise a
   *logic/illegal-state* error (it MUST NOT silently no-op).

The wiring of events→handlers (which handler a given event triggers) is a
deployment concern of the host application, not of the library.

---

## 12. Backend contract

The store is pluggable. Whatever a port uses, the backend **MUST** provide:

1. **Get with creation & expiration timestamps** for an entry (to derive soft
   expiry, [§5](#5-data--time-model-overview)).
2. **Write with a TTL** (`expiresAfter` semantics).
3. **Single-flight lock** per key: a caller can atomically attempt to become the
   sole recomputer; the lock frees when that caller completes (tier 2).
4. **Serve-previous-on-lock**: while a key is locked by a leader, another caller can
   read the *previous* value (tier 3).
5. **Bounded wait-for-fresh**: a caller can wait a bounded time for the leader's new
   value, then give up (tier 4).
6. **Hierarchical + exact delete** by selector (§8).

In PHP these map onto a **PSR-6 pool with Stash invalidation strategies**
(`PRECOMPUTE`, `OLD`, `SLEEP`) — see [§14](#14-php-binding-notes). A port MAY
implement them by any equivalent means. `asPool()` exposes the raw PSR-6 pool for
advanced/host use; an equivalent escape hatch in another language is OPTIONAL and
**not** parity.

**The library ships no backend of its own.** The PHP core is agnostic over any
PSR-6/Stash pool the host injects; it bundles no concrete store, and no Redis (or
other) backend is wired into the cache. A port SHOULD ship at least one built-in
backend so the library is usable and unit-testable out of the box (an in-memory
reference backend satisfies all six requirements deterministically); additional
backends (Redis, etc.) are host- or adapter-supplied, **not** a parity requirement.

**Exact vs hierarchical delete** (requirement 6) is genuine contract: a port MUST
delete *only* the named key on `invalidateExact` and the *whole subtree* on
`invalidate`. Note the PHP realisation gates exact-delete behind a driver-level
extension (see [§14](#14-php-binding-notes)); a port MUST implement true exact
delete regardless of how its backend layers it.

---

## 13. What is NOT contract

Per [`COMPATIBILITY.md`](../COMPATIBILITY.md), the following MAY differ across
languages/versions without breaking parity:

- **Exact wording** of error/exception messages and log/metric-free diagnostics.
- **Internal symbols** (anything a language marks internal/private) and the exact
  class/file layout.
- **Sleep/poll granularity** of the follower wait (§7 tier 4) — only its *bounded,
  sub-second* nature is contract, not `6 × 150 ms`.
- **Concrete exception/error class identity** — the *category* (invalid-argument,
  runtime "no value on miss", logic "async without dispatcher") is contract; the
  exact type name is the host's.
- **The `asPool` escape hatch** and any host-specific backend accessor.
- **Reversibility/exact bytes of a custom `idString` scheme** when a consumer
  overrides the default hook — the *default* scheme ([§6](#6-key-model)) IS parity.

---

## 14. PHP binding notes (informative)

How the reference package realises the contract — useful when reading
`packages/php/src`, **not** normative for other languages:

- **Backend:** a host-supplied `Stash\Pool` (PSR-6) — the cache bundles no store
  itself. The follower/leader *read* behaviours use Stash invalidation methods:
  `PRECOMPUTE` (tier 1 election), `OLD` (tier 3 serve previous), `SLEEP(150ms, 6)`
  (tier 4 bounded wait). Single-flight is `Item::lock()`.
- **Stock Stash does not satisfy the backend contract on its own — two corrective
  helpers are required:**
  - **Atomic single-flight (§12 req 3):** `Item::lock()` delegates to
    `driver->storeData()`, which on the stock Redis driver is an *unconditional*
    `SET` — every concurrent caller "wins", so there is no real single-flight.
    **`Freshen\Driver\Redis`** overrides `storeData` to use **`SET … NX EX`** for the
    stampede (`sp`) keys, so exactly one caller wins the lock. This is not optional:
    without it, tier 2 offers no stampede protection on a cold key.
  - **Exact delete (§12 req 6, §8):** stock `Driver::clear($key)` always increments
    the hierarchy path-index (invalidating **all** children) — it is inherently
    *hierarchical*, with no exact-only mode. **`Freshen\Driver\Redis::clear($key, true)`**
    deletes the item **without** bumping the index, and **`Freshen\Item`** routes
    `clear($exact)` to it. Without these, `invalidateExact` degrades to a
    hierarchical clear.
  So `Freshen\Driver\Redis` / `Freshen\Item` are **corrective backend code, not optional
  add-ons** — they encode the §12 requirements that stock Stash misses. The host wires the
  driver (`new \Stash\Pool(new \Freshen\Driver\Redis(...))`); `Cache` wires `Freshen\Item`
  onto the pool itself. A port's backend MUST provide both behaviours natively (an in-memory
  reference backend can do so directly).
- **Deterministic TTL.** Stash's `Item::executeSet` would subtract a further **random**
  `0…15%` from every stored TTL on top of Freshen's deterministic `DefaultJitter`.
  `Freshen\Item` overrides `executeSet` to drop that random block, so the stored expiry is
  deterministic (same key ⇒ same TTL, per [§9](#9-jitter)). A port with no Stash beneath it
  implements only the single deterministic jitter of §9.
- **Events:** PSR-14 `EventDispatcherInterface`; `AsyncEvent{key, exact}` +
  `AsyncHandler{handleInvalidation, handleRefresh}`.
- **Types:** `CacheReadState`/`SyncMode` are native enums; `ValueResult` is
  immutable with `hit`/`stale`/`miss` factories; `Key` implements `Stringable`.
- **Errors:** `InvalidArgumentException` (config/empty segment), `RuntimeException`
  (`value()` on miss), `LogicException` (async without dispatcher).
- **Runtimes:** single source, PHP 8.1 → 8.4 (see
  [`COMPATIBILITY.md`](../COMPATIBILITY.md)).
