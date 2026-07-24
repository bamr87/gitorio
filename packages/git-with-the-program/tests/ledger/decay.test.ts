// Implements tests for: docs/spec/02-ledger.md §4 (`A <- A · 2^(-Δt / half_life) +
// precision_at · severity`), docs/adr/0004-committer-time-decay.md ("old events arrive
// pre-decayed; accumulators start warm, not blind, and never fire on stale news"), and
// docs/spec/04-distillation.md §7 / CLAUDE.md's stated fixture: an 8-month-old breach against a
// 90-day half-life arrives at ~15% strength.
//
// TOLERANCES ARE STATED, NOT GUESSED. Every fixture below is hand-computed in a comment from
// exact rationals, and asserted with `toBeCloseTo(expected, 12)` — absolute error below 5e-13,
// roughly four orders of magnitude looser than the ~1e-16 relative error of the two or three
// IEEE-754 operations involved, and many orders tighter than any arithmetic mistake. The one
// exception is the memorylessness property, at 10 decimal places, because it composes two
// roundings of `2 ** x` against one.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  committerTimeFromEpochMillis,
  decay,
  decayFactor,
  decayStateTo,
  emptyAccumulator,
  eventBodyFromVerdict,
  parseAccumulatorKey,
  parseBudget,
  parseCommitSha,
  parseDuration,
  parseJudgeId,
  parsePrecision,
  parseRationaleRef,
  sealEvent,
  sha256RefFromHex,
  unwrap,
  MILLIS_PER_DAY,
  REARM_FRACTION_DEFAULT,
  type AccumulatorKey,
  type AccumulatorState,
  type CommitterTime,
  type ContributingEvent,
  type EventSubject,
  type FoldKnobs,
  type JudgeRef,
  type LedgerEvent,
  type SeverityOrdinal,
  type ViolationVerdict,
} from '../../src/core/index.js';
import { decodeVerdict } from '../../src/core/index.js';
import { hashBlob } from '../../src/core/canonical.js';
import { revealSurprise, surprise, withSentencingWarrant } from '../../src/core/sentencing.js';
import { foldEvents, projectStateTo, stateFor } from '../../src/ledger/fold.js';

const WARRANT = withSentencingWarrant((w) => w);
const read = (s: AccumulatorState): number => revealSurprise(s.value, WARRANT);
const readWeight = (c: ContributingEvent): number => revealSurprise(c.residualWeight, WARRANT);

const HALF_LIFE_90D = unwrap(parseDuration('90d'));
const EIGHT_MONTHS = unwrap(parseDuration('8mo'));
const KEY = unwrap(parseAccumulatorKey('INV-007'));
const DIGEST = unwrap(sha256RefFromHex('0'.repeat(64)));
const JUDGE: JudgeRef = { kind: 'deterministic', id: unwrap(parseJudgeId('decay-fixture')) };
const RATIONALE = unwrap(parseRationaleRef(hashBlob('the full rationale text')));
const EPOCH = Date.parse('2026-01-01T00:00:00Z');

const atDay = (day: number): CommitterTime =>
  unwrap(committerTimeFromEpochMillis(EPOCH + day * MILLIS_PER_DAY));

const knobs = (budget: number, overrides: Partial<FoldKnobs> = {}): FoldKnobs => ({
  halfLife: HALF_LIFE_90D,
  budget: unwrap(parseBudget(budget)),
  precisionOverride: null,
  rearmFraction: REARM_FRACTION_DEFAULT,
  ...overrides,
});

function breach(day: number, n: number, severity: SeverityOrdinal = 'breach'): LedgerEvent {
  const verdict = unwrap(
    decodeVerdict({
      assertion: 'INV-007',
      verdict: 'drift',
      severity,
      evidence: ['src/core/http.ts:41-58'],
      rationale: 'imports a forge SDK inside core/',
    }),
  ) as ViolationVerdict;
  return unwrap(
    sealEvent(
      eventBodyFromVerdict({
        verdict,
        subject: { commit: unwrap(parseCommitSha((0x200000 + n).toString(16))) } as EventSubject,
        judge: JUDGE,
        t: atDay(day),
        precision_at: unwrap(parsePrecision(0.9)),
        rationale: RATIONALE,
      }),
    ),
  );
}

const foldOne = (events: readonly LedgerEvent[], k: FoldKnobs): AccumulatorState => {
  const s = stateFor(unwrap(foldEvents(events, k)), KEY);
  if (s === null) throw new Error('no state');
  return s;
};

// ---------------------------------------------------------------------------
// The fixture the whole design is quoted against
// ---------------------------------------------------------------------------

describe('the 8-month / 90-day fixture (spec 04 §7, CLAUDE.md)', () => {
  it('lands at 2^(-8/3) = 0.157490131236859… — 15.749% strength', () => {
    // ARITHMETIC, from the top:
    //   `mo` is pinned to exactly 30 days (Q-01), so 8mo = 240 days = 20 736 000 000 ms.
    //   half_life = 90d = 7 776 000 000 ms.
    //   Δt / half_life = 240/90 = 8/3 = 2.666… half-lives.
    //   2^(-8/3) = 1 / 2^(8/3) = 1 / (2^8)^(1/3) = 1 / 256^(1/3) = 1 / 6.349604207872797…
    //            = 0.15749013123685915…
    // That is the "~15%" the spec and CLAUDE.md quote, to four significant figures 15.75%.
    expect(EIGHT_MONTHS.millis).toBe(240 * MILLIS_PER_DAY);
    expect(HALF_LIFE_90D.millis).toBe(90 * MILLIS_PER_DAY);

    const factor = decayFactor(EIGHT_MONTHS.millis, HALF_LIFE_90D);
    expect(factor).toBeCloseTo(0.15749013123685915, 12);
    expect(factor).toBeGreaterThan(0.15);
    expect(factor).toBeLessThan(0.16);
    expect(factor * 100).toBeCloseTo(15.749013123685915, 10);
  });

  it('carries through the integrator: a breach worth 0.675 arrives worth 0.106305838584…', () => {
    // precision_at · severity = 0.9 × 0.75 (breach, ADR-0005) = 0.675 at full strength.
    // 0.675 × 2^(-8/3) = 0.675 × 0.15749013123685915… = 0.10630583858487994…
    const full = 0.9 * 0.75;
    expect(full).toBeCloseTo(0.675, 12);
    expect(decay(full, EIGHT_MONTHS.millis, HALF_LIFE_90D)).toBeCloseTo(0.10630583858487994, 12);
  });

  it('is what the FOLD produces for a backfilled breach, not just what the helper computes', () => {
    // Two breaches: one 8 months stale, one fresh. Committer-time decay (ADR-0004) means the
    // old one is already spent by the time the fold reaches the new one — "backfill is safe by
    // construction; accumulators start warm, not blind, and never fire on stale news".
    const state = foldOne([breach(0, 1), breach(240, 2)], knobs(5));
    expect(state.asOf).toBe(atDay(240));
    expect(state.violationCount).toBe(2);

    const [stale, fresh] = state.contributing;
    expect(stale?.rawWeight).toBeCloseTo(0.675, 12);
    expect(readWeight(stale!)).toBeCloseTo(0.10630583858487994, 12);
    expect(readWeight(fresh!)).toBeCloseTo(0.675, 12);

    // A = 0.675·2^(-8/3) + 0.675 = 0.10630583858487994 + 0.675 = 0.7813058385848799
    expect(read(state)).toBeCloseTo(0.7813058385848799, 12);
  });

  it('an 8-month-old breach cannot fire a budget a fresh one would', () => {
    const budget = knobs(0.5);
    expect(unwrap(foldEvents([breach(240, 1)], budget)).firings).toHaveLength(1);

    const stale = projectStateTo(foldOne([breach(0, 1)], budget), atDay(240), budget);
    expect(read(stale)).toBeCloseTo(0.10630583858487994, 12);
    expect(read(stale)).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Hand-computed fixtures along the integrator
// ---------------------------------------------------------------------------

describe('hand-computed decay fixtures (spec 02 §4)', () => {
  it('halves at one half-life and quarters at two', () => {
    expect(decayFactor(90 * MILLIS_PER_DAY, HALF_LIFE_90D)).toBeCloseTo(0.5, 12);
    expect(decayFactor(180 * MILLIS_PER_DAY, HALF_LIFE_90D)).toBeCloseTo(0.25, 12);
    // 45 days = half a half-life: 2^(-1/2) = 0.7071067811865476
    expect(decayFactor(45 * MILLIS_PER_DAY, HALF_LIFE_90D)).toBeCloseTo(0.7071067811865476, 12);
  });

  it('two breaches 90 days apart total 1.0125', () => {
    // A after e1        = 0.675
    // A after decay 90d = 0.675 × 0.5 = 0.3375
    // A after e2        = 0.3375 + 0.675 = 1.0125
    const state = foldOne([breach(0, 1), breach(90, 2)], knobs(5));
    expect(read(state)).toBeCloseTo(1.0125, 12);
    expect(state.contributing.map((c) => readWeight(c))).toEqual([
      expect.closeTo(0.3375, 12),
      expect.closeTo(0.675, 12),
    ]);
  });

  it('a third event 45 days later: 1.0125 · 2^(-1/2) + 0.9 = 1.61594561595…', () => {
    // 1.0125 × 0.7071067811865476 = 0.7159456159513796
    // + entrenches at 0.9 (1.0 × 0.9)  = 1.6159456159513796
    const state = foldOne([breach(0, 1), breach(90, 2), breach(135, 3, 'entrenches')], knobs(5));
    expect(read(state)).toBeCloseTo(1.6159456159513796, 12);
  });

  it('the residual weights always sum to the accumulated value', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 800 }), { minLength: 1, maxLength: 12 }),
        (days) => {
          const state = foldOne(
            days.map((d, i) => breach(d, i + 1)),
            knobs(50),
          );
          const sum = state.contributing.reduce((acc, c) => acc + readWeight(c), 0);
          expect(sum).toBeCloseTo(read(state), 10);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('all four anchored severities land where ADR-0005 says, undecayed', () => {
    const anchors: readonly [SeverityOrdinal, number][] = [
      ['grazes', 0.25 * 0.9],
      ['bends', 0.5 * 0.9],
      ['breach', 0.75 * 0.9],
      ['entrenches', 1 * 0.9],
    ];
    for (const [ordinal, expected] of anchors) {
      expect(read(foldOne([breach(0, 1, ordinal)], knobs(5)))).toBeCloseTo(expected, 12);
    }
  });
});

// ---------------------------------------------------------------------------
// Memorylessness — the property that makes a cached, projected state legitimate
// ---------------------------------------------------------------------------

describe('decayStateTo composition is idempotent (the exponential is memoryless)', () => {
  const warm = (value: number, at: CommitterTime): AccumulatorState => ({
    ...emptyAccumulator(KEY, DIGEST),
    value: surprise(value),
    asOf: at,
  });

  it('decaying to t1 then to t2 equals decaying straight to t2', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1000, noNaN: true }),
        fc.integer({ min: 0, max: 900 }),
        fc.integer({ min: 0, max: 900 }),
        (value, d1, d2) => {
          const start = warm(value, atDay(0));
          const t1 = atDay(d1);
          const t2 = atDay(d1 + d2);

          const twoSteps = decayStateTo(decayStateTo(start, t1, HALF_LIFE_90D), t2, HALF_LIFE_90D);
          const oneStep = decayStateTo(start, t2, HALF_LIFE_90D);

          expect(twoSteps.asOf).toBe(oneStep.asOf);
          expect(read(twoSteps)).toBeCloseTo(read(oneStep), 10);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('holds for the whole state, residual weights included', () => {
    const folded = foldOne([breach(0, 1), breach(30, 2), breach(75, 3)], knobs(50));
    const t1 = atDay(200);
    const t2 = atDay(600);

    const twoSteps = decayStateTo(decayStateTo(folded, t1, HALF_LIFE_90D), t2, HALF_LIFE_90D);
    const oneStep = decayStateTo(folded, t2, HALF_LIFE_90D);

    expect(read(twoSteps)).toBeCloseTo(read(oneStep), 10);
    twoSteps.contributing.forEach((c, i) => {
      expect(readWeight(c)).toBeCloseTo(readWeight(oneStep.contributing[i]!), 10);
    });
  });

  it('projecting a folded state forward equals folding against a later reference instant', () => {
    // The fold leaves each accumulator as of its last violating event. Ageing that state to a
    // later instant must give the same number as if the meter had simply sat there — which is
    // what makes the `accumulators/` cache safe to project from instead of re-folding.
    const k = knobs(50);
    const folded = foldOne([breach(0, 1), breach(90, 2)], k);
    const projected = projectStateTo(folded, atDay(180), k);
    // 1.0125 × 2^(-1) = 0.50625
    expect(read(projected)).toBeCloseTo(0.50625, 12);
    expect(projected.asOf).toBe(atDay(180));
    expect(projected.lastEventAt).toBe(atDay(90));
  });

  it('never amplifies: running the reference instant backwards is a no-op on the value', () => {
    const folded = foldOne([breach(100, 1)], knobs(50));
    const rewound = decayStateTo(folded, atDay(0), HALF_LIFE_90D);
    expect(read(rewound)).toBe(read(folded));
    expect(rewound.asOf).toBe(atDay(0));
  });

  it('out-of-order committer times cannot manufacture surprise in the fold either', () => {
    // Same set, one clock-skewed event: the total order (Q-11) puts it first, and decay clamps
    // at 1 for non-positive elapsed time, so the meter is bounded by the undecayed sum.
    const state = foldOne([breach(200, 1), breach(0, 2), breach(200, 3)], knobs(50));
    expect(read(state)).toBeLessThanOrEqual(3 * 0.675 + 1e-12);
    expect(state.asOf).toBe(atDay(200));
  });
});

// ---------------------------------------------------------------------------
// Committer time is the clock (ADR-0004)
// ---------------------------------------------------------------------------

describe('committer time, not observation time (ADR-0004)', () => {
  it('the same events judged in a different order arrive at the same decayed state', () => {
    // Judging the old commit first or last is an observation-order accident; the fold sorts by
    // committer time before any arithmetic runs, so it cannot show up in the result.
    const old = breach(0, 1);
    const recent = breach(240, 2);
    expect(read(foldOne([old, recent], knobs(5)))).toBe(read(foldOne([recent, old], knobs(5))));
  });

  it('a degenerate `0d` half-life spends every prior event instantly (Q-02)', () => {
    const zero = knobs(5, { halfLife: unwrap(parseDuration('0d')) });
    const state = foldOne([breach(0, 1), breach(1, 2)], zero);
    expect(read(state)).toBeCloseTo(0.675, 12);
  });

  it('two events at the SAME committer instant both land at full strength', () => {
    const state = foldOne([breach(10, 1), breach(10, 2)], knobs(5));
    expect(read(state)).toBeCloseTo(1.35, 12);
    expect(state.contributing.every((c) => readWeight(c) === 0.675)).toBe(true);
  });
});
