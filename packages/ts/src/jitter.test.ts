import { describe, expect, it } from 'vitest';
import { crc32, DefaultJitter } from './jitter.js';
import { Key } from './key.js';

/**
 * Property-based (determinism, bounds, floor, δ==0) + one cross-language anchor:
 * the CRC-32 formula must match PHP so ports jitter identically (PARITY §9).
 */
describe('DefaultJitter', () => {
  it('is deterministic per key', () => {
    const jitter = new DefaultJitter(15);
    const key = new Key('product', 'top-sellers', 42);
    const first = jitter.apply(600, key);
    for (let i = 0; i < 20; i++) {
      expect(jitter.apply(600, key)).toBe(first);
    }
  });

  it.each([
    [600, 15],
    [600, 50],
    [30, 10],
  ])('stays within the symmetric delta band (ttl=%i pct=%i)', (ttl, pct) => {
    const jitter = new DefaultJitter(pct);
    const delta = Math.floor((ttl * pct) / 100);
    for (let i = 0; i < 200; i++) {
      const r = jitter.apply(ttl, new Key('k', 'f', i));
      expect(r).toBeGreaterThanOrEqual(Math.max(1, ttl - delta));
      expect(r).toBeLessThanOrEqual(ttl + delta);
    }
  });

  it('spreads TTLs across keys', () => {
    const jitter = new DefaultJitter(15);
    const values = new Set<number>();
    for (let i = 0; i < 50; i++) {
      values.add(jitter.apply(600, new Key('vary', 'f', i)));
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it('floors to at least 1', () => {
    const jitter = new DefaultJitter(100);
    for (let i = 0; i < 200; i++) {
      expect(jitter.apply(2, new Key('floor', 'f', i))).toBeGreaterThanOrEqual(1);
    }
  });

  it('short-circuits when delta is 0', () => {
    const jitter = new DefaultJitter(0);
    const key = new Key('any', 'f', 'x');
    expect(jitter.apply(600, key)).toBe(600);
    expect(jitter.apply(1, key)).toBe(1);
    // ttl=6, pct=15 => floor(0.9)=0 => unchanged
    expect(new DefaultJitter(15).apply(6, new Key('tiny', 'f', 'x'))).toBe(6);
  });

  it('crc32 matches the canonical cross-language check vector', () => {
    // 0xCBF43926 — the standard CRC-32/ISO-HDLC check value, identical to PHP crc32().
    expect(crc32('123456789')).toBe(0xcbf43926);
  });

  it('applies the crc32-derived offset consistently with its own hash', () => {
    // Anchor the formula to the exported hash so the jitter and its crc stay in lockstep.
    const jitter = new DefaultJitter(15);
    const key = new Key('product', 'top-sellers', 42);
    const h = crc32(key.toString());
    const delta = 90; // floor(600*15/100)
    expect(jitter.apply(600, key)).toBe(600 + ((h % (2 * delta + 1)) - delta));
  });
});
