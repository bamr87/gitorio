// Implements tests for: docs/spec/02-ledger.md §1-2 ("hash of canonical body = filename =
// idempotency key") and docs/adr/0002-event-sourced-ledger.md.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  canonicalize,
  contentHash,
  hashBlob,
  sha256Hex,
  type CanonicalValue,
} from '../../src/core/canonical.js';
import { unwrap } from '../../src/core/result.js';

const c = (v: CanonicalValue): string => unwrap(canonicalize(v));

describe('canonical serialization: key ordering', () => {
  it('sorts object keys ascending by UTF-16 code unit', () => {
    expect(c({ b: 1, a: 2, C: 3 })).toBe('{"C":3,"a":2,"b":1}');
  });

  it('is insertion-order independent', () => {
    expect(c({ z: 1, a: 2, m: 3 })).toBe(c({ m: 3, z: 1, a: 2 }));
  });

  it('sorts nested objects too', () => {
    expect(c({ outer: { b: 1, a: 2 } })).toBe('{"outer":{"a":2,"b":1}}');
  });

  it('preserves array order — order IS significant in arrays', () => {
    expect(c([3, 1, 2])).toBe('[3,1,2]');
    expect(c([1, 2, 3])).not.toBe(c([3, 2, 1]));
  });

  it('emits no insignificant whitespace', () => {
    expect(c({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });
});

describe('canonical serialization: absence vs null', () => {
  it('DROPS undefined-valued keys', () => {
    expect(c({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(c({ a: 1, b: undefined })).toBe(c({ a: 1 }));
  });

  it('RETAINS null, which is meaningful (`supersedes: null`, spec 02 §2)', () => {
    expect(c({ supersedes: null })).toBe('{"supersedes":null}');
    expect(c({ supersedes: null })).not.toBe(c({ supersedes: undefined }));
  });
});

describe('canonical serialization: numbers', () => {
  it('normalizes -0 to 0', () => {
    expect(c(-0)).toBe('0');
    expect(c({ x: -0 })).toBe(c({ x: 0 }));
  });

  it('emits the four severity anchors identically regardless of YAML spelling', () => {
    expect(c(1.0)).toBe('1');
    expect(c(0.25)).toBe('0.25');
    expect(c(0.5)).toBe('0.5');
    expect(c(0.75)).toBe('0.75');
  });

  it('uses shortest round-trip form', () => {
    expect(c(1e21)).toBe('1e+21');
    expect(c(0.1)).toBe('0.1');
    expect(c(-1.5)).toBe('-1.5');
  });

  it('errors on non-finite numbers rather than coercing', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = canonicalize(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('non-canonical-value');
    }
  });

  it('reports a JSON pointer to the offending value', () => {
    const r = canonicalize({ a: { b: [1, Number.NaN] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.at).toBe('/a/b/1');
  });
});

describe('canonical serialization: strings and rejected shapes', () => {
  it('JSON-escapes quotes, control characters and tabs', () => {
    expect(c('a"b')).toBe('"a\\"b"');
    expect(c('a\nb')).toBe('"a\\nb"');
    expect(c('a\tb')).toBe('"a\\tb"');
    expect(c('')).toBe('"\\u0001"');
  });

  it('escapes lone surrogates well-formed', () => {
    expect(c('\ud800')).toBe('"\\ud800"');
  });

  it('rejects non-plain objects (Date, Map, class instances)', () => {
    expect(canonicalize(new Date() as unknown as CanonicalValue).ok).toBe(false);
    expect(canonicalize(new Map() as unknown as CanonicalValue).ok).toBe(false);
    class Thing {
      x = 1;
    }
    expect(canonicalize(new Thing() as unknown as CanonicalValue).ok).toBe(false);
  });

  it('accepts frozen and spread-constructed plain objects', () => {
    expect(canonicalize(Object.freeze({ a: 1 })).ok).toBe(true);
    expect(canonicalize({ ...{ a: 1 } }).ok).toBe(true);
    expect(canonicalize(Object.create(null) as CanonicalValue).ok).toBe(true);
  });
});

describe('canonical serialization is deterministic', () => {
  const jsonValue = fc.letrec<{ v: CanonicalValue }>((tie) => ({
    v: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer({ min: -1000, max: 1000 }),
      fc.string(),
      fc.array(tie('v'), { maxLength: 4 }),
      fc.dictionary(fc.string({ minLength: 1 }), tie('v'), { maxKeys: 4 }),
    ),
  })).v;

  it('produces identical bytes for identical values, twice', () => {
    fc.assert(
      fc.property(jsonValue, (v) => {
        expect(c(v)).toBe(c(v));
      }),
    );
  });

  it('produces identical bytes for a re-keyed clone of an object', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ minLength: 1 }), fc.integer(), { maxKeys: 6 }), (o) => {
        const shuffled = Object.fromEntries(Object.entries(o).reverse());
        expect(c(o)).toBe(c(shuffled));
      }),
    );
  });
});

describe('sha256 and content addressing', () => {
  it('matches the known sha256 vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the UTF-8 encoding, not UTF-16', () => {
    // sha256 over the two UTF-8 bytes 0xC3 0xA9.
    expect(sha256Hex('é')).toBe(
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
    );
  });

  it('produces a schema-shaped sha256 ref', () => {
    expect(unwrap(contentHash({ a: 1 }))).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is stable across runs (golden vector for the canonical form)', () => {
    // canonicalize({b:1,a:2}) === '{"a":2,"b":1}'
    expect(unwrap(contentHash({ b: 1, a: 2 }))).toBe(`sha256:${sha256Hex('{"a":2,"b":1}')}`);
  });

  it('gives the same hash regardless of key insertion order', () => {
    expect(unwrap(contentHash({ b: 1, a: 2 }))).toBe(unwrap(contentHash({ a: 2, b: 1 })));
  });

  it('gives the same hash for an omitted key and an explicitly-undefined one', () => {
    expect(unwrap(contentHash({ a: 1, b: undefined }))).toBe(unwrap(contentHash({ a: 1 })));
  });

  it('gives a DIFFERENT hash for null than for absence', () => {
    expect(unwrap(contentHash({ a: 1, b: null }))).not.toBe(unwrap(contentHash({ a: 1 })));
  });

  it('propagates canonicalization failures rather than hashing garbage', () => {
    expect(contentHash({ a: Number.NaN }).ok).toBe(false);
  });

  it('hashes rationale blobs to the same shape', () => {
    expect(hashBlob('Imports reqwest inside core/, bypassing the adapter boundary.')).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(hashBlob('x')).toBe(hashBlob('x'));
    expect(hashBlob('x')).not.toBe(hashBlob('y'));
  });
});
