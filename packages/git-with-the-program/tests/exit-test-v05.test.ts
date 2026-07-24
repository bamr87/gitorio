// THE SEED-03 EXIT TEST — v0.5, "the bench".
//
// seeds/SEED-03-judge-harness.md, Acceptance:
//   - Blindness test: feeding author or accumulator data to the assembler fails to compile / raises.
//   - Contract tests: uncited violation rejected; regression verdict without PRE-id rejected;
//     severity outside the four anchors rejected.
//   - Bar exam: a deliberately degraded prompt fails seating; the shipped prompt passes on a
//     fixture case-law set.
//
// This file asserts the whole SEED-03 acceptance as ONE runnable proof, over the modules the build
// agents shipped (src/core, src/evidence, src/judge) — it does not reimplement them. The reusable
// bench (fixtures, fake ModelClients, seats, corpus) lives in `scripts/demo-v05.ts` and is imported
// here, the same way `tests/exit-test-v0.test.ts` imports its pipeline from `scripts/demo-v0.ts`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  NETWORK-FREE (SEED-03 constraint 8): every LLM path runs through an injected FAKE ModelClient
//  returning canned YAML; nothing here constructs a real client or makes a request.
//
//  THIS REPOSITORY IS NEVER WRITTEN (constraint 6, INV-001): the bench is pure — no git write, no
//  `.program/` write, no fs write into the repo. The final section proves `.program/` stayed clean
//  and no ledger ref was created.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// This is a NON-blind test file (under tests/, not src/judge or src/evidence), so it may freely
// import the core barrel and deep-import the sentencing branch — that is exactly how it obtains an
// ActorId / Surprise to PROVE they cannot enter an evidence bundle (the counter-test that keeps the
// blindness proofs from passing vacuously).

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertBlind,
  BlindnessBreach,
  decodeVerdict,
  isViolation,
  judgeSeatHash,
  parseCommitSha,
  parseCommitterTime,
  parseSeverityOrdinal,
  precedentView,
  sealEvidence,
  unwrap,
  widenContextRing,
  type AccumulatorState,
  type ActorId,
  type AssertionView,
  type ChangeRef,
  type ChangeSource,
  type Hunk,
  type IsBlind,
  type Proof,
  type Surprise,
} from '../src/core/index.js';
// Deep import of the sentencing branch is legal from a NON-blind test — the vacuity counter-test.
import { actorId, surprise } from '../src/core/sentencing.js';
import {
  INITIAL_RING,
  assembleEvidence,
  escalateEvidence,
  type AssembleRequest,
  type EvidenceSeal,
} from '../src/evidence/assembler.js';
import { modelInvariantJudge } from '../src/judge/model/invariant_judge.js';
import {
  SeatingBlockedError,
  proposeSeating,
  runBarExam,
  seatingRoundTrips,
  validateExpectedRuling,
} from '../src/judge/bar_exam.js';
import {
  interpretConfirmation,
  retrieveCandidates,
  runRegression,
  type RegressionConfirmer,
} from '../src/judge/regression.js';
import {
  BENCH_ASSERTION,
  DEGRADED_PROMPT,
  MANIFEST_YAML,
  SHIPPED_PROMPT,
  benchCaseById,
  benchCorpus,
  benchHunk,
  benchJudge,
  benchYaml,
  degradedPromptBenchModel,
  degradedRulingsBenchModel,
  degradedSeat,
  faithfulBenchModel,
  loadBenchCases,
  orderedModel,
  pointEvidence,
  shippedSeat,
} from '../scripts/demo-v05.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function hostGit(args: readonly string[]): string {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 0. The bench replays a real fixture case-law corpus (killed + affirmed + coincidence)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('the bar exam replays a fixture corpus of killed + affirmed + coincidence case law', () => {
  it('loads three settled precedents from tests/fixtures/ (not .program/), one of each ruling', () => {
    const cases = loadBenchCases();
    expect(cases.map((c) => String(c.precedent.id)).sort()).toEqual(['PRE-201', 'PRE-202', 'PRE-203']);
    expect(cases.map((c) => c.precedent.ruling).sort()).toEqual(['affirmed', 'coincidence', 'killed']);
  });

  it('each case carries a real sealed bundle a candidate judge cannot tell from a live one', () => {
    for (const c of loadBenchCases()) {
      expect(() => assertBlind(c.evidence.bundle)).not.toThrow();
      expect(c.evidence.hunkHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it('the corpus lifts each precedent to a settled bar-exam case keyed by its PRE-id', () => {
    const corpus = benchCorpus();
    expect(corpus.map((c) => c.id).sort()).toEqual(['PRE-201', 'PRE-202', 'PRE-203']);
    // A well-formed corpus: a violation expectation carries severity; aligned carries none.
    for (const c of corpus) expect(validateExpectedRuling(c.expected).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. BLINDNESS — feeding author or accumulator data to the assembler fails to compile / raises
//    (INV-003, ADR-0003; seeds/SEED-03 acceptance clause 1)
// ═══════════════════════════════════════════════════════════════════════════════════════════

const seal: EvidenceSeal = sealEvidence;

const REF: ChangeRef = {
  commit: unwrap(parseCommitSha('9f2c1d')),
  committerTime: unwrap(parseCommitterTime('2026-07-21T14:03:00Z')),
};

/** A blind window onto a change: its sole method returns Hunk[], which cannot carry identity. */
const benchSource: ChangeSource = {
  hunksIntersecting: async () => [
    benchHunk('src/core/http.ts', 41, ["+import { Octokit } from '@octokit/rest';"]),
    benchHunk('docs/notes.md', 5, ['+prose about the forge']), // re-scoped away by the assembler
  ],
};

function benchRequest(overrides: Partial<AssembleRequest> = {}): AssembleRequest {
  return { assertion: BENCH_ASSERTION, charter: 'why INV-005 exists', change: benchSource, ref: REF, ...overrides };
}

describe('the evidence assembler is structurally blind (INV-003, ADR-0003)', () => {
  it('assembles a sealed bundle through the real chokepoint, and assertBlind passes on it', async () => {
    const sealed = unwrap(await assembleEvidence(benchRequest(), seal));
    expect(sealed.bundle.ring).toBe(INITIAL_RING);
    // The out-of-scope docs hunk was re-scoped away; only src/core survives.
    expect(sealed.bundle.hunks.map((h) => String(h.path))).toEqual(['src/core/http.ts']);
    expect(() => assertBlind(sealed.bundle)).not.toThrow();

    const esc = await escalateEvidence(benchRequest({ ring: 'hunk' }), seal);
    expect(esc?.ring).toBe(widenContextRing('hunk'));
    expect(() => assertBlind(unwrap(esc!.sealed).bundle)).not.toThrow();
  });

  it('the request type has no author or accumulator slot — feeding one fails to COMPILE', () => {
    const who: ActorId = actorId('jane@example.com');
    const meter: Surprise = surprise(2.7);
    // @ts-expect-error - AssembleRequest has no `author` slot; identity cannot be assembled in (ADR-0003)
    const withAuthor: AssembleRequest = { ...benchRequest(), author: who };
    // @ts-expect-error - nor an `accumulator` slot; the meter is invisible to the assembler (ADR-0003)
    const withMeter: AssembleRequest = { ...benchRequest(), accumulator: meter };
    expect(withAuthor).toBeDefined();
    expect(withMeter).toBeDefined();
  });

  it('the blindness proofs are NOT vacuous: judge-facing types are blind, sentencing types are not', () => {
    type _p1 = Proof<IsBlind<AssertionView>>;
    type _p2 = Proof<IsBlind<Hunk>>;
    const positives: [_p1, _p2] = [true, true];
    expect(positives).toEqual([true, true]);

    // Negative: an author identity / the meter must NOT be blind, or the scanner passes vacuously.
    // @ts-expect-error - an ActorId must NOT be blind
    type _n1 = Proof<IsBlind<ActorId>>;
    // @ts-expect-error - accumulator state must NOT be blind
    type _n2 = Proof<IsBlind<AccumulatorState>>;
    // @ts-expect-error - the meter reading must NOT be blind
    type _n3 = Proof<IsBlind<Surprise>>;
  });

  it('the seal rejects a sentencing value in any bundle field — at COMPILE time', () => {
    // COMPILE-only: never invoked, so no runtime throw fires — tsc validates each @ts-expect-error.
    const _compileOnly = (): void => {
      const meter: Surprise = surprise(2.7);
      const who: ActorId = actorId('jane@example.com');
      // @ts-expect-error - a Surprise is not a string; the meter cannot occupy charterExcerpt (Blind<B>)
      sealEvidence({ assertion: BENCH_ASSERTION, charterExcerpt: meter, hunks: [], ring: 'hunk', precedent: null });
      // @ts-expect-error - an ActorId has no slot in a bundle; excess property + Blind<B> both reject it
      sealEvidence({ assertion: BENCH_ASSERTION, charterExcerpt: '', hunks: [], ring: 'hunk', precedent: null, author: who });
    };
    expect(typeof _compileOnly).toBe('function');
  });

  it('assertBlind RAISES on a leak smuggled in as plain data (YAML / subprocess path)', () => {
    // Author identity smuggled by a forbidden KEY name.
    const leakyByKey = {
      assertion: BENCH_ASSERTION,
      charterExcerpt: '',
      hunks: [],
      ring: 'hunk',
      precedent: null,
      author: 'jane@example.com',
    };
    expect(() => assertBlind(leakyByKey)).toThrow(BlindnessBreach);

    // A sentencing VALUE smuggled inside a hunk, under an innocent key.
    const leakyByValue = {
      assertion: BENCH_ASSERTION,
      charterExcerpt: '',
      hunks: [{ smuggled: actorId('jane@example.com') }],
      ring: 'hunk',
      precedent: null,
    };
    expect(() => assertBlind(leakyByValue)).toThrow(BlindnessBreach);
    // sealEvidence runs assertBlind BEFORE it copies anything, so it refuses the same input.
    expect(() => sealEvidence(leakyByValue as never)).toThrow(BlindnessBreach);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. CONTRACT — an uncited violation is rejected, re-prompted once, then abstained
//    (INV-004, ADR-0005; seeds/SEED-03 acceptance clause 2)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('an uncited violation from a fake model judge → rejected → one re-prompt → abstain', () => {
  it('decodeVerdict alone rejects a violation carrying no citation (no citation, no verdict)', () => {
    const decoded = decodeVerdict({
      assertion: 'INV-005',
      verdict: 'drift',
      severity: 'breach',
      rationale: 'a forge dependency slipped into core',
      // evidence deliberately omitted
    });
    expect(decoded.ok).toBe(false);
    if (decoded.ok) throw new Error('narrowing');
    expect(decoded.error.some((e) => e.code === 'uncited-violation')).toBe(true);
  });

  it('the LLM invariant judge re-prompts EXACTLY once on an uncited violation, then abstains', async () => {
    const { client, calls } = orderedModel([{ text: benchYaml.uncitedDrift }, { text: benchYaml.uncitedDrift }]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(pointEvidence());
    expect(calls).toHaveLength(2); // one re-prompt, and only one
    expect(calls[1]?.user).not.toBe(calls[0]?.user); // the second turn carries a correction
    expect(verdict.verdict).toBe('abstain'); // never forced into a call
  });

  it('accepts a corrected, cited ruling delivered on the single re-prompt', async () => {
    const { client, calls } = orderedModel([{ text: benchYaml.uncitedDrift }, { text: benchYaml.citedDrift }]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(pointEvidence());
    expect(calls).toHaveLength(2);
    expect(verdict.verdict).toBe('drift');
    if (!isViolation(verdict)) throw new Error('narrowing');
    expect(verdict.evidence.map((c) => c.source)).toEqual(['src/core/http.ts:11']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. CONTRACT — a regression verdict lacking a PRE-id is rejected (spec 03 §7; clause 2)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('a regression verdict lacking a PRE-id is rejected (case law works by citation)', () => {
  it('decodeVerdict rejects a regression with no precedent', () => {
    const decoded = decodeVerdict({
      assertion: 'INV-005',
      verdict: 'regression',
      severity: 'breach',
      evidence: ['src/core/http.ts:41'],
      rationale: 'looks like the killed pattern',
      // precedent deliberately omitted
    });
    expect(decoded.ok).toBe(false);
    if (decoded.ok) throw new Error('narrowing');
    expect(decoded.error.some((e) => e.code === 'missing-precedent')).toBe(true);
  });

  const KILLED = precedentView(benchCaseById('PRE-201').precedent);
  const REINTRO: readonly Hunk[] = [
    benchHunk('src/core/http.ts', 41, [
      "+import { Octokit } from '@octokit/rest';",
      '+// a forge client constructed inside core, bypassing the adapter port',
    ]),
  ];
  const cannedConfirmer = (record: unknown): RegressionConfirmer => ({ confirm: async () => record });

  it('retrieval surfaces the killed precedent whose pattern overlaps the reintroducing diff', () => {
    const candidates = retrieveCandidates([KILLED], REINTRO);
    expect(candidates[0]?.precedent.id).toBe('PRE-201');
  });

  it('the regression judge rejects a confirmed regression that cites no precedent', async () => {
    const noPrecedent = {
      assertion: 'INV-005',
      verdict: 'regression',
      severity: 'breach',
      evidence: ['src/core/http.ts:41'],
      rationale: 'no precedent cited',
    };
    expect(interpretConfirmation(KILLED, REINTRO, noPrecedent).kind).toBe('rejected');
    const result = await runRegression(
      { hunks: REINTRO, precedents: [KILLED] },
      { confirmer: cannedConfirmer(noPrecedent) },
    );
    expect(result.outcome.kind).toBe('rejected');
  });

  it('accepts a regression that cites the retrieved PRE-id and lands inside the shown hunks', async () => {
    const cited = {
      assertion: 'INV-005',
      verdict: 'regression',
      severity: 'breach',
      evidence: ['src/core/http.ts:41'],
      precedent: 'PRE-201',
      rationale: 'the exact killed mechanism returns',
    };
    const result = await runRegression(
      { hunks: REINTRO, precedents: [KILLED] },
      { confirmer: cannedConfirmer(cited) },
    );
    expect(result.outcome.kind).toBe('regression');
    if (result.outcome.kind !== 'regression') throw new Error('narrowing');
    expect(result.outcome.verdict.precedent).toBe('PRE-201');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4. CONTRACT — a severity outside grazes|bends|breach|entrenches is rejected
//    (ADR-0005; seeds/SEED-03 acceptance clause 2)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('a severity outside the four anchors is rejected', () => {
  it('parseSeverityOrdinal admits exactly the four anchors and nothing else', () => {
    for (const anchor of ['grazes', 'bends', 'breach', 'entrenches']) {
      expect(parseSeverityOrdinal(anchor).ok).toBe(true);
    }
    expect(parseSeverityOrdinal('catastrophic').ok).toBe(false);
    // A closed union is checked against its list, not `in` — Object.prototype names are NOT severities.
    expect(parseSeverityOrdinal('toString').ok).toBe(false);
  });

  it('decodeVerdict rejects a drift whose severity is off the four anchors', () => {
    const decoded = decodeVerdict({
      assertion: 'INV-005',
      verdict: 'drift',
      severity: 'catastrophic',
      evidence: ['src/core/http.ts:11'],
      rationale: 'x',
    });
    expect(decoded.ok).toBe(false);
    if (decoded.ok) throw new Error('narrowing');
    expect(decoded.error.some((e) => e.code === 'invalid-severity')).toBe(true);
  });

  it('the model judge re-prompts on an off-anchor severity, then abstains if it persists', async () => {
    const { client, calls } = orderedModel([{ text: benchYaml.offAnchorSeverity }, { text: benchYaml.offAnchorSeverity }]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(pointEvidence());
    expect(calls).toHaveLength(2); // the off-anchor severity was rejected, not coerced
    expect(verdict.verdict).toBe('abstain');
  });

  it('…and accepts a corrected, on-anchor severity on the single re-prompt', async () => {
    const { client, calls } = orderedModel([{ text: benchYaml.offAnchorSeverity }, { text: benchYaml.citedDrift }]);
    const verdict = await modelInvariantJudge({ client, promptTemplate: SHIPPED_PROMPT })(pointEvidence());
    expect(calls).toHaveLength(2);
    expect(verdict.verdict).toBe('drift');
    if (!isViolation(verdict)) throw new Error('narrowing');
    expect(verdict.severity).toBe('breach');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 5. BAR EXAM — the shipped prompt passes; a degraded prompt / wrong rulings fail seating
//    (spec 03 §6, INV-001; seeds/SEED-03 acceptance clause 3)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('the bar exam passes a faithful fake judge and blocks a degraded one (spec 03 §6)', () => {
  it('a FAITHFUL fake model judge (shipped prompt) matches every settled case and may sit', async () => {
    const report = await runBarExam(
      shippedSeat(),
      benchJudge(faithfulBenchModel().client, SHIPPED_PROMPT),
      benchCorpus(),
    );
    expect(report.total).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.seatingAllowed).toBe(true);
    expect(report.seatHash).toBe(unwrap(judgeSeatHash(shippedSeat())));
    expect(report.results.every((r) => r.agrees)).toBe(true);
  });

  it('the passing run yields a PROPOSED manifest diff and NEVER writes .program/ (INV-001)', async () => {
    const report = await runBarExam(
      shippedSeat(),
      benchJudge(faithfulBenchModel().client, SHIPPED_PROMPT),
      benchCorpus(),
    );
    const proposal = proposeSeating(MANIFEST_YAML, shippedSeat(), report);
    expect(proposal.seatHash).toBe(unwrap(judgeSeatHash(shippedSeat())));
    expect(proposal.diff).toContain('--- a/.program/manifest.yaml');
    expect(proposal.diff).toContain('+++ b/.program/manifest.yaml');
    expect(proposal.diff).toMatch(/^\+.*id: invariant-judge/m);
    expect(proposal.rationale).toContain('INV-001');
    // Seating and reading back name the SAME (id, model, prompt) (spec 03 §6).
    expect(seatingRoundTrips(MANIFEST_YAML, shippedSeat())).toBe(true);
  });

  it('a DEGRADED judge (wrong rulings) fails the settled cases and is refused seating', async () => {
    const report = await runBarExam(
      shippedSeat(),
      benchJudge(degradedRulingsBenchModel().client, SHIPPED_PROMPT),
      benchCorpus(),
    );
    expect(report.seatingAllowed).toBe(false);
    expect(report.failed).toBeGreaterThan(0);
    // Only the coincidence case (settled aligned) still matches an always-aligned judge.
    const passedIds = report.results.filter((r) => r.agrees).map((r) => r.caseId);
    expect(passedIds).toEqual(['PRE-203']);
    expect(() => proposeSeating(MANIFEST_YAML, shippedSeat(), report)).toThrow(SeatingBlockedError);
  });

  it('a DEGRADED PROMPT (drops "no citation, no verdict") makes the judge abstain on violations, and fails', async () => {
    const report = await runBarExam(
      degradedSeat(),
      benchJudge(degradedPromptBenchModel().client, DEGRADED_PROMPT),
      benchCorpus(),
    );
    expect(report.seatingAllowed).toBe(false);
    // The two violation cases became `abstain` via re-prompt-once-then-abstain; the compliance held.
    expect(report.results.filter((r) => r.actual.verdict === 'abstain')).toHaveLength(2);
    expect(() => proposeSeating(MANIFEST_YAML, degradedSeat(), report)).toThrow(SeatingBlockedError);
  });

  it('a MUTATED PROMPT HASH is a different judge: the shipped run cannot seat it, and it has its own identity', async () => {
    expect(unwrap(judgeSeatHash(degradedSeat()))).not.toBe(unwrap(judgeSeatHash(shippedSeat())));
    const report = await runBarExam(
      shippedSeat(),
      benchJudge(faithfulBenchModel().client, SHIPPED_PROMPT),
      benchCorpus(),
    );
    expect(report.seatingAllowed).toBe(true);
    // A passing run for the shipped judge authorises exactly the (id, model, prompt) it examined —
    // it may not be spent seating the degraded-prompt judge (seat-hash mismatch, spec 03 §6).
    expect(() => proposeSeating(MANIFEST_YAML, degradedSeat(), report)).toThrow(SeatingBlockedError);
  });

  it('an EMPTY corpus never authorises seating — a run that examined nothing has not passed', async () => {
    const report = await runBarExam(shippedSeat(), benchJudge(faithfulBenchModel().client, SHIPPED_PROMPT), []);
    expect(report.total).toBe(0);
    expect(report.seatingAllowed).toBe(false);
    expect(() => proposeSeating(MANIFEST_YAML, shippedSeat(), report)).toThrow(SeatingBlockedError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6. The bench wrote nothing to this repository (constraint 6, INV-001)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('git-with-the-program itself is untouched by the bench (INV-001, constraint 6)', () => {
  it('.program/ is clean — the machine proposes a seating diff, it does not write the constitution', () => {
    expect(hostGit(['status', '--porcelain', '--', '.program']).trim()).toBe('');
  });

  it('no ledger ref and no program ref was created — the bench is pure, it surveils nothing', () => {
    expect(hostGit(['show-ref']).includes('refs/program/')).toBe(false);
  });
});
