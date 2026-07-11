import { describe, expect, it } from 'vitest';
import { HookBus, metricsSubscriber } from './hooks.js';
import type { HookEvent } from './hooks.js';
import { Cache } from './cache.js';
import { Key } from './key.js';
import { MemoryStore } from './store/memory-store.js';
import type { Clock } from './clock.js';
import type { Jitter, Metrics } from './ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };
const KEY = new Key('product', 'detail', 'sku-1');

function recordingMetrics(): Metrics & { calls: Array<[string, Record<string, string> | undefined]> } {
  const calls: Array<[string, Record<string, string> | undefined]> = [];
  return { calls, inc: (n, l) => calls.push([n, l]), observe: () => undefined };
}

describe('HookBus', () => {
  it('delivers events to all subscribers', () => {
    const bus = new HookBus();
    const a: HookEvent[] = [];
    const b: HookEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    bus.emit({ type: 'put', key: KEY });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new HookBus();
    const seen: HookEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    off();
    bus.emit({ type: 'put', key: KEY });
    expect(seen).toHaveLength(0);
  });

  it('isolates a throwing subscriber — others still run and emit never throws', () => {
    const bus = new HookBus();
    const seen: HookEvent[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => seen.push(e));
    expect(() => bus.emit({ type: 'put', key: KEY })).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});

describe('metricsSubscriber — PARITY §10 mapping', () => {
  it.each([
    [{ type: 'get', key: KEY, outcome: 'fresh' }, ['cache_hit', { state: 'fresh' }]],
    [{ type: 'get', key: KEY, outcome: 'stale' }, ['cache_hit', { state: 'stale' }]],
    [{ type: 'get', key: KEY, outcome: 'fresh_after_sleep' }, ['cache_hit', { state: 'fresh_after_sleep' }]],
    [{ type: 'get', key: KEY, outcome: 'fill' }, ['cache_fill', undefined]],
    [{ type: 'get', key: KEY, outcome: 'fail_open' }, ['cache_miss', { cause: 'precompute_race' }]],
    [{ type: 'get', key: KEY, outcome: 'miss' }, ['cache_miss', { cause: 'precompute_race_fail_closed' }]],
    [{ type: 'put', key: KEY }, ['cache_put', undefined]],
  ] as Array<[HookEvent, [string, Record<string, string> | undefined]]>)(
    'maps %o',
    (event, expected) => {
      const metrics = recordingMetrics();
      metricsSubscriber(metrics)(event);
      expect(metrics.calls[0]).toEqual(expected);
    },
  );

  it('maps invalidate hierarchical vs exact', () => {
    const metrics = recordingMetrics();
    const sub = metricsSubscriber(metrics);
    sub({ type: 'invalidate', selector: KEY, hierarchical: true });
    sub({ type: 'invalidate', selector: KEY, hierarchical: false });
    expect(metrics.calls).toEqual([
      ['cache_invalidate_hierarchical', undefined],
      ['cache_invalidate', undefined],
    ]);
  });
});

describe('Cache — hooks integration', () => {
  it('a custom hook observes get/put outcomes', async () => {
    const clock: Clock = { now: () => 1000 };
    const seen: HookEvent[] = [];
    const cache = new Cache<string>({
      loader: () => 'v',
      hardTtlSec: 600,
      precomputeSec: 60,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
      hooks: [(e) => seen.push(e)],
    });
    await cache.get(KEY); // cold -> leader fill
    await cache.get(KEY); // fresh
    const outcomes = seen.filter((e) => e.type === 'get').map((e) => (e as { outcome: string }).outcome);
    expect(outcomes).toEqual(['fill', 'fresh']);
  });

  it('metrics option is wired as a hook subscriber (no separate path)', async () => {
    const clock: Clock = { now: () => 1000 };
    const metrics = recordingMetrics();
    const cache = new Cache<string>({
      loader: () => 'v',
      hardTtlSec: 600,
      precomputeSec: 60,
      store: new MemoryStore(clock),
      jitter: noJitter,
      clock,
      metrics,
    });
    await cache.get(KEY);
    expect(metrics.calls).toContainEqual(['cache_fill', undefined]);
  });

  it('cache.subscribe returns a working unsubscribe', async () => {
    const clock: Clock = { now: () => 1000 };
    const seen: HookEvent[] = [];
    const cache = new Cache<string>({ loader: () => 'v', hardTtlSec: 600, jitter: noJitter, clock });
    const off = cache.subscribe((e) => seen.push(e));
    await cache.put(KEY, 'x');
    off();
    await cache.put(KEY, 'y');
    expect(seen).toHaveLength(1);
  });

  it('a throwing hook never breaks the cache path', async () => {
    const clock: Clock = { now: () => 1000 };
    const cache = new Cache<string>({
      loader: () => 'v',
      hardTtlSec: 600,
      jitter: noJitter,
      clock,
      hooks: [
        () => {
          throw new Error('observer blew up');
        },
      ],
    });
    const r = await cache.get(KEY);
    expect(r.value()).toBe('v');
  });
});
