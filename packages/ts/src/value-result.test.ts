import { describe, expect, it } from 'vitest';
import { ValueResult } from './value-result.js';
import { MissingValueError } from './errors.js';

describe('ValueResult', () => {
  it('hit carries value + timestamps', () => {
    const r = ValueResult.hit('v', 1000, 1540);
    expect(r.isHit()).toBe(true);
    expect(r.isStale()).toBe(false);
    expect(r.isMiss()).toBe(false);
    expect(r.value()).toBe('v');
    expect(r.createdAt()).toBe(1000);
    expect(r.softExpiresAt()).toBe(1540);
  });

  it('stale carries value + timestamps', () => {
    const r = ValueResult.stale('old', 900, 1400);
    expect(r.isStale()).toBe(true);
    expect(r.isHit()).toBe(false);
    expect(r.isMiss()).toBe(false);
    expect(r.value()).toBe('old');
    expect(r.createdAt()).toBe(900);
    expect(r.softExpiresAt()).toBe(1400);
  });

  it('miss has no timestamps and reports miss', () => {
    const r = ValueResult.miss();
    expect(r.isMiss()).toBe(true);
    expect(r.isHit()).toBe(false);
    expect(r.isStale()).toBe(false);
    expect(r.createdAt()).toBeNull();
    expect(r.softExpiresAt()).toBeNull();
  });

  it('value() on a miss throws', () => {
    const r = ValueResult.miss();
    expect(() => r.value()).toThrow(MissingValueError);
  });

  it('a hit can carry a null value (cached null is a real hit)', () => {
    const r = ValueResult.hit<null>(null, 1, 2);
    expect(r.isHit()).toBe(true);
    expect(r.value()).toBeNull();
  });
});
