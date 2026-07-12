import { describe, expect, it, vi } from 'vitest';
import { KeyvStore } from './keyv-store.js';
import type { KeyvLike } from './keyv-store.js';

// Byte-agnostic store (FRSH-060): Freshen hands keyv opaque packed strings.

function fakeKeyv(withIterator: boolean): KeyvLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  const base: KeyvLike = {
    get: (key) => Promise.resolve(map.get(key)),
    set: (key, value) => {
      map.set(key, value);
      return Promise.resolve(true);
    },
    delete: (key) => Promise.resolve(map.delete(key)),
  };
  if (withIterator) {
    base.iterator = async function* (): AsyncIterableIterator<[string, string]> {
      for (const [k, v] of map) {
        yield [k, v];
      }
    };
  }
  return Object.assign(base, { map });
}

describe('KeyvStore', () => {
  it('reads back what it wrote (ttl passed to keyv in ms)', async () => {
    const keyv = fakeKeyv(false);
    const setSpy = vi.spyOn(keyv, 'set');
    const store = new KeyvStore(keyv);
    await store.write('k', 'packed-v', 60);
    expect(setSpy).toHaveBeenCalledWith('k', 'packed-v', 60_000);
    expect(await store.read('k')).toBe('packed-v');
  });

  it('returns undefined for a missing key', async () => {
    expect(await new KeyvStore(fakeKeyv(false)).read('nope')).toBeUndefined();
  });

  it('deleteExact removes only the named key', async () => {
    const keyv = fakeKeyv(false);
    const store = new KeyvStore(keyv);
    await store.write('a', '1', 60);
    await store.deleteExact('a');
    expect(await store.read('a')).toBeUndefined();
  });

  it('deletePrefix drops the subtree via iterator when available', async () => {
    const keyv = fakeKeyv(true);
    const store = new KeyvStore(keyv);
    await store.write('a/b', '1', 60);
    await store.write('a/b/c', '2', 60);
    await store.write('a/bx', '3', 60);
    await store.deletePrefix('a/b');
    expect(await store.read('a/b')).toBeUndefined();
    expect(await store.read('a/b/c')).toBeUndefined();
    expect(await store.read('a/bx')).toBeDefined();
  });

  it('deletePrefix throws (degraded) when the store has no iterator', async () => {
    const store = new KeyvStore(fakeKeyv(false));
    await expect(store.deletePrefix('a/b')).rejects.toThrow(/not supported/);
  });
});
