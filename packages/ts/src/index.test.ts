import { describe, expect, it } from 'vitest';
import * as freshen from './index.js';

describe('public API surface', () => {
  it('exposes a version', () => {
    expect(freshen.VERSION).toBe('1.0.0-rc.1');
  });

  it('exports the core symbols', () => {
    for (const name of [
      'Cache',
      'Key',
      'KeyPrefix',
      'ValueResult',
      'CacheReadState',
      'SyncMode',
      'CallableLoader',
      'DefaultJitter',
      'MemoryStore',
      'InProcessLock',
      'InvalidateEvent',
      'InvalidateExactEvent',
      'RefreshEvent',
      'InvalidArgumentError',
      'MissingValueError',
      'AsyncDispatcherError',
    ]) {
      expect(freshen, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it('an end-to-end SWR read works from the barrel', async () => {
    const cache = new freshen.Cache<string>({ loader: () => 'hello', hardTtlSec: 60 });
    const r = await cache.get(new freshen.Key('greeting', 'en', 'default'));
    expect(r.value()).toBe('hello');
  });
});
