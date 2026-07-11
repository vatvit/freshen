import type { Key } from './key.js';
import type { Loader } from './ports.js';

/** A plain function that resolves a value for a key. */
export type LoaderFn<T = unknown> = (key: Key) => T | Promise<T>;

/** Adapts a plain function `(Key) => value` to the {@link Loader} interface. */
export class CallableLoader<T = unknown> implements Loader<T> {
  constructor(private readonly fn: LoaderFn<T>) {}

  resolve(key: Key): T | Promise<T> {
    return this.fn(key);
  }
}

/** Normalise a `Loader` or a bare function into a `Loader`. */
export function toLoader<T>(loader: Loader<T> | LoaderFn<T>): Loader<T> {
  return typeof loader === 'function' ? new CallableLoader<T>(loader) : loader;
}
