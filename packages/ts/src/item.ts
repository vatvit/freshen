import type { Codec } from './codec.js';

/**
 * The Freshen-controlled storage envelope (PARITY §5 / §12 — the analogue of PHP's
 * `Freshen\Item`). We wrap every stored value with our own timestamps rather than
 * trusting the backend's TTL, because the deterministic precompute window and the
 * `ValueResult` timestamps depend on an authoritative creation + hard-expiry pair.
 *
 * The envelope is stored under a *physical* store TTL that MAY exceed `hardExpiresAt`
 * (see `graceSec`) so a value can be retained past its logical hard expiry to serve
 * as STALE while a leader recomputes, and (later) to power stale-if-error.
 *
 * Optional fields are reserved for the adjacent features and are absent on a plain
 * positive entry:
 *  - `negative`    — this entry records a loader not-found/failure (negative caching).
 *  - `nextRetryAt` — mini circuit-breaker: unix seconds before which the loader must
 *                    not be re-hit (stale-if-error / negative caching backoff).
 */
export interface Entry<T = unknown> {
  value: T;
  /** Unix seconds the payload was created. */
  createdAt: number;
  /** Unix seconds of logical hard expiry (`createdAt + jitteredHardTtl`). */
  hardExpiresAt: number;
  negative?: boolean;
  nextRetryAt?: number;
}

/**
 * Soft expiry for an entry given a reader's `precomputeSec` (PARITY §5):
 * `max(createdAt, hardExpiresAt − precomputeSec)`. Never earlier than creation.
 */
export function softExpiresAt(entry: Entry, precomputeSec: number): number {
  return Math.max(entry.createdAt, entry.hardExpiresAt - precomputeSec);
}

/**
 * The on-the-wire shape of a packed entry (FRSH-060). The stores are byte-agnostic —
 * the `Cache` packs the {@link Entry} envelope into this compact JSON before `write`
 * and unpacks it on `read`. Envelope metadata (`c`/`h`/`n`/`r`) stays in cheap outer
 * JSON so the read state machine can read timestamps/flags without decoding the value;
 * the value (`v`) is the {@link Codec}-encoded payload, decoded lazily.
 */
interface PackedEnvelope {
  /** createdAt */
  c: number;
  /** hardExpiresAt */
  h: number;
  /** negative flag (1 when set) */
  n?: 1;
  /** nextRetryAt */
  r?: number;
  /** codec-encoded value (absent on negative entries) */
  v?: string;
}

/**
 * Pack an {@link Entry} into an opaque string for a byte-agnostic store (FRSH-060).
 * The value is encoded via the {@link Codec}; negative entries carry no value.
 */
export function packEntry(entry: Entry, codec: Codec): string {
  const env: PackedEnvelope = { c: entry.createdAt, h: entry.hardExpiresAt };
  if (entry.negative === true) {
    env.n = 1;
  }
  if (entry.nextRetryAt !== undefined) {
    env.r = entry.nextRetryAt;
  }
  if (entry.negative !== true) {
    env.v = codec.encode(entry.value);
  }
  return JSON.stringify(env);
}

/**
 * Reverse {@link packEntry}. Returns `undefined` when the stored bytes are absent or
 * un-decodable (malformed JSON or a codec `decode` throw) — the cache treats that as a
 * miss (fail-open), so a corrupt payload never crashes the read path.
 */
export function unpackEntry<T = unknown>(
  packed: string | undefined,
  codec: Codec,
): Entry<T> | undefined {
  if (packed === undefined) {
    return undefined;
  }
  try {
    const env = JSON.parse(packed) as PackedEnvelope;
    const entry: Entry<T> = {
      value: undefined as unknown as T,
      createdAt: env.c,
      hardExpiresAt: env.h,
    };
    if (env.n === 1) {
      entry.negative = true;
    }
    if (env.r !== undefined) {
      entry.nextRetryAt = env.r;
    }
    if (env.v !== undefined) {
      entry.value = codec.decode(env.v) as T;
    }
    return entry;
  } catch {
    return undefined;
  }
}
