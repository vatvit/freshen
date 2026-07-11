/**
 * The tiny Redis command port Freshen needs (FRSH-044) — the client-agnostic seam.
 * Freshen depends on **this**, never on a concrete client: thin adapters normalise
 * `ioredis` and `node-redis` onto it (see `adapters.ts`), and the host injects a
 * connected client. This is the ~5 commands the strong guarantees require
 * (PARITY §12): atomic conditional write (`SET … NX PX`), batch read (`MGET`),
 * exact/batch delete (`DEL`), and subtree scan (`SCAN`). `KEYS` is intentionally
 * absent — it blocks the server.
 */
export interface RedisLike {
  /** GET — value string or `null` when absent. */
  get(key: string): Promise<string | null>;

  /**
   * SET with optional `NX` (only if absent) and `PX` (expiry, ms). Returns `true`
   * when the value was set — i.e. `false` when `NX` was requested but the key
   * already existed (the single-flight "lost the lock" signal).
   */
  set(key: string, value: string, opts?: RedisSetOptions): Promise<boolean>;

  /** DEL — number of keys removed. A no-op (0) for an empty list. */
  del(keys: string[]): Promise<number>;

  /** MGET — one entry per input key, order-preserving; `null` where absent. */
  mget(keys: string[]): Promise<Array<string | null>>;

  /** SCAN one page. Cursor is a string (`'0'` starts/ends iteration). */
  scan(cursor: string, match: string, count: number): Promise<RedisScanPage>;
}

export interface RedisSetOptions {
  /** Expiry in milliseconds (Redis `PX`). */
  pxMs?: number;
  /** Only set if the key does not already exist (Redis `NX`). */
  nx?: boolean;
}

export interface RedisScanPage {
  /** Next cursor; `'0'` when iteration is complete. */
  cursor: string;
  keys: string[];
}
