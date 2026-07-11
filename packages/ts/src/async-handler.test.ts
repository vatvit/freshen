import { describe, expect, it, vi } from 'vitest';
import { AsyncHandler, InProcessAsyncDispatcher } from './async-handler.js';
import { Cache } from './cache.js';
import { InvalidateEvent, InvalidateExactEvent, RefreshEvent } from './events.js';
import { Key, KeyPrefix } from './key.js';
import { MemoryStore } from './store/memory-store.js';
import { SyncMode } from './sync-mode.js';
import type { Jitter } from './ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };
const KEY = new Key('product', 'detail', 'sku-1');

function newCache(): Cache<string> {
  return new Cache<string>({
    loader: () => 'v',
    hardTtlSec: 600,
    store: new MemoryStore(),
    jitter: noJitter,
    clock: { now: () => 1000 },
  });
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('AsyncHandler — per-op routing (PARITY §11)', () => {
  it('routes each event to its sync cache op', async () => {
    const cache = newCache();
    const invalidate = vi.spyOn(cache, 'invalidate').mockResolvedValue();
    const invalidateExact = vi.spyOn(cache, 'invalidateExact').mockResolvedValue();
    const refresh = vi.spyOn(cache, 'refresh').mockResolvedValue();
    const handler = new AsyncHandler(cache);

    await handler.handleInvalidate(new InvalidateEvent(KEY));
    await handler.handleInvalidateExact(new InvalidateExactEvent(KEY));
    await handler.handleRefresh(new RefreshEvent(KEY));

    expect(invalidate).toHaveBeenCalledWith(KEY, SyncMode.SYNC);
    expect(invalidateExact).toHaveBeenCalledWith(KEY, SyncMode.SYNC);
    expect(refresh).toHaveBeenCalledWith(KEY, SyncMode.SYNC);
  });

  it('forwards a KeyPrefix selector on the hierarchical event', async () => {
    const cache = newCache();
    const invalidate = vi.spyOn(cache, 'invalidate').mockResolvedValue();
    const prefix = new KeyPrefix('product', 'detail');
    await new AsyncHandler(cache).handleInvalidate(new InvalidateEvent(prefix));
    expect(invalidate).toHaveBeenCalledWith(prefix, SyncMode.SYNC);
  });
});

describe('InProcessAsyncDispatcher', () => {
  it('routes refresh and invalidate on the SAME key to distinct ops (FRSH-013)', async () => {
    const cache = newCache();
    const invalidate = vi.spyOn(cache, 'invalidate').mockResolvedValue();
    const refresh = vi.spyOn(cache, 'refresh').mockResolvedValue();
    const invalidateExact = vi.spyOn(cache, 'invalidateExact').mockResolvedValue();

    const dispatcher = new InProcessAsyncDispatcher().bind(new AsyncHandler(cache));
    dispatcher.dispatch(new RefreshEvent(KEY));
    dispatcher.dispatch(new InvalidateEvent(KEY));
    await tick();

    expect(refresh).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidateExact).not.toHaveBeenCalled();
  });

  it('end-to-end: an ASYNC invalidateExact eventually clears the value', async () => {
    // dispatcher first (empty), then the cache wired to it, then bind the handler —
    // resolving the cache<->dispatcher cycle.
    const store = new MemoryStore<string>();
    const dispatcher = new InProcessAsyncDispatcher();
    const cache = new Cache<string>({
      loader: () => 'v',
      hardTtlSec: 600,
      store,
      jitter: noJitter,
      clock: { now: () => 1000 },
      dispatcher,
    });
    dispatcher.bind(new AsyncHandler(cache));

    await cache.put(KEY, 'v');
    expect(await store.read(KEY.toString())).toBeDefined();

    await cache.invalidateExact(KEY); // ASYNC (default) → dispatch → handler runs sync op
    await tick();
    expect(await store.read(KEY.toString())).toBeUndefined();
  });

  it('routes a handler rejection to onError instead of crashing', async () => {
    const cache = newCache();
    vi.spyOn(cache, 'refresh').mockRejectedValue(new Error('loader down'));
    const onError = vi.fn();
    const dispatcher = new InProcessAsyncDispatcher(onError).bind(new AsyncHandler(cache));
    dispatcher.dispatch(new RefreshEvent(KEY));
    await tick();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('ignores non-AsyncEvent objects', () => {
    const dispatcher = new InProcessAsyncDispatcher();
    expect(() => dispatcher.dispatch({ not: 'an event' })).not.toThrow();
  });
});
