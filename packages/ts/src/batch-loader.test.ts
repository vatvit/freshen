import { describe, expect, it, vi } from 'vitest';
import { CoalescingLoader, loopBatchLoader } from './batch-loader.js';
import { Cache } from './cache.js';
import { Key } from './key.js';
import { MemoryStore } from './store/memory-store.js';
import type { BatchLoader, Jitter } from './ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };
const K = (id: number): Key => new Key('product', 'detail', id);

describe('loopBatchLoader', () => {
  it('implements resolveMany by looping resolve', async () => {
    const resolve = vi.fn((k: Key) => `v:${k.idString()}`);
    const batch = loopBatchLoader<string>({ resolve });
    expect(await batch.resolveMany([K(1), K(2), K(3)])).toEqual(['v:1', 'v:2', 'v:3']);
    expect(resolve).toHaveBeenCalledTimes(3);
  });
});

describe('CoalescingLoader', () => {
  it('collapses concurrent resolves in a tick into one resolveMany', async () => {
    const resolveMany = vi.fn((keys: Key[]) => keys.map((k) => `v:${k.idString()}`));
    const batchLoader: BatchLoader<string> = {
      resolve: (k) => `v:${k.idString()}`,
      resolveMany,
    };
    const loader = new CoalescingLoader(batchLoader);
    const [a, b, c] = await Promise.all([loader.resolve(K(1)), loader.resolve(K(2)), loader.resolve(K(3))]);
    expect([a, b, c]).toEqual(['v:1', 'v:2', 'v:3']);
    expect(resolveMany).toHaveBeenCalledOnce();
    expect(resolveMany.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it('rejects every coalesced caller when the batch fails', async () => {
    const batchLoader: BatchLoader<string> = {
      resolve: () => 'x',
      resolveMany: () => Promise.reject(new Error('batch down')),
    };
    const loader = new CoalescingLoader(batchLoader);
    const results = await Promise.allSettled([loader.resolve(K(1)), loader.resolve(K(2))]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });
});

describe('getMany + CoalescingLoader (FRSH-049 × FRSH-050)', () => {
  it('N concurrent misses trigger ONE resolveMany, single-flight preserved', async () => {
    const resolveMany = vi.fn((keys: Key[]) => keys.map((k) => `loaded:${k.idString()}`));
    const batchLoader: BatchLoader<string> = {
      resolve: (k) => `loaded:${k.idString()}`,
      resolveMany,
    };
    const cache = new Cache<string>({
      loader: new CoalescingLoader(batchLoader),
      hardTtlSec: 600,
      precomputeSec: 60,
      store: new MemoryStore({ now: () => 1000 }),
      jitter: noJitter,
      clock: { now: () => 1000 },
    });
    const results = await cache.getMany([K(1), K(2), K(3)]);
    expect(results.map((r) => r.value())).toEqual(['loaded:1', 'loaded:2', 'loaded:3']);
    expect(resolveMany).toHaveBeenCalledOnce(); // one coalesced source round-trip
  });

  it('a plain loader without resolveMany still works (per-key resolve)', async () => {
    const resolve = vi.fn((k: Key) => `v:${k.idString()}`);
    const cache = new Cache<string>({
      loader: { resolve },
      hardTtlSec: 600,
      precomputeSec: 60,
      store: new MemoryStore({ now: () => 1000 }),
      jitter: noJitter,
      clock: { now: () => 1000 },
    });
    const results = await cache.getMany([K(1), K(2)]);
    expect(results.map((r) => r.value())).toEqual(['v:1', 'v:2']);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
