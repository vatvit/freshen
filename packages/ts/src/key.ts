import { InvalidArgumentError } from './errors.js';

/**
 * A hierarchical selector for invalidation (PARITY §3.5). A {@link Key} also
 * satisfies prefix selection (its whole subtree).
 */
export interface KeyPrefixLike {
  segments(): string[];
  toString(): string;
}

/** Composite (map/list) id value space accepted by {@link Key}. */
export type IdScalar = string | number;
export type IdComposite = { [k: string]: unknown } | unknown[];
export type KeyId = IdScalar | IdComposite;

const SEP = '/';

/**
 * RFC 3986 `rawurlencode` semantics (PARITY §6), matching PHP's `rawurlencode`
 * byte-for-byte: encode everything except the unreserved set `A-Za-z0-9-_.~`.
 *
 * `encodeURIComponent` already leaves `-_.~` and alphanumerics literal, but it
 * additionally leaves `!*'()` literal — which `rawurlencode` encodes. So we
 * percent-encode those four-plus characters afterwards to reach parity.
 */
export function rawurlencode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Base64url (no padding) of a UTF-8 string — matches PHP base64 + `+/`→`-_` + rtrim `=`. */
function base64url(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function isPlainObject(v: unknown): v is { [k: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Canonicalise a composite id: sort object keys (recursively, deep) so logically
 * equal maps produce identical tokens regardless of insertion order. Arrays keep
 * their order (they are ordered by definition). Mirrors PHP `normalizeParams`
 * (recursive `ksort`).
 */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(canonicalize);
  }
  if (isPlainObject(v)) {
    const out: { [k: string]: unknown } = {};
    for (const k of Object.keys(v).sort()) {
      out[k] = canonicalize(v[k]);
    }
    return out;
  }
  return v;
}

/**
 * An immutable structured cache key: `domain / facet [ / schemaVersion ] [ /
 * locale ] / idString` (PARITY §6). Reproduces the frozen cross-language oracle
 * (`packages/php/tests/fixtures/key-parity.json`) byte-for-byte.
 */
export class Key implements KeyPrefixLike {
  private readonly _domain: string;
  private readonly _facet: string;
  private readonly _schemaVersion: string | null;
  private readonly _locale: string | null;
  private readonly _idRaw: string | IdComposite;
  private readonly _idStr: string;
  private readonly _prefixSegments: string[];
  private readonly _fullSegments: string[];
  private readonly _prefixStr: string;
  private readonly _keyStr: string;

  constructor(
    domain: string,
    facet: string,
    id: KeyId,
    schemaVersion: string | null = null,
    locale: string | null = null,
  ) {
    this._domain = this.norm(domain);
    this._facet = this.norm(facet);
    this._schemaVersion =
      schemaVersion !== null && schemaVersion !== '' ? this.norm(schemaVersion) : null;
    this._locale = locale !== null && locale !== '' ? this.norm(locale) : null;

    if (typeof id === 'object' && id !== null) {
      const canonical = canonicalize(id) as IdComposite;
      this._idRaw = canonical;
      this._idStr = this.idStringify(canonical);
    } else {
      // scalar: string used as-is; int coerced to its decimal string.
      this._idRaw = String(id);
      this._idStr = String(id);
    }

    this._prefixSegments = [this._domain, this._facet];
    if (this._schemaVersion !== null) {
      this._prefixSegments.push(this._schemaVersion);
    }
    if (this._locale !== null) {
      this._prefixSegments.push(this._locale);
    }
    this._fullSegments = [...this._prefixSegments, this._idStr];

    this._prefixStr = this._prefixSegments.map((seg) => rawurlencode(seg)).join(SEP);
    this._keyStr = this._prefixStr + SEP + rawurlencode(this._idStr);
  }

  /** Storage-ready key: `prefix/idString`. */
  toString(): string {
    return this._keyStr;
  }

  domain(): string {
    return this._domain;
  }

  facet(): string {
    return this._facet;
  }

  schemaVersion(): string | null {
    return this._schemaVersion;
  }

  locale(): string | null {
    return this._locale;
  }

  /** Original id as provided; arrays canonicalised (deep key-sorted). */
  id(): string | IdComposite {
    return this._idRaw;
  }

  /** Deterministic, separator-safe id token. */
  idString(): string {
    return this._idStr;
  }

  /** Encoded `domain/facet[/schema][/locale]`. */
  prefixString(): string {
    return this._prefixStr;
  }

  /** `[domain, facet, (schema), (locale), idString]`. */
  segments(): string[] {
    return [...this._fullSegments];
  }

  /** `[domain, facet, (schema), (locale)]`. */
  prefixSegments(): string[] {
    return [...this._prefixSegments];
  }

  /**
   * Convert a composite (canonicalised) id to a deterministic, separator-safe
   * token. Default scheme: canonical JSON (unescaped unicode & slashes) →
   * base64url (no padding) → `j:` prefix. Stable & deterministic but not required
   * to be reversible. Override in a subclass to change the scheme (e.g.
   * `'h:' + sha256(...)`) — an on-the-wire key change, so a consumer decision
   * (PARITY §6 extensibility), not a parity concern.
   */
  protected idStringify(id: IdComposite): string {
    // JSON.stringify leaves unicode & `/` literal by default — matching PHP's
    // JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES. Keys are pre-sorted by
    // canonicalize(), so serialisation order is deterministic.
    return 'j:' + base64url(JSON.stringify(id));
  }

  private norm(s: string): string {
    const t = s.trim();
    if (t === '') {
      throw new InvalidArgumentError('Key segment must be non-empty.');
    }
    return t;
  }
}

/**
 * A concrete hierarchical prefix selector — `domain/facet[/schema][/locale]` with
 * no id (PARITY §3.5). PHP ships only the interface; TS ships this default for
 * ergonomics. Used to invalidate a whole subtree.
 */
export class KeyPrefix implements KeyPrefixLike {
  private readonly _segments: string[];
  private readonly _str: string;

  constructor(
    domain: string,
    facet: string,
    schemaVersion: string | null = null,
    locale: string | null = null,
  ) {
    const segs = [this.norm(domain), this.norm(facet)];
    if (schemaVersion !== null && schemaVersion !== '') {
      segs.push(this.norm(schemaVersion));
    }
    if (locale !== null && locale !== '') {
      segs.push(this.norm(locale));
    }
    this._segments = segs;
    this._str = segs.map((seg) => rawurlencode(seg)).join(SEP);
  }

  segments(): string[] {
    return [...this._segments];
  }

  toString(): string {
    return this._str;
  }

  private norm(s: string): string {
    const t = s.trim();
    if (t === '') {
      throw new InvalidArgumentError('Key segment must be non-empty.');
    }
    return t;
  }
}
