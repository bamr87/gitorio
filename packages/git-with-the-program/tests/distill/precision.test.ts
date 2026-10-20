// Implements tests for: src/distill/precision.ts — empirical precision seeding
// (docs/spec/04-distillation.md §5, OPEN-QUESTIONS Q-61). Network-free and clock-free: the seed
// is pure arithmetic over the three named inputs, so every value below is asserted EXACTLY by
// hand computation, not with a tolerance.

import { describe, expect, it } from 'vitest';
import { unwrap } from '../../src/core/result.js';
import { MILLIS_PER_DAY, committerTimeFromEpochMillis } from '../../src/core/time.js';
import {
  CORROBORATION_SATURATION,
  SEED_CEILING,
  SEED_FLOOR,
  SPAN_SATURATION_DAYS,
  type PrecisionEvidence,
  seedPrecision,
  seededPrecision,
  spanDaysBetween,
} from '../../src/distill/precision.js';

function ev(over: Partial<PrecisionEvidence> = {}): PrecisionEvidence {
  return {
    violationFreeSpanDays: 0,
    corroborations: 0,
    epochsPersisted: 0,
    epochsObserved: 1,
    ...over,
  };
}

describe('seedPrecision — bounds', () => {
  it('floors at SEED_FLOOR when no evidence supports the regularity', () => {
    expect(seedPrecision(ev())).toBe(SEED_FLOOR);
  });

  it('ceilings at SEED_CEILING when every signal saturates', () => {
    const full = ev({
      violationFreeSpanDays: SPAN_SATURATION_DAYS,
      corroborations: CORROBORATION_SATURATION,
      epochsPersisted: 1,
      epochsObserved: 1,
    });
    expect(seedPrecision(full)).toBe(SEED_CEILING);
  });

  it('never exceeds the ceiling even past saturation', () => {
    const over = ev({
      violationFreeSpanDays: SPAN_SATURATION_DAYS * 10,
      corroborations: CORROBORATION_SATURATION * 10,
      epochsPersisted: 9,
      epochsObserved: 3, // persistScore clamps to 1
    });
    expect(seedPrecision(over)).toBe(SEED_CEILING);
  });
});

describe('seedPrecision — rises with each input (with exact arithmetic)', () => {
  // seed = 0.5 + 0.45 · (0.4·spanScore + 0.3·corrScore + 0.3·persistScore)

  it('rises with a longer violation-free span', () => {
    const short = ev({ violationFreeSpanDays: 0, corroborations: 5, epochsPersisted: 1, epochsObserved: 1 });
    const long = ev({ violationFreeSpanDays: 365, corroborations: 5, epochsPersisted: 1, epochsObserved: 1 });
    // short: 0.5 + 0.45·(0 + 0.3 + 0.3) = 0.77 ; long: 0.5 + 0.45·1 = 0.95
    expect(seedPrecision(short)).toBe(0.77);
    expect(seedPrecision(long)).toBe(0.95);
    expect(seedPrecision(long)).toBeGreaterThan(seedPrecision(short));
  });

  it('rises with more independent corroborations', () => {
    const few = ev({ violationFreeSpanDays: 365, corroborations: 0, epochsPersisted: 1, epochsObserved: 1 });
    const many = ev({ violationFreeSpanDays: 365, corroborations: 5, epochsPersisted: 1, epochsObserved: 1 });
    // few: 0.5 + 0.45·(0.4 + 0 + 0.3) = 0.815 ; many: 0.95
    expect(seedPrecision(few)).toBe(0.815);
    expect(seedPrecision(many)).toBe(0.95);
    expect(seedPrecision(many)).toBeGreaterThan(seedPrecision(few));
  });

  it('rises with cross-epoch persistence', () => {
    const once = ev({ violationFreeSpanDays: 365, corroborations: 5, epochsPersisted: 1, epochsObserved: 3 });
    const always = ev({ violationFreeSpanDays: 365, corroborations: 5, epochsPersisted: 3, epochsObserved: 3 });
    // once: persistScore = 1/3 → 0.5 + 0.45·(0.4 + 0.3 + 0.1) = 0.86 ; always: 0.95
    expect(seedPrecision(once)).toBe(0.86);
    expect(seedPrecision(always)).toBe(0.95);
    expect(seedPrecision(always)).toBeGreaterThan(seedPrecision(once));
  });

  it('reproduces the spec 04 §5 fixture (~0.85) from its stated evidence', () => {
    // CAND-014: multi-year span (saturated), ~3 corroborations, persistent 4 of 6 epochs.
    const specLike = ev({ violationFreeSpanDays: 1500, corroborations: 3, epochsPersisted: 4, epochsObserved: 6 });
    // spanScore 1, corrScore 0.6, persistScore 0.6667 → 0.4 + 0.18 + 0.2 = 0.78 → 0.5 + 0.45·0.78 = 0.851
    expect(seedPrecision(specLike)).toBe(0.851);
  });
});

describe('seededPrecision — always a valid schema Precision (0, 1]', () => {
  it('brands the seed and stays inside the schema bound', () => {
    const p = unwrap(seededPrecision(ev({ violationFreeSpanDays: 365, corroborations: 3, epochsPersisted: 2, epochsObserved: 2 })));
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
    // corr 3/5=0.6, persist 1 → 0.4 + 0.18 + 0.3 = 0.88 → 0.896
    expect(p).toBe(0.896);
  });
});

describe('spanDaysBetween', () => {
  const t = (ms: number) => unwrap(committerTimeFromEpochMillis(ms));

  it('measures whole days between two committer times', () => {
    expect(spanDaysBetween(t(0), t(10 * MILLIS_PER_DAY))).toBe(10);
  });

  it('clamps an out-of-order pair to zero rather than going negative', () => {
    expect(spanDaysBetween(t(10 * MILLIS_PER_DAY), t(0))).toBe(0);
  });

  it('treats a missing endpoint as no measured span', () => {
    expect(spanDaysBetween(null, t(10 * MILLIS_PER_DAY))).toBe(0);
    expect(spanDaysBetween(t(0), null)).toBe(0);
    expect(spanDaysBetween(null, null)).toBe(0);
  });
});
