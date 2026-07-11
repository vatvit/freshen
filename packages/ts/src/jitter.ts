import type { Key } from './key.js';
import type { Jitter } from './ports.js';

/**
 * CRC-32 (IEEE 802.3, polynomial 0xEDB88320) over a string's UTF-8 bytes,
 * returned as an unsigned 32-bit integer — byte-for-byte identical to PHP's
 * `crc32()` on a 64-bit build (PARITY §9). Table built once, lazily.
 */
let crcTable: Uint32Array | undefined;

/**
 * CRC-32/ISO-HDLC over UTF-8 bytes → unsigned 32-bit. Exported for the parity
 * anchor test (canonical check value `crc32("123456789") === 0xCBF43926`, which
 * PHP's `crc32` also produces). Not part of the public API.
 * @internal
 */
export function crc32(str: string): number {
  if (crcTable === undefined) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    crcTable = table;
  }
  const bytes = Buffer.from(str, 'utf8');
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Deterministic per-key TTL jitter (PARITY §9): same key ⇒ same TTL, symmetric in
 * `[ttl−δ, ttl+δ]` with `δ = floor(ttl·percent/100)`, floored to ≥ 1, and a δ==0
 * short-circuit. Spreads sibling-key TTLs so they do not co-expire (a stampede
 * cause). Default `percent = 15`.
 */
export class DefaultJitter implements Jitter {
  constructor(private readonly percent: number = 15) {}

  apply(ttlSec: number, key: Key): number {
    const delta = Math.max(0, Math.floor((ttlSec * this.percent) / 100));
    if (delta === 0) {
      return Math.max(1, ttlSec);
    }
    const h = crc32(key.toString());
    const offset = (h % (2 * delta + 1)) - delta;
    return Math.max(1, ttlSec + offset);
  }
}
