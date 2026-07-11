import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Key, KeyPrefix, rawurlencode } from './key.js';

/**
 * Two layers, mirroring the PHP KeyTest (PARITY §6):
 *  1) the frozen cross-language oracle (key-parity.json) reproduced byte-for-byte;
 *  2) independent literal assertions that don't derive from the generated fixture.
 */

interface ParityCase {
  name: string;
  domain: string;
  facet: string;
  id: string | number | Record<string, unknown> | unknown[];
  schemaVersion: string | null;
  locale: string | null;
  key: string;
  prefix: string;
  idString: string;
  segments: string[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../tests/fixtures/key-parity.json', import.meta.url), 'utf8'),
) as ParityCase[];

describe('Key — frozen parity oracle', () => {
  it.each(fixture.map((c) => [c.name, c] as const))('reproduces %s byte-for-byte', (_name, c) => {
    const key = new Key(c.domain, c.facet, c.id, c.schemaVersion, c.locale);
    expect(key.toString()).toBe(c.key);
    expect(String(key)).toBe(c.key);
    expect(key.prefixString()).toBe(c.prefix);
    expect(key.idString()).toBe(c.idString);
    expect(key.segments()).toEqual(c.segments);
  });
});

describe('Key — literal assertions', () => {
  it('builds a simple key and exposes accessors', () => {
    const key = new Key('product', 'top-sellers', 42);
    expect(key.toString()).toBe('product/top-sellers/42');
    expect(key.prefixString()).toBe('product/top-sellers');
    expect(key.domain()).toBe('product');
    expect(key.facet()).toBe('top-sellers');
    expect(key.schemaVersion()).toBeNull();
    expect(key.locale()).toBeNull();
    expect(key.idString()).toBe('42');
    expect(key.id()).toBe('42');
    expect(key.prefixSegments()).toEqual(['product', 'top-sellers']);
    expect(key.segments()).toEqual(['product', 'top-sellers', '42']);
  });

  it('orders schemaVersion before locale', () => {
    const key = new Key('product', 'detail', 'sku-1', 'v2', 'en_US');
    expect(key.toString()).toBe('product/detail/v2/en_US/sku-1');
    expect(key.schemaVersion()).toBe('v2');
    expect(key.locale()).toBe('en_US');
  });

  it('treats empty-string schemaVersion/locale as unset', () => {
    const key = new Key('product', 'detail', 'sku-1', '', '');
    expect(key.schemaVersion()).toBeNull();
    expect(key.locale()).toBeNull();
    expect(key.toString()).toBe('product/detail/sku-1');
  });

  it('raw-url-encodes reserved chars in the key but keeps id() raw', () => {
    const key = new Key('shop', 'items', 'a b/c');
    expect(key.toString()).toBe('shop/items/a%20b%2Fc');
    expect(key.idString()).toBe('a b/c');
  });

  it('canonicalises array ids order-independently', () => {
    const a = new Key('product', 'list', { b: 2, a: 1 });
    const b = new Key('product', 'list', { a: 1, b: 2 });
    expect(a.toString()).toBe(b.toString());
    expect(a.idString()).toBe(b.idString());
    expect(a.idString().startsWith('j:')).toBe(true);
  });

  it('canonicalises array ids recursively', () => {
    const a = new Key('p', 'f', { z: { y: 1, x: 2 }, a: 3 });
    const b = new Key('p', 'f', { a: 3, z: { x: 2, y: 1 } });
    expect(a.toString()).toBe(b.toString());
    const b64 = a.idString().slice(2);
    const json = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(json).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });

  it('returns the canonicalised array from id()', () => {
    const key = new Key('product', 'list', { b: 2, a: 1 });
    expect(key.id()).toEqual({ a: 1, b: 2 });
    expect(Object.keys(key.id() as object)).toEqual(['a', 'b']);
  });

  it.each([
    ['empty domain', '', 'facet'],
    ['whitespace domain', '   ', 'facet'],
    ['empty facet', 'domain', ''],
    ['whitespace facet', 'domain', '\t'],
  ])('rejects blank segments (%s)', (_n, domain, facet) => {
    expect(() => new Key(domain, facet, 'id')).toThrow(/non-empty/);
  });

  it('allows overriding the idStringify hook', () => {
    class HashKey extends Key {
      protected override idStringify(): string {
        return 'h:custom';
      }
    }
    const key = new HashKey('product', 'list', { b: 2, a: 1 });
    expect(key.idString()).toBe('h:custom');
  });
});

describe('rawurlencode — RFC 3986 parity with PHP', () => {
  it('encodes !*\'() but not ~', () => {
    expect(rawurlencode("a!*'()~")).toBe('a%21%2A%27%28%29~');
    expect(rawurlencode('a b/c')).toBe('a%20b%2Fc');
  });
});

describe('KeyPrefix', () => {
  it('builds an encoded prefix selector with ordered segments', () => {
    const p = new KeyPrefix('product', 'detail', 'v2', 'en_US');
    expect(p.toString()).toBe('product/detail/v2/en_US');
    expect(p.segments()).toEqual(['product', 'detail', 'v2', 'en_US']);
  });

  it('matches the subtree prefix of a Key', () => {
    const key = new Key('product', 'detail', 'sku-1', 'v2', 'en_US');
    const prefix = new KeyPrefix('product', 'detail', 'v2', 'en_US');
    expect(key.prefixString()).toBe(prefix.toString());
  });
});
