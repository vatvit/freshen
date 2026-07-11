import { describe, expect, it } from 'vitest';
import { LruStore } from './lru-store.js';
import type { Entry } from '../item.js';
import type { Clock } from '../clock.js';

function fakeClock(start = 1000): Clock & { set(t: number): void } {
  let t = start;
  return { now: () => t, set: (n) => (t = n) };
}
const entry = <V>(value: V): Entry<V> => ({ value, createdAt: 1000, hardExpiresAt: 1600 });

describe('LruStore', () => {
  it('rejects a non-positive max', () => {
    expect(() => new LruStore(0)).toThrow();
  });

  it('reads back what it wrote', async () => {
    const store = new LruStore(10);
    await store.write('k', entry('v'), 600);
    expect((await store.read('k'))?.value).toBe('v');
  });

  it('evicts the least-recently-used past the bound', async () => {
    const store = new LruStore<number>(2);
    await store.write('a', entry(1), 600);
    await store.write('b', entry(2), 600);
    await store.write('c', entry(3), 600); // exceeds max 2 -> evict 'a' (LRU)
    expect(await store.read('a')).toBeUndefined();
    expect((await store.read('b'))?.value).toBe(2);
    expect((await store.read('c'))?.value).toBe(3);
  });

  it('a read refreshes recency so the touched key survives eviction', async () => {
    const store = new LruStore<number>(2);
    await store.write('a', entry(1), 600);
    await store.write('b', entry(2), 600);
    await store.read('a'); // 'a' now most-recently-used
    await store.write('c', entry(3), 600); // evicts LRU = 'b'
    expect((await store.read('a'))?.value).toBe(1);
    expect(await store.read('b')).toBeUndefined();
  });

  it('evicts lazily on physical TTL', async () => {
    const clock = fakeClock(1000);
    const store = new LruStore(10, clock);
    await store.write('k', entry('v'), 10);
    clock.set(1009);
    expect(await store.read('k')).toBeDefined();
    clock.set(1010);
    expect(await store.read('k')).toBeUndefined();
  });

  it('deletePrefix drops the subtree only', async () => {
    const store = new LruStore(10);
    await store.write('a/b', entry(1), 600);
    await store.write('a/b/c', entry(2), 600);
    await store.write('a/bx', entry(3), 600);
    await store.deletePrefix('a/b');
    expect(await store.read('a/b')).toBeUndefined();
    expect(await store.read('a/b/c')).toBeUndefined();
    expect(await store.read('a/bx')).toBeDefined();
  });
});
