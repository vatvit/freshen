import { describe, expect, it } from 'vitest';
import { CallableLoader, toLoader } from './loader.js';
import { Key } from './key.js';

describe('CallableLoader', () => {
  it('invokes the callable with the key and returns its result', async () => {
    const key = new Key('d', 'f', 'id');
    let received: Key | undefined;
    const loader = new CallableLoader((k) => {
      received = k;
      return 'resolved';
    });
    expect(await loader.resolve(key)).toBe('resolved');
    expect(received).toBe(key);
  });

  it('supports async functions', async () => {
    const loader = new CallableLoader(() => Promise.resolve('async-value'));
    expect(await loader.resolve(new Key('d', 'f', 'id'))).toBe('async-value');
  });
});

describe('toLoader', () => {
  it('wraps a bare function', async () => {
    const loader = toLoader(() => 'fn');
    expect(await loader.resolve(new Key('d', 'f', 'id'))).toBe('fn');
  });

  it('passes a Loader through unchanged', () => {
    const inner = new CallableLoader(() => 'x');
    expect(toLoader(inner)).toBe(inner);
  });
});
