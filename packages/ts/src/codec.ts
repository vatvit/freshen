import { deserialize, serialize } from 'node:v8';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Pluggable value (de)serialisation + optional compression (FRSH-060). The storage
 * layer is **byte-agnostic** — it packs and unpacks opaque strings and never
 * interprets the value's type. All fidelity + size concerns live here, in front of
 * the store, so every backend (in-memory, Redis, keyv) persists the **same encoded
 * bytes** — dev == prod, no per-store serialization skew.
 *
 * `encode` turns a value into its stored string form; `decode` reverses it and MAY
 * throw — a decode failure is treated by the cache as a miss (fail-open spirit), so
 * a corrupt/undecodable payload never takes down the read path. The encoded bytes are
 * a host binding (PARITY §13 area) — non-normative; observable value-in == value-out
 * is what matters. Swap in any strategy (superjson, msgpack, JSON) without forking.
 */
export interface Codec {
  /** Transform a value into its stored string form. */
  encode(value: unknown): string;
  /** Reverse {@link encode}. MAY throw — a decode failure is treated as a miss. */
  decode(packed: string): unknown;
}

/** Options for {@link v8Codec}. */
export interface V8CodecOptions {
  /**
   * Payloads whose serialized size (bytes) is ≥ this are gzip-compressed; smaller
   * ones are stored raw to avoid compression overhead on tiny values. Default 1024.
   */
  gzipThresholdBytes?: number;
  /**
   * Hard cap on the decompressed size (bytes) of a gzipped payload — bounds a
   * decompression bomb from untrusted stored bytes. Default 64 MiB.
   */
  maxDecodedBytes?: number;
}

// One-char framing marker so decode knows how the body was produced.
const RAW = 'r';
const GZIP = 'g';

/**
 * The default codec: Node's structured-clone serialization (`node:v8`) with gzip above
 * a size threshold. Zero-dependency and **fidelity-preserving** — `Date`, `Map`, `Set`,
 * `bigint`, typed arrays and nested structures round-trip exactly (fixing the pre-FRSH-060
 * skew where `MemoryStore` kept live refs while Redis/keyv JSON-encoded, corrupting
 * `Date`→string / `Map`→`{}` and throwing on `bigint`). The stored form is a marker char
 * followed by base64 of the (optionally gzipped) v8 bytes.
 */
export function v8Codec(options: V8CodecOptions = {}): Codec {
  const threshold = options.gzipThresholdBytes ?? 1024;
  const maxDecodedBytes = options.maxDecodedBytes ?? 64 * 1024 * 1024;
  return {
    encode(value: unknown): string {
      const raw = serialize(value);
      if (raw.length >= threshold) {
        return GZIP + gzipSync(raw).toString('base64');
      }
      return RAW + raw.toString('base64');
    },
    decode(packed: string): unknown {
      const marker = packed[0];
      const body = Buffer.from(packed.slice(1), 'base64');
      const raw = marker === GZIP ? gunzipSync(body, { maxOutputLength: maxDecodedBytes }) : body;
      return deserialize(raw);
    },
  };
}

/**
 * Alternative codec for hosts that prefer JSON-compatible, human-inspectable bytes
 * (at the cost of fidelity — `Date`→string, `Map`/`Set`→`{}`, `bigint` throws). Stores
 * a base64 string of the gzipped JSON. Prefer {@link v8Codec} (the default) unless you
 * specifically need JSON on the wire.
 */
export function gzipJsonCodec(): Codec {
  return {
    encode: (value: unknown): string =>
      gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64'),
    decode: (packed: string): unknown =>
      JSON.parse(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8')),
  };
}
