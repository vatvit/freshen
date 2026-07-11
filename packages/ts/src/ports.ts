import type { Key, KeyPrefixLike } from './key.js';
import type { Entry } from './item.js';

/**
 * The pluggable collaborators of the cache — every one an interface with a bundled
 * default (PARITY §3.5; the "simple by default, customizable in every axis"
 * principle). A host may swap any of them without forking.
 */

/** Produces the authoritative value for a key (PARITY §3.5). MAY be async. */
export interface Loader<T = unknown> {
  resolve(key: Key): T | Promise<T>;
}

/**
 * A batch/coalescing loader (FRSH-050). Optional capability: a `Loader` that also
 * implements `resolveMany` lets the cache collapse N concurrent misses into one
 * source round-trip. Loaders without it fall back to looping `resolve`.
 */
export interface BatchLoader<T = unknown> extends Loader<T> {
  resolveMany(keys: Key[]): Array<T> | Promise<Array<T>>;
}

/** TTL jitter strategy (PARITY §9). Returns an adjusted TTL, MUST be ≥ 1. */
export interface Jitter {
  apply(ttlSec: number, key: Key): number;
}

/**
 * Fire-and-forget observability sink (PARITY §3.5 / §10). MUST NOT throw into the
 * cache path. In this port metrics are emitted through the hook system (a built-in
 * subscriber), never a separate code path.
 */
export interface Metrics {
  inc(name: string, labels?: Record<string, string>): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
}

/**
 * The backend store port (PARITY §12). The library ships a default in-memory store
 * and consumes any implementation (a keyv store, a Redis driver, …). Values are the
 * Freshen {@link Entry} envelope; the store persists it under a physical TTL.
 */
export interface Store<T = unknown> {
  /** Read the envelope for a key, or `undefined` if absent/expired. */
  read(key: string): Promise<Entry<T> | undefined>;
  /** Persist an envelope under a physical TTL (seconds). */
  write(key: string, entry: Entry<T>, ttlSec: number): Promise<void>;
  /** Delete exactly one key (leaving its subtree intact) — PARITY §8. */
  deleteExact(key: string): Promise<void>;
  /** Delete the whole subtree under a prefix string — PARITY §8. */
  deletePrefix(prefix: string): Promise<void>;
}

/**
 * Optional strong-guarantee capabilities a backend MAY provide (the Redis driver
 * does — FRSH-044). The cache feature-detects these, exactly as the PHP reference
 * checks `instanceof Driver\Redis`, and falls back to best-effort otherwise.
 */
export interface Driver<T = unknown> extends Store<T> {
  /** Atomic exact-delete of many keys in one round-trip (Redis `DEL k1 k2 …`). */
  deleteExactMany(keys: string[]): Promise<void>;
  /** Batch read many keys in one round-trip (Redis `MGET`). Order-preserving. */
  readMany(keys: string[]): Promise<Array<Entry<T> | undefined>>;
}

/** Narrowing guard for the optional {@link Driver} capabilities. */
export function isDriver<T>(store: Store<T>): store is Driver<T> {
  const d = store as Partial<Driver<T>>;
  return typeof d.deleteExactMany === 'function' && typeof d.readMany === 'function';
}

/**
 * Single-flight leader election (PARITY §7 tier 2 / §12 req 3). `acquire` returns
 * `true` for the one caller that becomes the leader; the lock frees on `release`
 * (and self-heals via its TTL if a leader dies). The core ships an in-process
 * default; the Redis driver swaps in an atomic `SET NX` implementation (FRSH-044)
 * with no change to the read state machine.
 */
export interface SingleFlight {
  acquire(key: string, ttlSec: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

/**
 * Minimal event dispatcher the async model needs (PARITY §11 — the analogue of a
 * PSR-14 dispatcher). A host may plug its own bus or a queue adapter (BullMQ).
 */
export interface EventDispatcher {
  dispatch(event: object): void;
}

/** A selector accepted by `invalidate` — a key or a bare prefix. */
export type Selector = Key | KeyPrefixLike;
