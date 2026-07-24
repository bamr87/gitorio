// Implements: docs/spec/02-ledger.md §4 (accumulation: leaky integrator) and §6 (hysteresis,
// not reset). The state type, the decay arithmetic and the single-event step. SEED-02's fold
// in src/ledger/ composes these over a sorted event set — the traversal does not live here,
// because src/core owns the contract and src/ledger owns the walk.
//
// Everything here is sentencing-side by TYPE: the accumulated value is `Surprise`, which is
// not a number and therefore cannot be assigned into any numeric field of any evidence
// bundle (INV-003 clause 2).

import type { Budget, Precision } from './assertion.js';
import { contentHash } from './canonical.js';
import { type LedgerEvent, isViolationEvent } from './event.js';
import type { AccumulatorKey, EventId, Sha256Ref } from './ids.js';
import { fail, ok, type Parsed } from './result.js';
import {
  type Surprise,
  type SentencingWarrant,
  scaleSurprise,
  surprise,
  surpriseBelowFraction,
  surpriseFrom,
  surpriseReachesBudget,
  revealSurprise,
} from './sentencing.js';
import { type CommitterTime, type HalfLife, elapsedMillis } from './time.js';
import type { ViolationVerdictKind } from './verdict.js';

/**
 * spec 02 §6 says re-arm "below ~50% of budget". The tilde is the spec's; 0.5 exactly is this
 * engine's, exported as a NAMED constant precisely because it is a soft number in the spec.
 * See docs/spec/OPEN-QUESTIONS.md Q-14.
 */
export const REARM_FRACTION_DEFAULT = 0.5;

export interface FoldKnobs {
  readonly halfLife: HalfLife;
  readonly budget: Budget;
  /**
   * Replaces each event's frozen `precision_at`. `null` = use the recorded value. This is
   * counterfactual replay (spec 02 §1 property 3), explicitly NOT a correction: precision_at
   * is frozen per event by spec 02 §2.
   */
  readonly precisionOverride: Precision | null;
  readonly rearmFraction: number;
}

/**
 * Hash of the knobs actually used. Stored in the accumulator cache so a knob retune
 * invalidates it automatically — accumulators are derived, never authoritative (ADR-0002).
 */
export function knobsDigest(k: FoldKnobs): Parsed<Sha256Ref> {
  return contentHash({
    half_life: k.halfLife.source,
    budget: k.budget,
    precision_override: k.precisionOverride === null ? null : (k.precisionOverride as number),
    rearm_fraction: k.rearmFraction,
  });
}

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

/**
 * `2^(-Δt / half_life)`.
 *
 * Returns 1 when `elapsedMs <= 0`: decay NEVER amplifies, so an out-of-order or clock-skewed
 * committer time cannot manufacture surprise. A degenerate zero half-life — which the schema
 * pattern admits, see OPEN-QUESTIONS Q-02 — returns 0 for any positive elapsed time.
 *
 * Hand-checkable fixture (spec 04 §7, CLAUDE.md): 8 months against 90d ≈ 0.157.
 */
export function decayFactor(elapsedMs: number, halfLife: HalfLife): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1;
  if (halfLife.millis <= 0) return 0;
  return 2 ** (-elapsedMs / halfLife.millis);
}

export function decay(value: number, elapsedMs: number, halfLife: HalfLife): number {
  return value * decayFactor(elapsedMs, halfLife);
}

/** One step of `A <- A · 2^(-Δt / half_life) + addend`. The unit the property tests target. */
export function accumulatorStep(
  value: number,
  elapsedMs: number,
  halfLife: HalfLife,
  addend: number,
): number {
  return decay(value, elapsedMs, halfLife) + addend;
}

/**
 * `precision_at · severity` for one event, before any decay, AS A PLAIN NUMBER. Non-violating
 * events contribute exactly 0 — aligned is counted but pays nothing down, abstain never
 * accumulates (spec 02 §4).
 *
 * DECLASSIFIER. It hands back the increment term of the leaky integrator untainted, so it
 * takes a `SentencingWarrant` it cannot mint: obtaining one means value-importing
 * `./sentencing.js`, which `scripts/check-inv003.ts` forbids under `src/judge/**` and
 * `src/evidence/**`. Callers that only need to ACCUMULATE want `surpriseOf`, which returns a
 * `Surprise` and needs no warrant — SEED-02 can build the whole integrator without one.
 */
export function rawSurprise(
  e: LedgerEvent,
  precisionOverride: Precision | null,
  _warrant: SentencingWarrant,
): Parsed<number> {
  if (!isViolationEvent(e)) return ok(0);
  const p = precisionOverride === null ? e.precision_at : (precisionOverride as number);
  if (!Number.isFinite(p)) {
    return fail('invalid-precision', `event ${e.event} has a non-finite precision_at`);
  }
  return ok(p * e.severity);
}

export function surpriseOf(e: LedgerEvent, precisionOverride: Precision | null): Parsed<Surprise> {
  if (!isViolationEvent(e)) return ok(surprise(0));
  const p = precisionOverride === null ? (e.precision_at as Precision) : precisionOverride;
  return ok(surpriseFrom(p, e.severity));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Hysteresis, not reset (spec 02 §6). A two-case union, so "fired but not re-armed" is exact. */
export type ArmState =
  | { readonly kind: 'armed' }
  | { readonly kind: 'fired'; readonly at: CommitterTime; readonly value: Surprise };

export const ARMED: ArmState = { kind: 'armed' };

export interface ContributingEvent {
  readonly event: EventId;
  readonly key: AccumulatorKey;
  readonly t: CommitterTime;
  readonly verdict: ViolationVerdictKind;
  /** `precision_at · severity` as integrated, before any decay. */
  readonly rawWeight: number;
  /** rawWeight decayed to the state's reference instant — this event's live share. */
  readonly residualWeight: Surprise;
}

/**
 * The derived cache under `accumulators/` — "recomputable at will, cacheable, never
 * authoritative" (spec 02 §1.2). No JSON Schema binds it; see OPEN-QUESTIONS Q-08.
 */
export interface AccumulatorState {
  readonly key: AccumulatorKey;
  /** A: decay-weighted accumulated surprise, decayed to `asOf`. */
  readonly value: Surprise;
  readonly asOf: CommitterTime | null;
  /** Committer time of the last VIOLATING event; aligned/abstain do not advance it. */
  readonly lastEventAt: CommitterTime | null;
  readonly violationCount: number;
  /** Counted, never subtracted. "Decay is the only forgiveness" (spec 02 §4). */
  readonly complianceCount: number;
  readonly abstentionCount: number;
  readonly arm: ArmState;
  readonly contributing: readonly ContributingEvent[];
  readonly knobs: Sha256Ref;
}

export interface Firing {
  readonly key: AccumulatorKey;
  readonly at: CommitterTime;
  readonly triggeredBy: EventId;
  readonly value: Surprise;
  readonly budget: Budget;
  /** Snapshot of every contributing event's residual weight AT the firing instant. */
  readonly contributing: readonly ContributingEvent[];
}

export function emptyAccumulator(key: AccumulatorKey, knobs: Sha256Ref): AccumulatorState {
  return {
    key,
    value: surprise(0),
    asOf: null,
    lastEventAt: null,
    violationCount: 0,
    complianceCount: 0,
    abstentionCount: 0,
    arm: ARMED,
    contributing: [],
    knobs,
  };
}

/**
 * Advances `asOf` and scales `value` and every residual weight. Memoryless by construction:
 * the exponential means `decayStateTo(decayStateTo(a, t1), t2)` equals `decayStateTo(a, t2)`.
 */
export function decayStateTo(
  state: AccumulatorState,
  to: CommitterTime,
  halfLife: HalfLife,
): AccumulatorState {
  if (state.asOf === null) return { ...state, asOf: to };
  const factor = decayFactor(elapsedMillis(state.asOf, to), halfLife);
  if (factor === 1) return { ...state, asOf: to };
  return {
    ...state,
    asOf: to,
    value: scaleSurprise(state.value, factor),
    contributing: state.contributing.map((c) => ({
      ...c,
      residualWeight: scaleSurprise(c.residualWeight, factor),
    })),
  };
}

/** `A >= budget AND armed`. "Hysteresis, not reset. Nothing flaps." */
export function shouldFire(state: AccumulatorState, budget: Budget): boolean {
  return state.arm.kind === 'armed' && surpriseReachesBudget(state.value, budget);
}

/** Sets `armed` once the value has decayed below `rearmFraction * budget`. Otherwise returns `state`. */
export function rearm(state: AccumulatorState, knobs: FoldKnobs): AccumulatorState {
  if (state.arm.kind === 'armed') return state;
  return surpriseBelowFraction(state.value, knobs.budget, knobs.rearmFraction)
    ? { ...state, arm: ARMED }
    : state;
}

// ---------------------------------------------------------------------------
// The persisted snapshot
// ---------------------------------------------------------------------------

/**
 * Persisted to `accumulators/<key>.yaml`. Drops `contributing` (recomputable) so the file
 * cannot grow without bound, and keeps `event_count` for cheap staleness detection.
 * snake_case, because it is persisted.
 */
export interface AccumulatorSnapshot {
  readonly key: AccumulatorKey;
  readonly value: number;
  readonly as_of: CommitterTime | null;
  readonly last_event_at: CommitterTime | null;
  readonly violation_count: number;
  readonly compliance_count: number;
  readonly abstention_count: number;
  readonly armed: boolean;
  readonly last_fired_at: CommitterTime | null;
  readonly knobs: Sha256Ref;
  readonly event_count: number;
}

/**
 * Serializing the meter is a legitimate declassification, so the CALLER holds the warrant.
 *
 * It used to mint its own with `withSentencingWarrant`, which made this function a warrantless
 * `Surprise -> number` door reachable from the `src/core` barrel: `toAccumulatorSnapshot(s).value`
 * is a plain number, assignable into any numeric field of any evidence bundle, with no deep
 * import for a reviewer or a prescreen to see. Taking the warrant as a parameter turns every
 * declassification site back into a call with an extra argument, and the only way to obtain
 * that argument is `withSentencingWarrant` from `./sentencing.js` — one greppable line.
 */
export function toAccumulatorSnapshot(
  state: AccumulatorState,
  warrant: SentencingWarrant,
): AccumulatorSnapshot {
  return {
    key: state.key,
    value: revealSurprise(state.value, warrant),
    as_of: state.asOf,
    last_event_at: state.lastEventAt,
    violation_count: state.violationCount,
    compliance_count: state.complianceCount,
    abstention_count: state.abstentionCount,
    armed: state.arm.kind === 'armed',
    last_fired_at: state.arm.kind === 'fired' ? state.arm.at : null,
    knobs: state.knobs,
    event_count: state.contributing.length,
  };
}
