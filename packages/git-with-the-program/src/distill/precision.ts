// Implements: docs/spec/04-distillation.md §5 (empirical precision seeding — "Evidence strength
// seeds `precision`; the prior's confidence comes from the data that formed it"). SEED-04
// deliverable 4.
//
// The seed is DERIVED from the three inputs spec 04 §5 names — violation-free span, number of
// independent corroborations, cross-epoch persistence — and never hand-set. The spec states the
// inputs but no FUNCTION; the saturating-weighted-evidence form below is the least-committal
// choice, recorded at docs/spec/OPEN-QUESTIONS.md Q-61 (the distillation analogue of Q-47, which
// fixes how precision RISES under affirmation; this fixes where it STARTS).
//
// Pure arithmetic: no fs, no git, no model, no clock beyond the two committer-time endpoints a
// caller passes in. `seedPrecision` is a total function of `PrecisionEvidence`, so two runs over
// the same fact base seed byte-identical priors — the replay property spec 04 §2/§8 depends on.

import type { Precision } from '../core/assertion.js';
import { parsePrecision } from '../core/assertion.js';
import type { Parsed } from '../core/result.js';
import type { CommitterTime } from '../core/time.js';
import { MILLIS_PER_DAY, elapsedMillis } from '../core/time.js';

// ---------------------------------------------------------------------------
// The three evidence inputs (spec 04 §5)
// ---------------------------------------------------------------------------

/**
 * The exact data spec 04 §5 says forms the prior. Author-free by construction: nothing here
 * names a committer, so a precision seed cannot smuggle identity onto a verdict path (INV-003).
 */
export interface PrecisionEvidence {
  /**
   * Violation-free duration in DAYS. For a `boundary` law this is the span of a
   * `NegativeSpaceProof` that held (`no external import ever crossed into core/` across
   * `spanFrom..spanTo`); 0 when nothing exhaustive underwrites it.
   */
  readonly violationFreeSpanDays: number;
  /** Number of INDEPENDENT corroborations (distinct provenance refs the candidate rests on). */
  readonly corroborations: number;
  /** How many distinct epochs the same regularity surfaced in (cross-epoch persistence). */
  readonly epochsPersisted: number;
  /** Total epochs walked — the persistence denominator. */
  readonly epochsObserved: number;
}

// ---------------------------------------------------------------------------
// The seeding function — all knobs are named constants (Q-61)
// ---------------------------------------------------------------------------

/**
 * A machine-inferred candidate is "noisy by construction" (spec 04 §4), so even a maximally
 * corroborated regularity starts BELOW certainty; a human raises it at ratification. The output
 * is confined to `[SEED_FLOOR, SEED_CEILING] ⊂ (0, 1]`, so it always satisfies the schema's
 * precision bound (`parsePrecision`) — a seed can never be rejected for being out of range.
 */
export const SEED_FLOOR = 0.5;
export const SEED_CEILING = 0.95;

/** Weights of the three signals; they sum to 1 so `weighted ∈ [0, 1]`. */
export const WEIGHT_SPAN = 0.4;
export const WEIGHT_CORROBORATION = 0.3;
export const WEIGHT_PERSISTENCE = 0.3;

/** A violation-free year saturates the span term (the spec's four-year example is well past it). */
export const SPAN_SATURATION_DAYS = 365;
/** Five independent corroborations saturate the corroboration term. */
export const CORROBORATION_SATURATION = 5;

/** Six decimals, matching Q-47's `raisePrecision`, so `.program/` stays human-readable. */
export const SEED_DECIMALS = 6;

function clamp01(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return x >= 1 ? 1 : x;
}

function round(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

/**
 * THE FORMULA (spec 04 §5, pinned by OPEN-QUESTIONS Q-61).
 *
 *   spanScore    = clamp01(violationFreeSpanDays / SPAN_SATURATION_DAYS)
 *   corrScore    = clamp01(corroborations       / CORROBORATION_SATURATION)
 *   persistScore = epochsObserved > 0 ? clamp01(epochsPersisted / epochsObserved) : 0
 *   weighted     = WEIGHT_SPAN·spanScore + WEIGHT_CORROBORATION·corrScore
 *                                        + WEIGHT_PERSISTENCE·persistScore          // ∈ [0, 1]
 *   seed         = SEED_FLOOR + (SEED_CEILING − SEED_FLOOR)·weighted                // ∈ [.5, .95]
 *
 * Strictly non-decreasing in each of the three inputs, saturating (unbounded evidence cannot
 * push the prior to certainty), and hand-checkable. Calibration check against the spec's own
 * fixture (spec 04 §5, CAND-014: multi-year span, ~3 corroborations, persistent e3..e6 of 6):
 * spanScore 1, corrScore 0.6, persistScore ≈ 0.667 → weighted ≈ 0.78 → seed ≈ 0.851 ≈ the
 * spec's hand-written `precision_seed: 0.85`.
 */
export function seedPrecision(ev: PrecisionEvidence): number {
  const spanScore = clamp01(ev.violationFreeSpanDays / SPAN_SATURATION_DAYS);
  const corrScore = clamp01(ev.corroborations / CORROBORATION_SATURATION);
  const persistScore =
    ev.epochsObserved > 0 ? clamp01(ev.epochsPersisted / ev.epochsObserved) : 0;

  const weighted =
    WEIGHT_SPAN * spanScore +
    WEIGHT_CORROBORATION * corrScore +
    WEIGHT_PERSISTENCE * persistScore;

  return round(SEED_FLOOR + (SEED_CEILING - SEED_FLOOR) * weighted, SEED_DECIMALS);
}

/**
 * `seedPrecision` branded into the schema's `Precision` (0, 1]. Total in practice — the seed is
 * always in `[SEED_FLOOR, SEED_CEILING]` — but returns `Parsed` so a future re-tuning of the
 * constants that walked off the top would fail loudly instead of minting an invalid prior.
 */
export function seededPrecision(ev: PrecisionEvidence): Parsed<Precision> {
  return parsePrecision(seedPrecision(ev));
}

/**
 * Violation-free span in whole-and-fractional days between two committer-time endpoints, clamped
 * at 0 so an out-of-order pair never yields a negative span. `null` endpoints (a proof with no
 * measured span) yield 0.
 */
export function spanDaysBetween(
  from: CommitterTime | null,
  to: CommitterTime | null,
): number {
  if (from === null || to === null) return 0;
  const ms = elapsedMillis(from, to);
  return ms <= 0 ? 0 : ms / MILLIS_PER_DAY;
}
