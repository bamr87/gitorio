// Implements tests for: docs/spec/03-judge.md §4 (the output contract),
// docs/adr/0005-anchored-severity.md, INV-004 ("no citation, no verdict"),
// schemas/verdict.schema.json (both allOf clauses).

import { describe, expect, it } from 'vitest';
import {
  CITATION_PATTERN,
  decodeVerdict,
  dispositionOfKind,
  encodeVerdict,
  formatCitation,
  isViolation,
  isViolationKind,
  parseCitation,
  parseConfidence,
  VERDICT_KINDS,
  VIOLATION_VERDICT_KINDS,
} from '../../src/core/verdict.js';
import { unwrap } from '../../src/core/result.js';

const codes = (raw: unknown): string[] => {
  const r = decodeVerdict(raw);
  return r.ok ? [] : r.error.map((e) => e.code);
};

describe('citations mirror schemas/verdict.schema.json', () => {
  it('exports the schema pattern verbatim', () => {
    expect(CITATION_PATTERN.source).toBe('^.+:[0-9]+(-[0-9]+)?$');
  });

  it('parses a single-line citation', () => {
    const c = unwrap(parseCitation('core/http.rs:41'));
    expect(c).toMatchObject({ path: 'core/http.rs', startLine: 41, endLine: 41 });
    expect(formatCitation(c)).toBe('core/http.rs:41');
  });

  it("parses spec 03 §4's own span example", () => {
    const c = unwrap(parseCitation('core/http.rs:41-58'));
    expect(c).toMatchObject({ startLine: 41, endLine: 58 });
    expect(formatCitation(c)).toBe('core/http.rs:41-58');
  });

  it.each(['core/http.rs', ':41', 'core/http.rs:', 'core/http.rs:0', 'core/http.rs:58-41', 42])(
    'rejects %p',
    (bad) => {
      expect(parseCitation(bad).ok).toBe(false);
    },
  );
});

describe('confidence', () => {
  it('accepts the closed interval [0, 1]', () => {
    for (const v of [0, 0.5, 0.8, 1]) expect(parseConfidence(v).ok).toBe(true);
  });
  it.each([-0.1, 1.1, Number.NaN, '0.8', null])('rejects %p', (bad) => {
    expect(parseConfidence(bad).ok).toBe(false);
  });
});

describe('verdict kinds', () => {
  it('lists the five', () => {
    expect([...VERDICT_KINDS]).toEqual([
      'aligned',
      'drift',
      'regression',
      'stale-claim',
      'abstain',
    ]);
  });

  it('derives the three that accumulate (spec 02 §4)', () => {
    expect([...VIOLATION_VERDICT_KINDS]).toEqual(['drift', 'regression', 'stale-claim']);
    for (const k of VIOLATION_VERDICT_KINDS) expect(isViolationKind(k)).toBe(true);
    expect(isViolationKind('aligned')).toBe(false);
    expect(isViolationKind('abstain')).toBe(false);
  });

  it('maps kinds to the fold trichotomy', () => {
    expect(dispositionOfKind('drift')).toBe('violation');
    expect(dispositionOfKind('regression')).toBe('violation');
    expect(dispositionOfKind('stale-claim')).toBe('violation');
    expect(dispositionOfKind('aligned')).toBe('compliance');
    expect(dispositionOfKind('abstain')).toBe('abstention');
  });
});

describe('decoding a well-formed drift verdict (spec 03 §4 example)', () => {
  const raw = {
    assertion: 'INV-007',
    verdict: 'drift',
    severity: 'breach',
    confidence: 0.8,
    evidence: ['core/http.rs:41-58'],
    precedent: null,
    rationale: 'Imports reqwest inside core/, bypassing the adapter boundary.',
  };

  it('accepts it', () => {
    const v = unwrap(decodeVerdict(raw));
    expect(v.verdict).toBe('drift');
    expect(isViolation(v)).toBe(true);
    if (isViolation(v)) {
      expect(v.severity).toBe('breach');
      expect(v.evidence).toHaveLength(1);
      expect(v.evidence[0].startLine).toBe(41);
    }
  });

  it('round-trips through encodeVerdict', () => {
    const encoded = encodeVerdict(unwrap(decodeVerdict(raw)));
    expect(encoded['assertion']).toBe('INV-007');
    expect(encoded['severity']).toBe('breach');
    expect(encoded['evidence']).toEqual(['core/http.rs:41-58']);
  });
});

describe('INV-004 — no citation, no verdict', () => {
  it('rejects a violation with an empty evidence array', () => {
    expect(
      codes({
        assertion: 'INV-007',
        verdict: 'drift',
        severity: 'breach',
        evidence: [],
        rationale: 'x',
      }),
    ).toContain('uncited-violation');
  });

  it('rejects a violation with no evidence field at all', () => {
    expect(
      codes({ assertion: 'INV-007', verdict: 'drift', severity: 'breach', rationale: 'x' }),
    ).toContain('uncited-violation');
  });

  it('rejects a violation whose citation is not a line span', () => {
    expect(
      codes({
        assertion: 'INV-007',
        verdict: 'drift',
        severity: 'breach',
        evidence: ['core/http.rs'],
        rationale: 'x',
      }),
    ).toContain('invalid-citation');
  });

  it('rejects a violation with no rationale', () => {
    expect(
      codes({
        assertion: 'INV-007',
        verdict: 'drift',
        severity: 'breach',
        evidence: ['core/http.rs:41'],
      }),
    ).toContain('missing-field');
  });

  it('rejects severity outside the four anchors', () => {
    expect(
      codes({
        assertion: 'INV-007',
        verdict: 'drift',
        severity: 0.6,
        evidence: ['core/http.rs:41'],
        rationale: 'x',
      }),
    ).toContain('invalid-severity');
    expect(
      codes({
        assertion: 'INV-007',
        verdict: 'drift',
        severity: 'catastrophic',
        evidence: ['core/http.rs:41'],
        rationale: 'x',
      }),
    ).toContain('invalid-severity');
  });
});

describe('schemas/verdict.schema.json#/allOf/1 — regression requires a PRE-id', () => {
  const base = {
    assertion: 'INV-007',
    verdict: 'regression',
    severity: 'breach',
    evidence: ['core/http.rs:41-58'],
    rationale: 'Same mechanism as PRE-003, new clothes.',
  };

  it('rejects a regression with no precedent', () => {
    expect(codes(base)).toContain('missing-precedent');
  });

  it('rejects a regression with an explicit null precedent', () => {
    expect(codes({ ...base, precedent: null })).toContain('missing-precedent');
  });

  it('accepts a regression citing case law', () => {
    const v = unwrap(decodeVerdict({ ...base, precedent: 'PRE-003' }));
    expect(v.verdict).toBe('regression');
    if (v.verdict === 'regression') expect(v.precedent).toBe('PRE-003');
  });

  it('rejects a malformed PRE-id', () => {
    expect(codes({ ...base, precedent: 'PRE-3' })).toContain('invalid-id');
  });
});

describe('spec 03 §4 — aligned verdicts stay terse, abstain never accumulates', () => {
  it('accepts a terse aligned verdict', () => {
    const v = unwrap(decodeVerdict({ assertion: 'INV-007', verdict: 'aligned', confidence: 0.9 }));
    expect(v.verdict).toBe('aligned');
    expect(isViolation(v)).toBe(false);
  });

  it('rejects an aligned verdict carrying a rationale', () => {
    expect(codes({ assertion: 'INV-007', verdict: 'aligned', rationale: 'looks fine' })).toContain(
      'strictness',
    );
  });

  it('rejects an aligned verdict carrying a severity', () => {
    expect(codes({ assertion: 'INV-007', verdict: 'aligned', severity: 'grazes' })).toContain(
      'strictness',
    );
  });

  it('accepts an abstention that says what it lacked', () => {
    const v = unwrap(
      decodeVerdict({
        assertion: 'INV-007',
        verdict: 'abstain',
        rationale: 'scoped hunks do not show the call site',
      }),
    );
    expect(v.verdict).toBe('abstain');
  });

  it('rejects an abstention carrying a severity — it must have nowhere to be folded from', () => {
    expect(codes({ assertion: 'INV-007', verdict: 'abstain', severity: 'breach' })).toContain(
      'strictness',
    );
  });
});

describe('decoder hygiene', () => {
  it('rejects an unknown verdict kind', () => {
    expect(codes({ assertion: 'INV-007', verdict: 'suspicious' })).toContain('invalid-verdict');
  });

  it('rejects an unknown field rather than silently dropping it', () => {
    expect(codes({ assertion: 'INV-007', verdict: 'aligned', author: 'amr' })).toContain(
      'strictness',
    );
  });

  it('accumulates every problem in one pass, for `gwtp validate`', () => {
    // A bare `drift` is missing an assertion, a severity, evidence AND a rationale. All four
    // must be reported together; a missing `assertion` must not short-circuit the rest.
    const r = decodeVerdict({ verdict: 'drift' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.length).toBeGreaterThanOrEqual(4);
      expect(r.error.map((e) => e.code)).toEqual(
        expect.arrayContaining([
          'missing-field',
          'invalid-severity',
          'uncited-violation',
        ]),
      );
    }
  });

  it('rejects a non-object', () => {
    for (const bad of ['x', 42, null, []]) expect(decodeVerdict(bad).ok).toBe(false);
  });
});
