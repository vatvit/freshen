import { describe, expect, it } from 'vitest';
import { gzipJsonCodec, v8Codec } from './codec.js';
import { Cache } from './cache.js';
import { Key } from './key.js';
import { MemoryStore } from './store/memory-store.js';
import { RedisDriver } from './driver/redis-driver.js';
import { RedisLock } from './lock/redis-lock.js';
import { FakeRedis } from './testing/fake-redis.js';
import type { Clock } from './clock.js';
import type { Jitter } from './ports.js';

const noJitter: Jitter = { apply: (ttl) => ttl };
const clock: Clock = { now: () => 1000 };
const KEY = new Key('doc', 'body', 'sku-1');

describe('v8Codec (default)', () => {
  it('preserves rich types that JSON would corrupt (Date/Map/Set/bigint/typed-array)', () => {
    const codec = v8Codec();
    const value = {
      when: new Date('2026-07-12T00:00:00.000Z'),
      tags: new Map<string, number>([['a', 1], ['b', 2]]),
      seen: new Set([1, 2, 3]),
      big: 9007199254740993n,
      bytes: new Uint8Array([1, 2, 3]),
      nested: { list: [null, { x: 1 }] },
    };
    const out = codec.decode(codec.encode(value)) as typeof value;
    expect(out.when).toBeInstanceOf(Date);
    expect(out.when.getTime()).toBe(value.when.getTime());
    expect(out.tags).toBeInstanceOf(Map);
    expect(out.tags.get('b')).toBe(2);
    expect(out.seen).toBeInstanceOf(Set);
    expect(out.seen.has(3)).toBe(true);
    expect(out.big).toBe(9007199254740993n);
    expect(out.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(out.nested).toEqual(value.nested);
  });

  it('stores small payloads raw and large ones gzipped (marker r/g), both decodable', () => {
    const codec = v8Codec({ gzipThresholdBytes: 64 });
    const small = codec.encode('hi');
    const large = codec.encode('a'.repeat(5000));
    expect(small[0]).toBe('r');
    expect(large[0]).toBe('g');
    expect(codec.decode(small)).toBe('hi');
    expect(codec.decode(large)).toBe('a'.repeat(5000));
  });

  it('materially shrinks a compressible payload', () => {
    const codec = v8Codec({ gzipThresholdBytes: 64 });
    const raw = 'a'.repeat(20000);
    const encoded = codec.encode(raw);
    // gzipped base64 of 20k identical bytes is far smaller than the raw string.
    expect(encoded.length).toBeLessThan(raw.length / 2);
  });

  it('bounds a decompression bomb via maxDecodedBytes', () => {
    const encoder = v8Codec({ gzipThresholdBytes: 1 }); // force gzip
    const packed = encoder.encode('a'.repeat(10000));
    const tight = v8Codec({ maxDecodedBytes: 128 });
    expect(() => tight.decode(packed)).toThrow();
  });

  it('throws on garbage input (a decode failure the cache turns into a miss)', () => {
    const codec = v8Codec();
    expect(() => codec.decode('g!!!not-base64-gzip')).toThrow();
  });
});

describe('gzipJsonCodec', () => {
  it('round-trips a JSON-compatible value', () => {
    const codec = gzipJsonCodec();
    const value = { text: 'x'.repeat(5000) };
    const encoded = codec.encode(value);
    expect(typeof encoded).toBe('string');
    expect(codec.decode(encoded)).toEqual(value);
  });

  it('produces a smaller payload for a compressible value', () => {
    const codec = gzipJsonCodec();
    const encoded = codec.encode('a'.repeat(10000));
    expect(encoded.length).toBeLessThan(10000);
  });
});

describe('byte-agnostic storage — dev == prod fidelity (FRSH-060 audit #3)', () => {
  const WHEN = new Date('2026-01-02T03:04:05.000Z');
  const richLoader = (): { when: Date; tags: Map<string, number>; big: bigint } => ({
    when: WHEN,
    tags: new Map([['x', 1]]),
    big: 42n,
  });

  it('a Date/Map/bigint value round-trips IDENTICALLY over MemoryStore and RedisDriver', async () => {
    const mem = new Cache({ loader: richLoader, hardTtlSec: 600, precomputeSec: 60, store: new MemoryStore(clock), jitter: noJitter, clock });
    const redis = new FakeRedis();
    const red = new Cache({
      loader: richLoader,
      hardTtlSec: 600,
      precomputeSec: 60,
      store: new RedisDriver(redis),
      lock: new RedisLock(redis),
      jitter: noJitter,
      clock,
    });

    const fromMem = (await mem.get(KEY)).value();
    const fromRedis = (await red.get(KEY)).value();

    // No dev/prod skew: both backends yield the same live types (not string/{} corruption).
    for (const out of [fromMem, fromRedis]) {
      expect(out.when).toBeInstanceOf(Date);
      expect(out.when.getTime()).toBe(WHEN.getTime());
      expect(out.tags).toBeInstanceOf(Map);
      expect(out.tags.get('x')).toBe(1);
      expect(out.big).toBe(42n);
    }
  });

  it('a corrupt/undecodable stored payload is treated as a miss (fail-open) → recompute', async () => {
    const inner = new MemoryStore(clock);
    const cache = new Cache<string>({ loader: () => 'recomputed', hardTtlSec: 600, precomputeSec: 60, store: inner, jitter: noJitter, clock });
    await inner.write(KEY.toString(), 'not-a-valid-packed-envelope', 600);
    expect((await cache.get(KEY)).value()).toBe('recomputed');
  });
});
