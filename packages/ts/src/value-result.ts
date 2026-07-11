import { MissingValueError } from './errors.js';

/** The read outcome state (PARITY §3.4). */
export enum CacheReadState {
  HIT = 'hit',
  STALE = 'stale',
  MISS = 'miss',
}

/**
 * Immutable read result (PARITY §3.3 / §7.2). Constructed via the `hit` / `stale`
 * / `miss` factories, never directly. Mirrors the PHP `ValueResult`.
 *
 * `createdAt` / `softExpiresAt` are unix seconds and are `null` on a miss.
 * `value()` **throws** on a miss rather than returning a sentinel — a cached
 * `null`/`undefined` is a legitimate HIT and is returned as-is.
 */
export class ValueResult<T = unknown> {
  private constructor(
    private readonly state: CacheReadState,
    private readonly _value: T | undefined,
    private readonly _createdAt: number | null,
    private readonly _softExpiresAt: number | null,
  ) {}

  /** Fresh value within the soft window. */
  static hit<T>(value: T, createdAt: number, softExpiresAt: number): ValueResult<T> {
    return new ValueResult<T>(CacheReadState.HIT, value, createdAt, softExpiresAt);
  }

  /** Stale value served beyond hard expiry while a leader recomputes. */
  static stale<T>(value: T, createdAt: number, softExpiresAt: number): ValueResult<T> {
    return new ValueResult<T>(CacheReadState.STALE, value, createdAt, softExpiresAt);
  }

  /** Miss — no value available. */
  static miss<T = unknown>(): ValueResult<T> {
    return new ValueResult<T>(CacheReadState.MISS, undefined, null, null);
  }

  isHit(): boolean {
    return this.state === CacheReadState.HIT;
  }

  isStale(): boolean {
    return this.state === CacheReadState.STALE;
  }

  isMiss(): boolean {
    return this.state === CacheReadState.MISS;
  }

  /** The value, or throws {@link MissingValueError} on a miss. */
  value(): T {
    if (this.isMiss()) {
      throw new MissingValueError();
    }
    return this._value as T;
  }

  /** Unix seconds the payload was created; `null` on a miss. */
  createdAt(): number | null {
    return this._createdAt;
  }

  /** Unix seconds of soft expiry; `null` on a miss. */
  softExpiresAt(): number | null {
    return this._softExpiresAt;
  }
}
