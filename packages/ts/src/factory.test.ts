import { describe, expect, it } from 'vitest';
import { createFreshen } from './factory.js';
import { Key } from './key.js';
import { MemoryStore } from './store/memory-store.js';
import type { Clock } from './clock.js';
import type { Jitter, Metrics } from './ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };
const clock: Clock = { now: () => 1000 };
const K = (id: string): Key => new Key('product', id, 1);

describe('createFreshen', () => {
  it('shares one store across every cache it builds', () => {
    const store = new MemoryStore(clock);
    const freshen = createFreshen({ store });
    const a = freshen.cache({ loader: () => 'a', hardTtlSec: 60 });
    const b = freshen.cache({ loader: () => 'b', hardTtlSec: 60 });
    expect(a.asStore()).toBe(store);
    expect(b.asStore()).toBe(store);
  });

  it('shares one default in-memory store when none is given', () => {
    const freshen = createFreshen();
    const a = freshen.cache({ loader: () => 'a', hardTtlSec: 60 });
    const b = freshen.cache({ loader: () => 'b', hardTtlSec: 60 });
    expect(a.asStore()).toBe(b.asStore()); // same shared instance
  });

  it('different datasets live in one store without colliding (namespaced keys)', async () => {
    const freshen = createFreshen({ clock, jitter: noJitter });
    const sellers = freshen.cache<string>({ loader: () => 'sellers', hardTtlSec: 60 });
    const cats = freshen.cache<string>({ loader: () => 'cats', hardTtlSec: 60 });
    expect((await sellers.get(K('top-sellers'))).value()).toBe('sellers');
    expect((await cats.get(K('categories'))).value()).toBe('cats');
  });

  it('applies shared metrics to every built cache', async () => {
    const calls: string[] = [];
    const metrics: Metrics = { inc: (n) => calls.push(n), observe: () => undefined };
    const freshen = createFreshen({ metrics, clock, jitter: noJitter });
    const c = freshen.cache<string>({ loader: () => 'v', hardTtlSec: 60 });
    await c.get(K('x'));
    expect(calls).toContain('cache_fill');
  });

  it('merges shared and per-cache hooks', async () => {
    const seen: string[] = [];
    const freshen = createFreshen({
      clock,
      jitter: noJitter,
      hooks: [() => seen.push('shared')],
    });
    const c = freshen.cache<string>({
      loader: () => 'v',
      hardTtlSec: 60,
      hooks: [() => seen.push('per-cache')],
    });
    await c.get(K('x'));
    expect(seen).toContain('shared');
    expect(seen).toContain('per-cache');
  });

  it('per-cache options override the shared ones', () => {
    const shared = new MemoryStore(clock);
    const ownStore = new MemoryStore(clock);
    const freshen = createFreshen({ store: shared });
    const c = freshen.cache({ loader: () => 'v', hardTtlSec: 60, store: ownStore });
    expect(c.asStore()).toBe(ownStore); // overrode the shared store
  });
});
