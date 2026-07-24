// Tests for: src/judge/bar_exam.ts against docs/spec/03-judge.md §6 (the bar exam, golden-sample
// drift, constitutional seating) and .program/invariants.yaml INV-001. SEED-03 deliverable 6
// acceptance:
//   - a DELIBERATELY DEGRADED judge (wrong rulings OR a mutated prompt hash) FAILS seating;
//   - a faithful judge PASSES on a fixture case-law set;
//   - identical code reports NO golden-sample drift; a judge that flips a fixture verdict DOES;
//   - seating identity round-trips through JudgeSeat/judgeSeatHash and the machine produces a
//     PROPOSED manifest diff, never a .program/ write.
//
// The FAITHFUL candidate here is the shipped deterministic import-boundary judge
// (src/judge/deterministic/imports.ts) used as a stable oracle: the bar exam runs a Judge's
// BEHAVIOUR under a claimed seat identity, and does not care whether that behaviour comes from a
// model or a rule. The DEGRADED candidates are fakes that return wrong rulings.

import { describe, expect, it } from 'vitest';

import {
  isViolation,
  parseAssertionId,
  parseCitation,
  parseJudgeId,
  parsePathGlob,
  parsePrecedentId,
  parsePromptHash,
  parseRepoPath,
  sealEvidence,
  unwrap,
  judgeSeatHash,
  type AssertionClass,
  type Hunk,
  type Judge,
  type JudgeSeat,
  type SealedEvidence,
  type Verdict,
} from '../../src/core/index.js';
import { judgeImportBoundary } from '../../src/judge/deterministic/imports.js';
import {
  SeatingBlockedError,
  checkGoldenDrift,
  compareRuling,
  proposeSeating,
  runBarExam,
  seatingRoundTrips,
  tallyVerdicts,
  toBarExamCase,
  unifiedDiff,
  validateExpectedRuling,
  type BarExamCase,
  type GoldenSample,
} from '../../src/judge/bar_exam.js';

// ---------------------------------------------------------------------------
// Fixtures — sealed cases and their settled rulings
// ---------------------------------------------------------------------------

const glob = (s: string) => unwrap(parsePathGlob(s));
const rp = (s: string) => unwrap(parseRepoPath(s));
const INV005 = unwrap(parseAssertionId('INV-005'));

function hunk(path: string, newStart: number, lines: readonly string[]): Hunk {
  return {
    path: rp(path),
    oldStart: newStart,
    oldLines: 0,
    newStart,
    newLines: lines.filter((l) => !l.startsWith('-')).length,
    text: lines.join('\n'),
  };
}

/** A real seal (test is non-blind). The candidate judge cannot tell a fixture bundle from a live one. */
function sealCase(klass: AssertionClass, hunks: readonly Hunk[]): SealedEvidence {
  return unwrap(
    sealEvidence({
      assertion: {
        id: INV005,
        statement: 'Engine core imports no forge-specific APIs; GitHub access lives in adapters/',
        class: klass,
        scope: [glob('src/core/**')],
      },
      charterExcerpt: 'fixture charter excerpt',
      hunks,
      ring: 'hunk' as const,
      precedent: null,
    }),
  );
}

const CASE_BREACH = sealCase('dependency', [
  hunk('src/core/http.ts', 1, [`+import { Octokit } from '@octokit/rest';`]),
]);
const CASE_GRAZES = sealCase('dependency', [
  hunk('src/core/http.ts', 1, [`+import type { Octokit } from '@octokit/rest';`]),
]);
const CASE_ALIGNED = sealCase('dependency', [hunk('src/core/http.ts', 1, [`+const x = 1;`])]);
const CASE_ABSTAIN = sealCase('boundary', [hunk('src/core/http.ts', 1, [`+const x = 1;`])]);

/** The settled case-law set. Each ruling is what the faithful import-boundary judge decides. */
const CORPUS: readonly BarExamCase[] = [
  { id: 'PRE-001', evidence: CASE_BREACH, expected: { verdict: 'drift', severity: 'breach' } },
  { id: 'PRE-002', evidence: CASE_GRAZES, expected: { verdict: 'drift', severity: 'grazes' } },
  { id: 'PRE-003', evidence: CASE_ALIGNED, expected: { verdict: 'aligned' } },
  { id: 'PRE-004', evidence: CASE_ABSTAIN, expected: { verdict: 'abstain' } },
];

const CANDIDATE: JudgeSeat = {
  id: unwrap(parseJudgeId('invariant-judge')),
  model: 'claude-opus-4-8',
  prompt: unwrap(parsePromptHash(`sha256:${'a'.repeat(64)}`)),
};

const MANIFEST = ['schema_version: 0.1.0', 'watermark:', '  last_walked: null', '  last_epoch: e0', 'judges: []', ''].join(
  '\n',
);

/** The faithful judge under test: the shipped deterministic oracle. */
const faithful: Judge = judgeImportBoundary;

/** Degraded: rules `aligned` on everything, so every violation and abstention is wrong. */
const alwaysAligned: Judge = (ev) => ({ assertion: ev.bundle.assertion.id, verdict: 'aligned' });

// ---------------------------------------------------------------------------
// The bar exam gate (spec 03 §6)
// ---------------------------------------------------------------------------

describe('the bar exam blocks seating on any mismatch (spec 03 §6)', () => {
  it('a FAITHFUL judge matches every settled case and is allowed to sit', async () => {
    const report = await runBarExam(CANDIDATE, faithful, CORPUS);
    expect(report.total).toBe(4);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(4);
    expect(report.seatingAllowed).toBe(true);
    expect(report.seatHash).toBe(unwrap(judgeSeatHash(CANDIDATE)));
    expect(report.results.every((r) => r.agrees)).toBe(true);
  });

  it('a DEGRADED judge (wrong rulings) fails cases and is refused seating', async () => {
    const report = await runBarExam(CANDIDATE, alwaysAligned, CORPUS);
    // PRE-003 (aligned) still matches; the two drifts and the abstain do not.
    expect(report.failed).toBe(3);
    expect(report.seatingAllowed).toBe(false);
    const failedIds = report.results.filter((r) => !r.agrees).map((r) => r.caseId).sort();
    expect(failedIds).toEqual(['PRE-001', 'PRE-002', 'PRE-004']);
    // Every mismatch names exactly one reason.
    expect(report.results.find((r) => r.caseId === 'PRE-001')?.mismatch).toEqual({
      field: 'verdict',
      expected: 'drift',
      actual: 'aligned',
    });
    expect(() => proposeSeating(MANIFEST, CANDIDATE, report)).toThrow(SeatingBlockedError);
  });

  it('a wrong SEVERITY (right verdict kind) is still a mismatch — severity is part of the ruling (ADR-0005)', async () => {
    // Rules `drift/entrenches` where the corpus settled `drift/breach` and `drift/grazes`.
    const wrongSeverity: Judge = (ev) => {
      const v = judgeImportBoundary(ev);
      if (isViolation(v)) return { ...v, severity: 'entrenches' };
      return v;
    };
    const report = await runBarExam(CANDIDATE, wrongSeverity, CORPUS);
    expect(report.seatingAllowed).toBe(false);
    const pre001 = report.results.find((r) => r.caseId === 'PRE-001');
    expect(pre001?.mismatch).toEqual({ field: 'severity', expected: 'breach', actual: 'entrenches' });
  });

  it('a MUTATED PROMPT HASH is a different judge: its passing report cannot seat the original, and vice versa', async () => {
    const mutated: JudgeSeat = { ...CANDIDATE, prompt: unwrap(parsePromptHash(`sha256:${'b'.repeat(64)}`)) };
    // A change to the prompt hash changes the seat identity (spec 03 §6).
    expect(unwrap(judgeSeatHash(mutated))).not.toBe(unwrap(judgeSeatHash(CANDIDATE)));

    // Even a report that PASSED for `mutated` may not be spent seating `CANDIDATE`: the passing
    // run authorises exactly the (id, model, prompt) it examined.
    const mutatedReport = await runBarExam(mutated, faithful, CORPUS);
    expect(mutatedReport.seatingAllowed).toBe(true);
    expect(() => proposeSeating(MANIFEST, CANDIDATE, mutatedReport)).toThrow(SeatingBlockedError);
  });

  it('an EMPTY corpus never authorises seating — a run that examined nothing has not passed', async () => {
    const report = await runBarExam(CANDIDATE, faithful, []);
    expect(report.total).toBe(0);
    expect(report.seatingAllowed).toBe(false);
    expect(() => proposeSeating(MANIFEST, CANDIDATE, report)).toThrow(SeatingBlockedError);
  });

  it('rejects a malformed corpus rather than passing a judge that agrees with an underspecified ruling', async () => {
    const malformed: readonly BarExamCase[] = [
      { id: 'PRE-009', evidence: CASE_BREACH, expected: { verdict: 'drift' } }, // no severity
    ];
    await expect(runBarExam(CANDIDATE, faithful, malformed)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Constitutional seating (spec 03 §6, INV-001)
// ---------------------------------------------------------------------------

describe('seating produces a PROPOSED manifest diff and never writes .program/ (INV-001)', () => {
  it('a passing bar exam yields a seating diff that adds the candidate and round-trips its identity', async () => {
    const report = await runBarExam(CANDIDATE, faithful, CORPUS);
    const proposal = proposeSeating(MANIFEST, CANDIDATE, report);

    expect(proposal.seatHash).toBe(unwrap(judgeSeatHash(CANDIDATE)));
    expect(proposal.diff).toContain('--- a/.program/manifest.yaml');
    expect(proposal.diff).toContain('+++ b/.program/manifest.yaml');
    expect(proposal.diff).toMatch(/^@@ .* @@$/m);
    expect(proposal.diff).toContain('id: invariant-judge');
    expect(proposal.diff).toContain('model: claude-opus-4-8');
    expect(proposal.diff).toContain(`prompt: sha256:${'a'.repeat(64)}`);
    // The added lines are additions in the diff.
    expect(proposal.diff).toMatch(/^\+.*invariant-judge/m);
    expect(proposal.rationale).toContain('spec 03 §6');
    expect(proposal.rationale).toContain('INV-001');

    // Identity survives encode → decode: seating and reading back name the same judge (spec 03 §6).
    expect(seatingRoundTrips(MANIFEST, CANDIDATE)).toBe(true);
  });

  it('refuses to seat over an already-seated id', async () => {
    const seated = ['schema_version: 0.1.0', 'watermark:', '  last_walked: null', '  last_epoch: e0', 'judges:', '  - id: invariant-judge', '    model: claude-opus-4-8', `    prompt: sha256:${'a'.repeat(64)}`, ''].join('\n');
    const report = await runBarExam(CANDIDATE, faithful, CORPUS);
    expect(() => proposeSeating(seated, CANDIDATE, report)).toThrow(SeatingBlockedError);
  });
});

// ---------------------------------------------------------------------------
// Golden-sample drift — the observer is observed (spec 03 §6)
// ---------------------------------------------------------------------------

describe('golden-sample drift detection', () => {
  const SAMPLE: GoldenSample = {
    id: 'golden-1',
    cases: CORPUS.map((c) => ({ id: c.id, evidence: c.evidence, recorded: c.expected.verdict })),
  };

  it('identical code re-judging the same evidence reports NO drift', async () => {
    const report = await checkGoldenDrift(SAMPLE, faithful);
    expect(report.distributionShifted).toBe(false);
    expect(report.caseFlips).toEqual([]);
    expect(report.drifted).toBe(false);
    expect(report.current).toEqual(report.baseline);
  });

  it('a judge that flips a fixture verdict reports drift, naming the shifted kinds and the case', async () => {
    // Flips the breach case (drift → aligned); every other case is judged faithfully.
    const flipOne: Judge = (ev) => {
      const v = judgeImportBoundary(ev);
      if (v.verdict === 'drift' && isViolation(v) && v.severity === 'breach') {
        return { assertion: ev.bundle.assertion.id, verdict: 'aligned' };
      }
      return v;
    };
    const report = await checkGoldenDrift(SAMPLE, flipOne);
    expect(report.drifted).toBe(true);
    expect(report.distributionShifted).toBe(true);
    expect([...report.shiftedKinds].sort()).toEqual(['aligned', 'drift']);
    expect(report.caseFlips).toEqual([{ id: 'PRE-001', recorded: 'drift', current: 'aligned' }]);
    expect(report.baseline.drift).toBe(2);
    expect(report.current.drift).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Unit-level pieces
// ---------------------------------------------------------------------------

describe('ruling comparison and corpus validation', () => {
  const cit = unwrap(parseCitation('src/core/http.ts:1'));

  it('compares regression rulings on their PRE-id (case law works by citation, spec 03 §7)', () => {
    const reg = (pre: string): Verdict => ({
      assertion: INV005,
      verdict: 'regression',
      severity: 'breach',
      evidence: [cit],
      rationale: 'reintroduces the killed pattern',
      precedent: unwrap(parsePrecedentId(pre)),
    });
    expect(
      compareRuling({ verdict: 'regression', severity: 'breach', precedent: unwrap(parsePrecedentId('PRE-007')) }, reg('PRE-007')),
    ).toBeNull();
    expect(
      compareRuling({ verdict: 'regression', severity: 'breach', precedent: unwrap(parsePrecedentId('PRE-007')) }, reg('PRE-008')),
    ).toEqual({ field: 'precedent', expected: 'PRE-007', actual: 'PRE-008' });
  });

  it('validates that a violation expectation carries severity and a regression carries a PRE-id', () => {
    expect(validateExpectedRuling({ verdict: 'drift' }).ok).toBe(false);
    expect(validateExpectedRuling({ verdict: 'regression', severity: 'breach' }).ok).toBe(false);
    expect(validateExpectedRuling({ verdict: 'aligned', severity: 'breach' }).ok).toBe(false);
    expect(validateExpectedRuling({ verdict: 'aligned' }).ok).toBe(true);
    expect(validateExpectedRuling({ verdict: 'drift', severity: 'breach' }).ok).toBe(true);
  });

  it('tallies a verdict distribution across the five kinds', () => {
    expect(tallyVerdicts(['aligned', 'aligned', 'drift', 'abstain'])).toEqual({
      aligned: 2,
      drift: 1,
      regression: 0,
      'stale-claim': 0,
      abstain: 1,
    });
  });

  it('lifts a settled case-law entry into a bar-exam case keyed by its PRE-id', () => {
    const precedent = {
      id: unwrap(parsePrecedentId('PRE-042')),
      pattern: 'reqwest inside core',
      ruling: 'killed' as const,
      evidence: ['pr#41'] as const,
    };
    const barCase = toBarExamCase({ precedent, evidence: CASE_BREACH, expected: { verdict: 'regression', severity: 'breach', precedent: precedent.id } });
    expect(barCase.id).toBe('PRE-042');
    expect(barCase.note).toBe('reqwest inside core');
    expect(barCase.evidence).toBe(CASE_BREACH);
  });

  it('renders a minimal, applyable single-hunk unified diff', () => {
    const diff = unifiedDiff('f.txt', 'a\nb\nc', 'a\nX\nc');
    expect(diff).toBe(['--- a/f.txt', '+++ b/f.txt', '@@ -1,3 +1,3 @@', ' a', '-b', '+X', ' c'].join('\n'));
    expect(unifiedDiff('f.txt', 'same', 'same')).toBe('');
  });
});
