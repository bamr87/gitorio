// Tests for: src/judge/panel.ts — SEED-03 deliverable 4, panel mode (spec 03 §5). Acceptance:
// 3 judges split grazes/breach/breach → median breach; a high-variance split flags escalation or
// discounts effective surprise (the number is asserted).
//
// `decidePanel` is pure over the ballots, so most cases are hand-built verdicts; the sampling half
// is exercised through injected fake `Judge`s, never a real model.

import { describe, expect, it } from 'vitest';

import {
  decodeVerdict,
  isViolation,
  parseAssertionId,
  parsePathGlob,
  parseRepoPath,
  sealEvidence,
  unwrap,
  type Hunk,
  type Judge,
  type SealedEvidence,
  type SeverityOrdinal,
  type Verdict,
} from '../../src/core/index.js';
import {
  DEFAULT_PANEL_POLICY,
  decidePanel,
  majorityThreshold,
  runPanel,
  samplePanel,
  surpriseMultiplier,
} from '../../src/judge/panel.js';

const A = unwrap(parseAssertionId('INV-005'));

const mk = (raw: unknown): Verdict => unwrap(decodeVerdict(raw));

function drift(severity: SeverityOrdinal): Verdict {
  return mk({
    assertion: 'INV-005',
    verdict: 'drift',
    severity,
    evidence: ['src/core/x.ts:1-2'],
    rationale: `severity ${severity}`,
    confidence: 0.8,
  });
}
const aligned: Verdict = { assertion: A, verdict: 'aligned' };
const abstain: Verdict = { assertion: A, verdict: 'abstain' };

describe('the discount formula and majority threshold (the arguable knobs)', () => {
  it('discounts effective surprise linearly in the rung spread (Q-27)', () => {
    expect(surpriseMultiplier(0)).toBe(1); // unanimous → no discount
    expect(surpriseMultiplier(1)).toBeCloseTo(2 / 3, 12);
    expect(surpriseMultiplier(2)).toBeCloseTo(1 / 3, 12);
    expect(surpriseMultiplier(3)).toBe(0); // maximal split → fully discounted
  });

  it('needs two of three ballots to carry a disposition', () => {
    expect(majorityThreshold(3)).toBe(2);
    expect(majorityThreshold(5)).toBe(3);
    expect(DEFAULT_PANEL_POLICY.size).toBe(3);
    expect(DEFAULT_PANEL_POLICY.escalateAtSpread).toBe(3);
  });
});

describe('a violation panel takes the MEDIAN severity (spec 03 §5)', () => {
  it('splits grazes/breach/breach → median breach, spread 2, moderate discount, no escalation', () => {
    const d = unwrap(decidePanel([drift('grazes'), drift('breach'), drift('breach')]));
    expect(d.disposition).toBe('violation');
    expect(d.severity).toBe('breach');
    expect(d.spread).toBe(2);
    expect(d.escalate).toBe(false);
    expect(d.surpriseMultiplier).toBeCloseTo(1 / 3, 12);
    // The recorded verdict is a real magistrate's ballot at the median rung — evidence intact (INV-004).
    expect(isViolation(d.verdict)).toBe(true);
    if (!isViolation(d.verdict)) throw new Error('narrowing');
    expect(d.verdict.severity).toBe('breach');
    expect(d.verdict.evidence.length).toBeGreaterThan(0);
  });

  it('a high-variance split flags escalation AND fully discounts the surprise', () => {
    // grazes/grazes/entrenches: the bench splits from "barely touches" to "entrenched breach".
    const d = unwrap(decidePanel([drift('grazes'), drift('grazes'), drift('entrenches')]));
    expect(d.disposition).toBe('violation');
    expect(d.severity).toBe('grazes'); // median of {grazes, grazes, entrenches}
    expect(d.spread).toBe(3);
    expect(d.escalate).toBe(true); // bounced to a human (spec 03 §5)
    expect(d.surpriseMultiplier).toBe(0); // the asserted number
  });

  it('counts only violating ballots toward the median, and breaks an even split toward leniency', () => {
    // 2 violations + 1 abstain → violation by majority; median over {breach, entrenches} → breach (lower).
    const d = unwrap(decidePanel([drift('breach'), drift('entrenches'), abstain]));
    expect(d.disposition).toBe('violation');
    expect(d.severity).toBe('breach');
    expect(d.spread).toBe(1);
    expect(d.surpriseMultiplier).toBeCloseTo(2 / 3, 12);
    expect(d.tally).toEqual({ violation: 2, compliance: 0, abstention: 1 });
  });
});

describe('aligned and abstain are handled sanely (spec 03 §4)', () => {
  it('a compliance majority is a terse aligned, nothing to discount or escalate', () => {
    const d = unwrap(decidePanel([aligned, aligned, drift('breach')]));
    expect(d.disposition).toBe('compliance');
    expect(d.verdict).toEqual({ assertion: A, verdict: 'aligned' });
    expect(d.escalate).toBe(false);
    expect(d.surpriseMultiplier).toBe(1);
    expect(d.severity).toBeUndefined();
  });

  it('an abstain majority escalates to a human — abstain never accumulates', () => {
    const d = unwrap(decidePanel([abstain, abstain, drift('breach')]));
    expect(d.disposition).toBe('abstention');
    expect(d.verdict.verdict).toBe('abstain');
    expect(d.escalate).toBe(true);
    expect(d.surpriseMultiplier).toBe(1);
  });

  it('a three-way split with no majority escalates rather than forcing a call', () => {
    const d = unwrap(decidePanel([drift('breach'), aligned, abstain]));
    expect(d.disposition).toBe('abstention');
    expect(d.escalate).toBe(true);
    expect(d.tally).toEqual({ violation: 1, compliance: 1, abstention: 1 });
  });
});

describe('the panel rules on ONE assertion (spec 03 §1)', () => {
  it('rejects ballots that disagree on the assertion', () => {
    const other = mk({ assertion: 'INV-006', verdict: 'aligned' });
    const r = decidePanel([aligned, other, aligned]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error.code).toBe('invalid-verdict');
  });

  it('rejects an empty bench', () => {
    const r = decidePanel([]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.error.code).toBe('missing-field');
  });
});

describe('sampling is injected — no real model in the loop', () => {
  const glob = (s: string) => unwrap(parsePathGlob(s));
  const rp = (s: string) => unwrap(parseRepoPath(s));
  const sealed: SealedEvidence = unwrap(
    sealEvidence({
      assertion: {
        id: A,
        statement: 'Engine core imports no forge-specific APIs',
        class: 'dependency',
        scope: [glob('src/core/**')],
      },
      charterExcerpt: 'x',
      hunks: [
        {
          path: rp('src/core/x.ts'),
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          text: `+import { Octokit } from '@octokit/rest';`,
        } satisfies Hunk,
      ],
      ring: 'hunk' as const,
      precedent: null,
    }),
  );

  it('samplePanel runs each seated judge over the one blind bundle, in order', async () => {
    const judges: Judge[] = [
      async () => drift('grazes'),
      async () => drift('breach'),
      async () => drift('breach'),
    ];
    const ballots = await samplePanel(judges, sealed);
    expect(ballots.map((v) => (isViolation(v) ? v.severity : v.verdict))).toEqual([
      'grazes',
      'breach',
      'breach',
    ]);
  });

  it('runPanel samples then decides → median breach', async () => {
    const judges: Judge[] = [
      async () => drift('grazes'),
      async () => drift('breach'),
      async () => drift('breach'),
    ];
    const d = unwrap(await runPanel(judges, sealed));
    expect(d.severity).toBe('breach');
    expect(d.disposition).toBe('violation');
  });
});
