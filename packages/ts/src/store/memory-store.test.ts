import { describe, expect, it } from 'vitest';
import { MemoryStore } from './memory-store.js';
import type { Clock } from '../clock.js';

function fakeClock(start = 1000): Clock & { set(t: number): void } {
  let t = start;
  return { now: () => t, set: (n) => (t = n) };
}

// The store is byte-agnostic (FRSH-060): it holds opaque packed strings, so tests use
// plain string payloads and assert exact round-trip.

describe('MemoryStore', () => {
  it('reads back what it wrote', async () => {
    const store = new MemoryStore();
    await store.write('k', 'packed-v', 600);
    expect(await store.read('k')).toBe('packed-v');
  });

  it('returns undefined for a missing key', async () => {
    expect(await new MemoryStore().read('nope')).toBeUndefined();
  });

  it('evicts lazily once physical TTL elapses', async () => {
    const clock = fakeClock(1000);
    const store = new MemoryStore(clock);
    await store.write('k', 'v', 10); // physical expiry at 1010
    clock.set(1009);
    expect(await store.read('k')).toBeDefined();
    clock.set(1010);
    expect(await store.read('k')).toBeUndefined();
  });

  it('deleteExact removes only the named key', async () => {
    const store = new MemoryStore();
    await store.write('product/detail/a', '1', 600);
    await store.write('product/detail/b', '2', 600);
    await store.deleteExact('product/detail/a');
    expect(await store.read('product/detail/a')).toBeUndefined();
    expect(await store.read('product/detail/b')).toBeDefined();
  });

  it('deletePrefix removes the whole subtree but not siblings', async () => {
    const store = new MemoryStore();
    await store.write('product/detail', '0', 600);
    await store.write('product/detail/a', '1', 600);
    await store.write('product/detail/b', '2', 600);
    await store.write('product/detail-other', '3', 600); // NOT under the subtree
    await store.write('product/list/a', '4', 600);
    await store.deletePrefix('product/detail');
    expect(await store.read('product/detail')).toBeUndefined();
    expect(await store.read('product/detail/a')).toBeUndefined();
    expect(await store.read('product/detail/b')).toBeUndefined();
    expect(await store.read('product/detail-other')).toBeDefined();
    expect(await store.read('product/list/a')).toBeDefined();
  });
});
