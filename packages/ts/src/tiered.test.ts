import { describe, expect, it, vi } from 'vitest';
import { tieredCache } from './tiered.js';
import { Key } from './key.js';
import { MemoryStore } from './store/memory-store.js';
import type { Clock } from './clock.js';
import type { Jitter } from './ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };
const K = (id: number | string): Key => new Key('product', 'detail', id);

function fakeClock(start = 1000): Clock & { set(t: number): void } {
  let t = start;
  return { now: () => t, set: (n) => (t = n) };
}

function build(clock: Clock, source: (k: Key) => string): {
  cache: ReturnType<typeof tieredCache<string>>;
  db: ReturnType<typeof vi.fn>;
} {
  const db = vi.fn(source);
  const cache = tieredCache<string>({
    loader: db,
    l1: { max: 100, hardTtlSec: 5, clock },
    l2: { store: new MemoryStore(clock), hardTtlSec: 600, precomputeSec: 60, jitter: noJitter, clock },
  });
  return { cache, db };
}

describe('TieredCache (FRSH-047, Approach A)', () => {
  it('cascades L1 -> L2 -> source and backfills L1 (source hit once)', async () => {
    const clock = fakeClock(1000);
    const { cache, db } = build(clock, (k) => `v:${k.idString()}`);
    expect((await cache.get(K(1))).value()).toBe('v:1'); // cold: source
    expect((await cache.get(K(1))).value()).toBe('v:1'); // L1 fresh
    expect((await cache.get(K(1))).value()).toBe('v:1');
    expect(db).toHaveBeenCalledOnce(); // L1 served the repeats
  });

  it('honours per-tier TTLs: L1 expires to L2 without hitting the source', async () => {
    const clock = fakeClock(1000);
    const { cache, db } = build(clock, (k) => `v:${k.idString()}`);
    await cache.get(K(1)); // fill both tiers
    clock.set(1010); // past L1 TTL (5s) but well within L2 TTL (600s)
    expect((await cache.get(K(1))).value()).toBe('v:1'); // re-reads L2, backfills L1
    expect(db).toHaveBeenCalledOnce(); // source NOT hit again
  });

  it('invalidateExact evicts BOTH tiers (single-instance coherence)', async () => {
    const clock = fakeClock(1000);
    const { cache, db } = build(clock, (k) => `v:${k.idString()}@${db.mock.calls.length}`);
    await cache.get(K(1)); // fill both
    await cache.invalidateExact(K(1)); // default SYNC -> both tiers dropped
    await cache.get(K(1)); // must recompute from source
    expect(db).toHaveBeenCalledTimes(2);
  });

  it('write-through put populates both tiers', async () => {
    const clock = fakeClock(1000);
    const { cache, db } = build(clock, () => 'from-db');
    await cache.put(K(1), 'written');
    expect((await cache.get(K(1))).value()).toBe('written');
    expect(db).not.toHaveBeenCalled(); // served from L1, never fell through to source
  });

  it('refresh recomputes L2 from source and drops stale L1', async () => {
    const clock = fakeClock(1000);
    let n = 0;
    const { cache, db } = build(clock, () => `gen${++n}`);
    expect((await cache.get(K(1))).value()).toBe('gen1');
    await cache.refresh(K(1));
    expect((await cache.get(K(1))).value()).toBe('gen2'); // fresh value cascaded
    expect(db).toHaveBeenCalledTimes(2);
  });
});
