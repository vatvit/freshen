import { describe, expect, it } from 'vitest';
import { ioredisAdapter, nodeRedisAdapter } from './adapters.js';
import type { IoredisLike, NodeRedisLike } from './adapters.js';

describe('ioredisAdapter', () => {
  function fake(): { client: IoredisLike; calls: unknown[][]; setReturn: { value: string | null } } {
    const calls: unknown[][] = [];
    const setReturn = { value: 'OK' as string | null };
    const client: IoredisLike = {
      get: (k) => (calls.push(['get', k]), Promise.resolve(null)),
      set: (k, v, ...args) => (calls.push(['set', k, v, ...args]), Promise.resolve(setReturn.value)),
      del: (...keys) => (calls.push(['del', ...keys]), Promise.resolve(keys.length)),
      mget: (...keys) => (calls.push(['mget', ...keys]), Promise.resolve(keys.map(() => null))),
      scan: (cursor, ...args) => (calls.push(['scan', cursor, ...args]), Promise.resolve(['0', ['x']])),
    };
    return { client, calls, setReturn };
  }

  it('maps set with PX + NX to positional args and returns true on OK', async () => {
    const { client, calls } = fake();
    expect(await ioredisAdapter(client).set('k', 'v', { pxMs: 1000, nx: true })).toBe(true);
    expect(calls[0]).toEqual(['set', 'k', 'v', 'PX', 1000, 'NX']);
  });

  it('returns false when NX set is rejected (null)', async () => {
    const { client, setReturn } = fake();
    setReturn.value = null;
    expect(await ioredisAdapter(client).set('k', 'v', { nx: true })).toBe(false);
  });

  it('del/mget spread varargs and short-circuit on empty', async () => {
    const { client, calls } = fake();
    const a = ioredisAdapter(client);
    expect(await a.del([])).toBe(0);
    expect(await a.mget([])).toEqual([]);
    expect(calls).toHaveLength(0); // nothing sent for empty batches
    await a.del(['a', 'b']);
    expect(calls[0]).toEqual(['del', 'a', 'b']);
  });

  it('maps scan to MATCH/COUNT and normalises the page', async () => {
    const { client, calls } = fake();
    expect(await ioredisAdapter(client).scan('0', 'p*', 10)).toEqual({ cursor: '0', keys: ['x'] });
    expect(calls[0]).toEqual(['scan', '0', 'MATCH', 'p*', 'COUNT', 10]);
  });
});

describe('nodeRedisAdapter', () => {
  function fake(): { client: NodeRedisLike; calls: unknown[][]; setReturn: { value: string | null } } {
    const calls: unknown[][] = [];
    const setReturn = { value: 'OK' as string | null };
    const client: NodeRedisLike = {
      get: (k) => (calls.push(['get', k]), Promise.resolve(null)),
      set: (k, v, options) => (calls.push(['set', k, v, options]), Promise.resolve(setReturn.value)),
      del: (keys) => (calls.push(['del', keys]), Promise.resolve(Array.isArray(keys) ? keys.length : 1)),
      mGet: (keys) => (calls.push(['mGet', keys]), Promise.resolve(keys.map(() => null))),
      scan: (cursor, options) => (
        calls.push(['scan', cursor, options]), Promise.resolve({ cursor: 0, keys: ['x'] })
      ),
    };
    return { client, calls, setReturn };
  }

  it('maps set with PX + NX to an options object and returns true on OK', async () => {
    const { client, calls } = fake();
    expect(await nodeRedisAdapter(client).set('k', 'v', { pxMs: 1000, nx: true })).toBe(true);
    expect(calls[0]).toEqual(['set', 'k', 'v', { PX: 1000, NX: true }]);
  });

  it('maps scan options and normalises the numeric cursor to a string', async () => {
    const { client, calls } = fake();
    expect(await nodeRedisAdapter(client).scan('0', 'p*', 10)).toEqual({ cursor: '0', keys: ['x'] });
    expect(calls[0]).toEqual(['scan', 0, { MATCH: 'p*', COUNT: 10 }]);
  });

  it('mGet passes the key array and short-circuits on empty', async () => {
    const { client, calls } = fake();
    const a = nodeRedisAdapter(client);
    expect(await a.mget([])).toEqual([]);
    expect(await a.del([])).toBe(0);
    expect(calls).toHaveLength(0);
    await a.mget(['a', 'b']);
    expect(calls[0]).toEqual(['mGet', ['a', 'b']]);
  });
});
