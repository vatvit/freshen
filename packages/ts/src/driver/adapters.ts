import type { RedisLike, RedisScanPage, RedisSetOptions } from './redis-like.js';

/**
 * Thin adapters mapping the two dominant Node Redis clients onto {@link RedisLike}.
 * They are **structural** — we describe only the handful of methods/overloads we
 * call, so Freshen takes **no dependency** on either client (they are optional peer
 * deps). The host passes its already-connected client; docs default to `ioredis`
 * (the most-installed client and what a BullMQ queue already uses), but both work.
 */

/** The subset of an `ioredis` client Freshen uses (positional, varargs signatures). */
export interface IoredisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>;
}

/** The subset of a `node-redis` v4 client Freshen uses (options-object signatures). */
export interface NodeRedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { PX?: number; NX?: boolean },
  ): Promise<string | null>;
  del(keys: string | string[]): Promise<number>;
  mGet(keys: string[]): Promise<Array<string | null>>;
  scan(cursor: number, options?: { MATCH?: string; COUNT?: number }): Promise<{ cursor: number; keys: string[] }>;
}

/** Adapt a connected `ioredis` client to {@link RedisLike}. */
export function ioredisAdapter(client: IoredisLike): RedisLike {
  return {
    get: (key) => client.get(key),
    set: async (key, value, opts?: RedisSetOptions): Promise<boolean> => {
      const args: Array<string | number> = [];
      if (opts?.pxMs !== undefined) {
        args.push('PX', opts.pxMs);
      }
      if (opts?.nx === true) {
        args.push('NX');
      }
      const res = await client.set(key, value, ...args);
      return res === 'OK';
    },
    del: (keys) => (keys.length > 0 ? client.del(...keys) : Promise.resolve(0)),
    mget: (keys) => (keys.length > 0 ? client.mget(...keys) : Promise.resolve([])),
    scan: async (cursor, match, count): Promise<RedisScanPage> => {
      const [next, keys] = await client.scan(cursor, 'MATCH', match, 'COUNT', count);
      return { cursor: next, keys };
    },
  };
}

/** Adapt a connected `node-redis` v4 client to {@link RedisLike}. */
export function nodeRedisAdapter(client: NodeRedisLike): RedisLike {
  return {
    get: (key) => client.get(key),
    set: async (key, value, opts?: RedisSetOptions): Promise<boolean> => {
      const options: { PX?: number; NX?: boolean } = {};
      if (opts?.pxMs !== undefined) {
        options.PX = opts.pxMs;
      }
      if (opts?.nx === true) {
        options.NX = true;
      }
      const res = await client.set(key, value, options);
      return res === 'OK';
    },
    del: (keys) => (keys.length > 0 ? client.del(keys) : Promise.resolve(0)),
    mget: (keys) => (keys.length > 0 ? client.mGet(keys) : Promise.resolve([])),
    scan: async (cursor, match, count): Promise<RedisScanPage> => {
      const res = await client.scan(Number(cursor), { MATCH: match, COUNT: count });
      return { cursor: String(res.cursor), keys: res.keys };
    },
  };
}
