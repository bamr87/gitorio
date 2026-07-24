// Implements tests for: docs/spec/02-ledger.md §4 (leaky integrator) and §6 (hysteresis),
// docs/adr/0004-committer-time-decay.md, and CLAUDE.md's stated fixture
// ("an 8-month-old breach against a 90-day half-life arrives at ~15% strength").

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ARMED,
  REARM_FRACTION_DEFAULT,
  accumulatorStep,
  decay,
  decayFactor,
  decayStateTo,
  emptyAccumulator,
  knobsDigest,
  rearm,
  shouldFire,
  toAccumulatorSnapshot,
  type AccumulatorState,
  type FoldKnobs,
} from '../../src/core/accumulator.js';
import { parseBudget, parsePrecision } from '../../src/core/assertion.js';
import { parseAccumulatorKey, sha256RefFromHex } from '../../src/core/ids.js';
import { unwrap } from '../../src/core/result.js';
import {
  revealSurprise,
  surprise,
  withSentencingWarrant,
} from '../../src/core/sentencing.js';
import { MILLIS_PER_DAY, parseCommitterTime, parseDuration } from '../../src/core/time.js';

const HALF_LIFE_90D = unwrap(parseDuration('90d'));
const KEY = unwrap(parseAccumulatorKey('INV-007'));
const DIGEST = unwrap(sha256RefFromHex('0'.repeat(64)));
const t = (s: string) => unwrap(parseCommitterTime(s));
const read = (state: AccumulatorState): number =>
  withSentencingWarrant((w) => revealSurprise(state.value, w));

/** `toAccumulatorSnapshot` takes the warrant from its caller now — see src/core/index.ts. */
const WARRANT = withSentencingWarrant((w) => w);

describe('decay math (spec 02 §4)', () => {
  it('halves exactly at one half-life', () => {
    expect(decayFactor(90 * MILLIS_PER_DAY, HALF_LIFE_90D)).toBeCloseTo(0.5, 12);
  });

  it('quarters at two half-lives', () => {
    expect(decayFactor(180 * MILLIS_PER_DAY, HALF_LIFE_90D)).toBeCloseTo(0.25, 12);
  });

  it("matches the spec's own 8-month / 90d ≈ 15% fixture", () => {
    // 8 months at the pinned 30-day month = 240 days = 8/3 half-lives.
    const eightMonths = 8 * 30 * MILLIS_PER_DAY;
    const f = decayFactor(eightMonths, HALF_LIFE_90D);
    expect(f).toBeCloseTo(0.157, 3);
    expect(f).toBeGreaterThan(0.14);
    expect(f).toBeLessThan(0.17);
  });

  it('is exactly 1 at zero elapsed time', () => {
    expect(decayFactor(0, HALF_LIFE_90D)).toBe(1);
  });

  it('NEVER amplifies: a backwards committer time clamps to 1', () => {
    expect(decayFactor(-1, HALF_LIFE_90D)).toBe(1);
    expect(decayFactor(-1e12, HALF_LIFE_90D)).toBe(1);
    expect(decay(3, -1e12, HALF_LIFE_90D)).toBe(3);
  });

  it('clamps a non-finite elapsed time to no decay rather than producing NaN', () => {
    expect(decayFactor(Number.NaN, HALF_LIFE_90D)).toBe(1);
  });

  it('pins the degenerate zero half-life the schema pattern admits (Q-02)', () => {
    const zero = unwrap(parseDuration('0d'));
    expect(decayFactor(0, zero)).toBe(1);
    expect(decayFactor(1, zero)).toBe(0);
  });

  it('is monotonically non-increasing in elapsed time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(decayFactor(hi * MILLIS_PER_DAY, HALF_LIFE_90D)).toBeLessThanOrEqual(
            decayFactor(lo * MILLIS_PER_DAY, HALF_LIFE_90D),
          );
        },
      ),
    );
  });

  it('is memoryless: decaying in two steps equals decaying in one', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (value, d1, d2) => {
          const twoSteps = decay(decay(value, d1 * MILLIS_PER_DAY, HALF_LIFE_90D), d2 * MILLIS_PER_DAY, HALF_LIFE_90D);
          const oneStep = decay(value, (d1 + d2) * MILLIS_PER_DAY, HALF_LIFE_90D);
          expect(twoSteps).toBeCloseTo(oneStep, 9);
        },
      ),
    );
  });
});

describe('the leaky integrator step: A <- A·2^(-dt/half_life) + p·s', () => {
  it('adds precision * severity on a violating event', () => {
    expect(accumulatorStep(0, 0, HALF_LIFE_90D, 0.9 * 0.75)).toBeCloseTo(0.675, 12);
  });

  it('decays before it adds', () => {
    // 1.0 decayed over one half-life is 0.5, plus a breach at precision 0.9 = 0.675.
    expect(accumulatorStep(1, 90 * MILLIS_PER_DAY, HALF_LIFE_90D, 0.675)).toBeCloseTo(1.175, 12);
  });

  it('adds nothing when the addend is zero (aligned pays nothing down)', () => {
    expect(accumulatorStep(2, 0, HALF_LIFE_90D, 0)).toBe(2);
  });

  it('never goes below zero from decay alone', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.integer({ min: 0, max: 100_000 }),
        (v, days) => {
          expect(accumulatorStep(v, days * MILLIS_PER_DAY, HALF_LIFE_90D, 0)).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('an 8-month-old breach arrives pre-decayed, so backfill cannot fire on stale news', () => {
    const breachNow = accumulatorStep(0, 0, HALF_LIFE_90D, 0.9 * 0.75);
    const decayed = decay(breachNow, 8 * 30 * MILLIS_PER_DAY, HALF_LIFE_90D);
    expect(decayed).toBeLessThan(0.11);
    expect(breachNow).toBeGreaterThan(0.6);
  });
});

describe('accumulator state', () => {
  const budget = unwrap(parseBudget(3));
  const knobs: FoldKnobs = {
    halfLife: HALF_LIFE_90D,
    budget,
    precisionOverride: null,
    rearmFraction: REARM_FRACTION_DEFAULT,
  };

  it('starts empty, armed, at zero', () => {
    const a = emptyAccumulator(KEY, DIGEST);
    expect(read(a)).toBe(0);
    expect(a.arm).toEqual(ARMED);
    expect(a.violationCount).toBe(0);
    expect(a.complianceCount).toBe(0);
    expect(a.asOf).toBeNull();
  });

  it('decays state forward and is memoryless in the state form too', () => {
    const start = {
      ...emptyAccumulator(KEY, DIGEST),
      value: surprise(2),
      asOf: t('2026-01-01T00:00:00Z'),
    };
    const oneStep = decayStateTo(start, t('2026-07-01T00:00:00Z'), HALF_LIFE_90D);
    const twoStep = decayStateTo(
      decayStateTo(start, t('2026-04-01T00:00:00Z'), HALF_LIFE_90D),
      t('2026-07-01T00:00:00Z'),
      HALF_LIFE_90D,
    );
    expect(read(oneStep)).toBeCloseTo(read(twoStep), 9);
  });

  it('a backwards committer time cannot manufacture surprise', () => {
    const start = {
      ...emptyAccumulator(KEY, DIGEST),
      value: surprise(2),
      asOf: t('2026-07-01T00:00:00Z'),
    };
    const backwards = decayStateTo(start, t('2026-01-01T00:00:00Z'), HALF_LIFE_90D);
    expect(read(backwards)).toBe(2);
  });

  it('spec 02 §6: hysteresis, not reset — nothing flaps', () => {
    expect(REARM_FRACTION_DEFAULT).toBe(0.5);

    const hot: AccumulatorState = {
      ...emptyAccumulator(KEY, DIGEST),
      value: surprise(3.1),
      asOf: t('2026-01-01T00:00:00Z'),
    };
    expect(shouldFire(hot, budget)).toBe(true);

    const fired: AccumulatorState = {
      ...hot,
      arm: { kind: 'fired', at: t('2026-01-01T00:00:00Z'), value: surprise(3.1) },
    };
    // Still above budget but already fired: does not fire again.
    expect(shouldFire(fired, budget)).toBe(false);
    // Still above 50% of budget: does not re-arm.
    expect(rearm({ ...fired, value: surprise(1.6) }, knobs).arm.kind).toBe('fired');
    // Decayed below 50% of budget: re-arms.
    expect(rearm({ ...fired, value: surprise(1.4) }, knobs).arm.kind).toBe('armed');
  });

  it('does not fire below budget', () => {
    const cool = { ...emptyAccumulator(KEY, DIGEST), value: surprise(2.99) };
    expect(shouldFire(cool, budget)).toBe(false);
    const exact = { ...emptyAccumulator(KEY, DIGEST), value: surprise(3) };
    expect(shouldFire(exact, budget)).toBe(true);
  });

  it('serializes through a warrant, and the snapshot drops the contributor list', () => {
    const state: AccumulatorState = {
      ...emptyAccumulator(KEY, DIGEST),
      value: surprise(1.25),
      violationCount: 2,
      complianceCount: 7,
      asOf: t('2026-07-21T14:03:00Z'),
    };
    const snap = toAccumulatorSnapshot(state, WARRANT);
    expect(snap.value).toBeCloseTo(1.25, 12);
    expect(snap.violation_count).toBe(2);
    expect(snap.compliance_count).toBe(7);
    expect(snap.armed).toBe(true);
    expect(snap.last_fired_at).toBeNull();
    expect(snap.event_count).toBe(0);
    expect(Object.keys(snap)).not.toContain('contributing');
  });

  it('knob digests differ when any knob differs, so a retune invalidates the cache', () => {
    const a = unwrap(knobsDigest(knobs));
    const b = unwrap(knobsDigest({ ...knobs, budget: unwrap(parseBudget(2)) }));
    const c = unwrap(knobsDigest({ ...knobs, halfLife: unwrap(parseDuration('180d')) }));
    const d = unwrap(knobsDigest({ ...knobs, precisionOverride: unwrap(parsePrecision(0.5)) }));
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(unwrap(knobsDigest(knobs))).toBe(a);
  });
});
