// Implements tests for: docs/adr/0005-anchored-severity.md, docs/spec/03-judge.md §4-5.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  SEVERITY_ORDINALS,
  SEVERITY_ORDINAL_BY_WEIGHT,
  SEVERITY_WEIGHT,
  SEVERITY_WEIGHTS,
  compareSeverity,
  isSeverityOrdinal,
  isSeverityWeight,
  medianSeverityOrdinal,
  parseSeverityOrdinal,
  parseSeverityWeight,
  severityOrdinal,
  severityRank,
  severityRungSpread,
  severityWeight,
  type SeverityOrdinal,
} from '../../src/core/severity.js';

describe('anchored severity (ADR-0005)', () => {
  it('maps the four ordinals to the four fixed numerics', () => {
    expect(severityWeight('grazes')).toBe(0.25);
    expect(severityWeight('bends')).toBe(0.5);
    expect(severityWeight('breach')).toBe(0.75);
    expect(severityWeight('entrenches')).toBe(1);
  });

  it('maps the four numerics back to the four ordinals', () => {
    expect(severityOrdinal(0.25)).toBe('grazes');
    expect(severityOrdinal(0.5)).toBe('bends');
    expect(severityOrdinal(0.75)).toBe('breach');
    expect(severityOrdinal(1)).toBe('entrenches');
  });

  it('round-trips in both directions for every rung', () => {
    for (const o of SEVERITY_ORDINALS) {
      expect(severityOrdinal(severityWeight(o))).toBe(o);
    }
    for (const w of SEVERITY_WEIGHTS) {
      expect(severityWeight(severityOrdinal(w))).toBe(w);
    }
  });

  it('keeps the forward and inverse maps in lockstep', () => {
    expect(Object.keys(SEVERITY_WEIGHT).sort()).toEqual([...SEVERITY_ORDINALS].sort());
    for (const o of SEVERITY_ORDINALS) {
      expect(SEVERITY_ORDINAL_BY_WEIGHT[SEVERITY_WEIGHT[o]]).toBe(o);
    }
  });

  it('ranks and compares as an ordinal scale', () => {
    expect(SEVERITY_ORDINALS.map(severityRank)).toEqual([0, 1, 2, 3]);
    expect(compareSeverity('grazes', 'entrenches')).toBe(-1);
    expect(compareSeverity('breach', 'breach')).toBe(0);
    expect(compareSeverity('entrenches', 'bends')).toBe(1);
  });
});

describe('severity parsing rejects everything outside the anchors', () => {
  it('accepts the four ordinals', () => {
    for (const o of SEVERITY_ORDINALS) {
      const r = parseSeverityOrdinal(o);
      expect(r.ok).toBe(true);
    }
  });

  it.each(['severe', 'BREACH', '', 'grazes ', 0.5, null, undefined, {}])(
    'rejects ordinal %p',
    (bad) => {
      expect(parseSeverityOrdinal(bad).ok).toBe(false);
    },
  );

  it.each([0.6, 0, 1.5, -0.25, Number.NaN, '0.5', null])('rejects weight %p', (bad) => {
    expect(parseSeverityWeight(bad).ok).toBe(false);
  });

  it('reports invalid-severity, not a generic type error, for an unanchored ordinal', () => {
    const r = parseSeverityOrdinal('catastrophic');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-severity');
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// Regression: the gate must not resolve through Object.prototype
//
// `if (!(raw in SEVERITY_WEIGHT))` admitted all eight Object.prototype member names and cast
// them to SeverityOrdinal. `severityWeight("toString")` then returned a FUNCTION typed as
// SeverityWeight, `precision_at · severity` became NaN, and `NaN >= budget` is false forever —
// a model emitting `"severity": "toString"` would permanently disarm the assertion it breached,
// with ajv the only thing left standing between it and the ledger.
// ────────────────────────────────────────────────────────────────────────────────────────

/** Every own member name of Object.prototype, enumerated rather than hand-listed. */
const OBJECT_PROTOTYPE_KEYS = Object.getOwnPropertyNames(Object.prototype);

describe('parseSeverityOrdinal is a closed-union gate, not a property lookup', () => {
  it('knows the fixture list is non-trivial', () => {
    expect(OBJECT_PROTOTYPE_KEYS).toContain('toString');
    expect(OBJECT_PROTOTYPE_KEYS).toContain('constructor');
    expect(OBJECT_PROTOTYPE_KEYS).toContain('__proto__');
    expect(OBJECT_PROTOTYPE_KEYS.length).toBeGreaterThanOrEqual(8);
  });

  it.each(OBJECT_PROTOTYPE_KEYS)('rejects the Object.prototype name %s', (key) => {
    const r = parseSeverityOrdinal(key);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-severity');
    expect(isSeverityOrdinal(key)).toBe(false);
  });

  it('rejects the same names when they arrive inside a verdict-shaped payload', () => {
    for (const key of OBJECT_PROTOTYPE_KEYS) {
      expect(parseSeverityOrdinal(key).ok).toBe(false);
    }
  });

  it('accepts exactly the four anchors and nothing else, over arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const anchored = (SEVERITY_ORDINALS as readonly string[]).includes(s);
        expect(parseSeverityOrdinal(s).ok).toBe(anchored);
        expect(isSeverityOrdinal(s)).toBe(anchored);
      }),
      { numRuns: 500 },
    );
  });

  it('never returns a value outside the four anchors when it returns ok', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constantFrom(...OBJECT_PROTOTYPE_KEYS, ...SEVERITY_ORDINALS)),
        (s) => {
          const r = parseSeverityOrdinal(s);
          if (r.ok) {
            expect(SEVERITY_ORDINALS).toContain(r.value);
            // The consequence the old gate broke: the numeric side stays a number.
            expect(typeof severityWeight(r.value)).toBe('number');
            expect(Number.isFinite(0.9 * severityWeight(r.value))).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('isSeverityWeight is the numeric twin and is equally closed', () => {
    for (const w of SEVERITY_WEIGHTS) expect(isSeverityWeight(w)).toBe(true);
    for (const w of [0, 0.6, 1.5, -0.25, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isSeverityWeight(w)).toBe(false);
    }
  });
});

describe('panel primitives (spec 03 §5)', () => {
  it('takes the middle rung on an odd panel', () => {
    const r = medianSeverityOrdinal(['grazes', 'entrenches', 'breach']);
    expect(r.ok && r.value).toBe('breach');
  });

  it('resolves an even panel toward leniency (lower middle rung)', () => {
    const r = medianSeverityOrdinal(['grazes', 'bends', 'breach', 'entrenches']);
    expect(r.ok && r.value).toBe('bends');
  });

  it('rejects an empty panel rather than inventing a rung', () => {
    expect(medianSeverityOrdinal([]).ok).toBe(false);
  });

  it('measures inter-judge disagreement as a rung spread', () => {
    expect(severityRungSpread([])).toBe(0);
    expect(severityRungSpread(['breach'])).toBe(0);
    expect(severityRungSpread(['breach', 'breach', 'breach'])).toBe(0);
    expect(severityRungSpread(['grazes', 'entrenches'])).toBe(3);
    expect(severityRungSpread(['bends', 'breach'])).toBe(1);
  });

  it('median is order-independent and always one of the samples', () => {
    const ordinal = fc.constantFrom<SeverityOrdinal>(...SEVERITY_ORDINALS);
    fc.assert(
      fc.property(fc.array(ordinal, { minLength: 1, maxLength: 9 }), (samples) => {
        const a = medianSeverityOrdinal(samples);
        const b = medianSeverityOrdinal([...samples].reverse());
        expect(a.ok && b.ok && a.value === b.value).toBe(true);
        expect(a.ok && samples.includes(a.value)).toBe(true);
      }),
    );
  });
});
