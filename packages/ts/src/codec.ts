import { gunzipSync, gzipSync } from 'node:zlib';
import type { Entry } from './item.js';
import type { Driver, Store } from './ports.js';
import { isDriver } from './ports.js';

/**
 * Pluggable (de)serialization / compression of the stored **value** (FRSH-052).
 * Applied only to the value payload — the {@link Entry} envelope timestamps stay
 * intact and readable, which the read state machine needs. Serialization is a
 * host binding (PARITY §13 area): observable value-in/value-out is unchanged; the
 * codec is non-normative.
 *
 * Alternative (DRY) path: if you use a keyv store, you can instead delegate to
 * keyv's own `@keyv/compress-*` / serialize hooks and skip this seam entirely — see
 * the README. This seam exists for the non-keyv paths (in-memory, the Redis driver).
 */
export interface Codec<T = unknown> {
  /** Transform a value into its stored form (e.g. compressed base64). */
  encode(value: T): unknown;
  /** Reverse {@link encode}. MAY throw — a decode failure is treated as a miss. */
  decode(stored: unknown): T;
}

/**
 * Built-in gzip + JSON codec for large payloads. `T` must be JSON-serialisable.
 * Stores a base64 string of the gzipped JSON.
 */
export function gzipJsonCodec<T = unknown>(): Codec<T> {
  return {
    encode: (value) =>
      value === undefined ? undefined : gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64'),
    decode: (stored) => {
      if (stored === undefined || stored === null) {
        return undefined as unknown as T;
      }
      const gzipped = Buffer.from(String(stored), 'base64');
      return JSON.parse(gunzipSync(gzipped).toString('utf8')) as T;
    },
  };
}

class CodecStore<T> implements Store<T> {
  constructor(
    protected readonly inner: Store<unknown>,
    protected readonly codec: Codec<T>,
  ) {}

  async read(key: string): Promise<Entry<T> | undefined> {
    const entry = await this.inner.read(key);
    return this.decodeEntry(entry);
  }

  write(key: string, entry: Entry<T>, ttlSec: number): Promise<void> {
    return this.inner.write(key, this.encodeEntry(entry), ttlSec);
  }

  deleteExact(key: string): Promise<void> {
    return this.inner.deleteExact(key);
  }

  deletePrefix(prefix: string): Promise<void> {
    return this.inner.deletePrefix(prefix);
  }

  protected encodeEntry(entry: Entry<T>): Entry<unknown> {
    // Negative entries carry no meaningful value — leave them untouched.
    if (entry.negative === true) {
      return entry as Entry<unknown>;
    }
    return { ...entry, value: this.codec.encode(entry.value) };
  }

  protected decodeEntry(entry: Entry<unknown> | undefined): Entry<T> | undefined {
    if (entry === undefined) {
      return undefined;
    }
    if (entry.negative === true) {
      return entry as Entry<T>;
    }
    try {
      return { ...entry, value: this.codec.decode(entry.value) };
    } catch {
      // A corrupt/undecodable payload must not take down the read path — treat it as
      // a miss (fail-open spirit) so the loader recomputes.
      return undefined;
    }
  }
}

class CodecDriver<T> extends CodecStore<T> implements Driver<T> {
  constructor(
    private readonly innerDriver: Driver<unknown>,
    codec: Codec<T>,
  ) {
    super(innerDriver, codec);
  }

  deleteExactMany(keys: string[]): Promise<void> {
    return this.innerDriver.deleteExactMany(keys);
  }

  async readMany(keys: string[]): Promise<Array<Entry<T> | undefined>> {
    const entries = await this.innerDriver.readMany(keys);
    return entries.map((entry) => this.decodeEntry(entry));
  }
}

/**
 * Wrap a store so values are transparently (de)serialised through `codec`. Preserves
 * the {@link Driver} batch/atomic capabilities when the wrapped store is a driver, so
 * `getMany`/batch-delete keep working under compression.
 */
export function withCodec<T>(store: Store<unknown>, codec: Codec<T>): Store<T> {
  return isDriver(store) ? new CodecDriver<T>(store, codec) : new CodecStore<T>(store, codec);
}
