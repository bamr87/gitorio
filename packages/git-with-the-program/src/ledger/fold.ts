// Implements: docs/spec/02-ledger.md §3 (rules that keep the fold safe), §4 (accumulation: a
// leaky integrator), §5 (the firing test) and §6 (hysteresis, not reset), against
// docs/adr/0002-event-sourced-ledger.md ("accumulator state is a fold over the event set:
// recomputable at will, cacheable, never authoritative") and
// docs/adr/0004-committer-time-decay.md (Δt is committer time, never observation time).
//
// THE TRAVERSAL, AND NOTHING ELSE. Every type and every piece of arithmetic this file needs
// already exists in src/core and is used verbatim: `resolveSupersessions` picks the tips,
// `compareForFold` totally orders them, `decayStateTo` runs the exponential, `surpriseOf`
// computes `precision_at · severity`, `shouldFire`/`rearm` are the Schmitt trigger, and
// `knobsDigest` stamps the result. src/core owns the vocabulary; src/ledger owns the walk.
//
// PURITY IS THE ACCEPTANCE CRITERION (SEED-02): same event set + same knobs -> identical
// state, whatever order the array arrived in. Three things make that true rather than hoped
// for, and each is load-bearing:
//   1. the input is a SET — `resolveSupersessions` collapses by event id (keeping the FIRST
//      object per id) and sorts its tips;
//   2. the tips are totally ordered by `compareForFold` (committer time, then event id) before
//      any arithmetic runs, because a leaky integrator is order-sensitive (Q-11);
//   3. nothing observable is read out of a Map in Map order — `keys` is sorted explicitly and
//      `states` is built by iterating that sorted list.
// No `Date.now()`, no I/O, no mutation of any input, no module-level mutable state.
//
// ONE PRECONDITION, satisfied by the pipeline: purity is over the SET of events, and content
// addressing makes an event's id the hash of its body, so two objects sharing an id necessarily
// share a body. `list()` runs `verifyEventId` on every event before the fold ever sees it, so a
// same-id/different-body pair (tampered or hand-built) cannot reach here. Fed such a pair directly
// — bypassing the store — the fold keeps the first object per id (step 1), which is deterministic
// but not meaningful; the store's verification, not the fold, is what rejects the tamper.
//
// WHY THIS FILE HOLDS A SENTENCING WARRANT AND `cache.ts` DOES NOT. The accumulated value is a
// `Surprise` from the first event to the last — `surpriseOf` and `addSurprise` are
// taint-preserving and `shouldFire`/`rearm` answer in booleans, so the integrator itself never
// untaints anything. The single `withSentencingWarrant` below exists for one reason:
// `ContributingEvent.rawWeight` is typed by src/core as a plain `number` ("`precision_at ·
// severity` as integrated, before any decay"), and `rawSurprise` is the sanctioned way to
// compute it. That declassifies nothing new — both factors are public fields of the event, and
// `ContributingEvent` is itself listed in `SentencingOnlyValue`, so `Blind<T>` rejects the
// result from any evidence bundle regardless. Contrast `cache.ts`, which turns the METER into a
// number and therefore takes its warrant from its caller (see the Q-40 lesson).

import {
  REARM_FRACTION_DEFAULT,
  compareCommitterTime,
  compareForFold,
  decayStateTo,
  emptyAccumulator,
  fail,
  isViolationEvent,
  knobsDigest,
  ok,
  rearm,
  resolveSupersessions,
  shouldFire,
  surpriseOf,
  type AccumulatorKey,
  type AccumulatorState,
  type Budget,
  type CommitterTime,
  type ContributingEvent,
  type EventId,
  type Firing,
  type FoldKnobs,
  type HalfLife,
  type LedgerEvent,
  type Parsed,
  type Precision,
  type SentencingWarrant,
  type Sha256Ref,
  type SupersessionFork,
  type SupersessionResolution,
} from '../core/index.js';
import { rawSurprise } from '../core/accumulator.js';
import { addSurprise, withSentencingWarrant } from '../core/sentencing.js';

// ---------------------------------------------------------------------------
// Knobs: the replay / counterfactual entry point (spec 02 §1 property 3)
// ---------------------------------------------------------------------------

/**
 * The subset of an `Assertion` the fold reads. Deliberately structural and snake_case, so an
 * `Assertion` satisfies it as-is without a mapping layer.
 */
export interface KnobSource {
  readonly budget: Budget;
  readonly half_life: HalfLife;
}

/**
 * "Retune a `half_life` or `precision` retroactively and recompute; run counterfactuals
 * ('what fires under budget 2.0?') without losing anything" (spec 02 §1.3).
 *
 * Every override is a READ-TIME substitution. Nothing here can reach a stored event:
 * `precision_at` is frozen per event by spec 02 §2, and `precisionOverride` is handed to
 * `surpriseOf` / `rawSurprise` at the moment the increment is computed. `--replay` is therefore
 * the same code path as a normal fold with a different `FoldKnobs`, which is the only way the
 * counterfactual can be trusted to mean anything.
 */
export interface FoldKnobOverrides {
  readonly halfLife?: HalfLife;
  readonly budget?: Budget;
  readonly precisionOverride?: Precision | null;
  readonly rearmFraction?: number;
}

export function foldKnobs(source: KnobSource, overrides: FoldKnobOverrides = {}): FoldKnobs {
  return {
    halfLife: overrides.halfLife ?? source.half_life,
    budget: overrides.budget ?? source.budget,
    precisionOverride: overrides.precisionOverride ?? null,
    rearmFraction: overrides.rearmFraction ?? REARM_FRACTION_DEFAULT,
  };
}

/**
 * The one knob src/core cannot range-check for us: `rearmFraction` is a bare `number` on
 * `FoldKnobs` (Q-14 leaves it soft on purpose). A fraction OF THE BUDGET is by construction in
 * [0, 1]; above 1 the re-arm threshold would sit above the firing threshold and the accumulator
 * would re-arm the instant it fired, reintroducing exactly the flapping spec 02 §6 forbids.
 * Below 0 it can never re-arm at all. Both are rejected rather than silently tolerated.
 *
 * `budget` and `halfLife` need no guard here: a non-finite value in either fails
 * `knobsDigest` (canonicalization rejects NaN/Infinity), which the caller sees as an error
 * instead of as a silently disarmed assertion.
 */
export function checkFoldKnobs(knobs: FoldKnobs): Parsed<true> {
  if (!Number.isFinite(knobs.rearmFraction) || knobs.rearmFraction < 0 || knobs.rearmFraction > 1) {
    return fail(
      'wrong-type',
      `rearmFraction must be a fraction of the budget in [0, 1], got ${String(knobs.rearmFraction)}`,
      '/rearmFraction',
    );
  }
  return ok(true);
}

// ---------------------------------------------------------------------------
// Grouping: supersession tips, bucketed by accumulator key
// ---------------------------------------------------------------------------

/** Lexicographic, code-unit order. NOT `localeCompare`: that is locale-dependent, i.e. impure. */
export function compareAccumulatorKeys(a: AccumulatorKey, b: AccumulatorKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface TipGrouping {
  /** Every key present in the tip set, ascending. The fold's iteration order. */
  readonly keys: readonly AccumulatorKey[];
  /** Tips per key, each already in `compareForFold` order. */
  readonly byKey: ReadonlyMap<AccumulatorKey, readonly LedgerEvent[]>;
  /** Forks and dangling links, reported rather than resolved (Q-23). */
  readonly resolution: SupersessionResolution;
}

/**
 * "The fold takes the tip of each supersession chain" (spec 02 §3), then keys by
 * `event.assertion` — an assertion id, or a scope claim key for obsolescence sweeps (spec 02 §7,
 * Q-04). Pure and order-independent.
 *
 * The `.sort(compareForFold)` is belt-and-braces: `resolveSupersessions` already returns sorted
 * tips, but this fold's determinism must not rest on a promise made in another module's
 * comment. Sorting an already-sorted array under a strict comparator is idempotent and free.
 *
 * Exported because `cache.ts` needs exactly this — and only this — to compute the cheap
 * staleness facts. Two implementations of "which events belong to this accumulator" would drift
 * and permanently invalidate the cache.
 */
export function groupTipsByKey(events: readonly LedgerEvent[]): TipGrouping {
  const resolution = resolveSupersessions(events);
  const tips = [...resolution.tips].sort(compareForFold);

  const buckets = new Map<AccumulatorKey, LedgerEvent[]>();
  for (const e of tips) {
    const list = buckets.get(e.assertion);
    if (list === undefined) buckets.set(e.assertion, [e]);
    else list.push(e);
  }

  const keys = [...buckets.keys()].sort(compareAccumulatorKeys);
  const byKey = new Map<AccumulatorKey, readonly LedgerEvent[]>();
  for (const k of keys) byKey.set(k, buckets.get(k) ?? []);

  return { keys, byKey, resolution };
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

export interface KeyFold {
  readonly state: AccumulatorState;
  /** Firings for this key, in the order they occurred during the walk. */
  readonly firings: readonly Firing[];
}

/**
 * One accumulator, one pass. `events` must already be the tips for `key` in `compareForFold`
 * order — `foldEvents` guarantees that; a direct caller owns it.
 *
 * Per violating event (drift | regression | stale-claim, never aligned, never abstain):
 *
 *     A  <-  A · 2^(-Δt / half_life)  +  precision_at · severity
 *
 * in exactly that order — decay first, then add — because the arriving event has not yet aged.
 *
 * THE ASYMMETRY IS THE POINT (spec 02 §4). `aligned` increments `complianceCount` and does
 * nothing else whatsoever: it does not pay the meter down, it does not advance `lastEventAt`,
 * and it does not advance `asOf` either. Advancing `asOf` would be defensible — decay is
 * memoryless, so the final value at any common instant is identical — but it would make
 * "appending an aligned event never CHANGES the accumulator" false as stated, for a state whose
 * reference instant had moved. Compliance is counted and nothing more; decay is the only
 * forgiveness. `abstain` increments `abstentionCount` only: it never accumulates, it escalates
 * (spec 03 §4). See docs/spec/OPEN-QUESTIONS.md Q-43.
 *
 * HYSTERESIS (spec 02 §6, Q-42). The re-arm test reads the DECAYED value, before this event's
 * increment is added. Spec 02 §6 says re-arm "after the accumulator decays below ~50% of
 * budget", and decay is the only thing that can lower the meter; testing after the increment
 * would let a repo that hovers between the re-arm fraction and the budget go permanently
 * silent, which is a stronger claim than "nothing flaps".
 */
export function foldKeyEvents(
  key: AccumulatorKey,
  events: readonly LedgerEvent[],
  knobs: FoldKnobs,
  digest: Sha256Ref,
  warrant: SentencingWarrant,
): Parsed<KeyFold> {
  let state = emptyAccumulator(key, digest);
  const firings: Firing[] = [];

  for (const e of events) {
    if (!isViolationEvent(e)) {
      state =
        e.verdict === 'abstain'
          ? { ...state, abstentionCount: state.abstentionCount + 1 }
          : { ...state, complianceCount: state.complianceCount + 1 };
      continue;
    }

    // 1. Age the meter — and every residual weight on the evidence list — to this event's
    //    COMMITTER time (ADR-0004). `decayFactor` clamps non-positive elapsed time to 1, so a
    //    clock-skewed or same-instant event can never amplify what is already there.
    state = decayStateTo(state, e.t, knobs.halfLife);

    // 2. Hysteresis, evaluated on the decayed value (Q-42). A no-op while armed.
    state = rearm(state, knobs);

    // 3. The increment. `surpriseOf` keeps it a `Surprise`; `rawSurprise` gives the same product
    //    as the plain number `ContributingEvent.rawWeight` is typed as. `precisionOverride` is
    //    applied HERE, at read time — the recorded `precision_at` is never touched.
    //
    //    The two disagree for exactly one class of input: `event.precision_at` is an UNBOUNDED
    //    number in the schema (Q-26), so a hand-written or third-party event may carry a negative
    //    one. `surprise()` floors at zero — "an accumulator can never hold less than nothing" —
    //    so the METER takes nothing from such an event, while `rawWeight` keeps reporting the
    //    product the event actually recorded. That divergence is deliberate: the meter must not
    //    be drivable downwards by a malformed field (that would be a second forgiveness, and
    //    decay is the only one), and the evidence list must not quietly rewrite what the event
    //    said. Pinned in tests/ledger/fold.test.ts.
    const increment = surpriseOf(e, knobs.precisionOverride);
    if (!increment.ok) return increment;
    const raw = rawSurprise(e, knobs.precisionOverride, warrant);
    if (!raw.ok) return raw;

    const contribution: ContributingEvent = {
      event: e.event,
      key,
      t: e.t,
      verdict: e.verdict,
      rawWeight: raw.value,
      // Undecayed at its own instant, which IS the state's `asOf` right now. Every later decay
      // step scales it along with the total, so it stays this event's live share.
      residualWeight: increment.value,
    };

    state = {
      ...state,
      value: addSurprise(state.value, increment.value),
      lastEventAt: e.t,
      violationCount: state.violationCount + 1,
      contributing: [...state.contributing, contribution],
    };

    // 4. `A >= budget AND armed`. The spike.
    if (shouldFire(state, knobs.budget)) {
      firings.push({
        key,
        at: e.t,
        triggeredBy: e.event,
        value: state.value,
        budget: knobs.budget,
        // Frozen by construction: every later step rebuilds the array rather than mutating it,
        // so this stays the residual weights AT the firing instant, ready to ship as evidence.
        contributing: state.contributing,
      });
      state = { ...state, arm: { kind: 'fired', at: e.t, value: state.value } };
    }
  }

  return ok({ state, firings });
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

export interface FoldResult {
  /** Every accumulator key in the event set, ascending. */
  readonly keys: readonly AccumulatorKey[];
  /**
   * Final state per key, as of that key's LAST VIOLATING event (`state.asOf`). Not "as of now":
   * a clock read here would make the fold impure. `projectStateTo` ages a state to an explicit
   * instant when a report needs one.
   */
  readonly states: ReadonlyMap<AccumulatorKey, AccumulatorState>;
  /** Every firing across every key, in committer-time order. */
  readonly firings: readonly Firing[];
  readonly knobs: FoldKnobs;
  readonly knobsDigest: Sha256Ref;
  /** The events actually folded: supersession tips (spec 02 §3). */
  readonly tips: readonly LedgerEvent[];
  /**
   * Two events superseding the same event. REPORTED, not resolved (Q-23): both successors are
   * tips and both accumulate, because inventing a tie-break would be inventing law. The
   * superseded event is dropped exactly once, so the FORK does not double-count the original.
   */
  readonly forks: readonly SupersessionFork[];
  /** `supersedes:` pointing outside the input set. The event is kept as a tip (spec 02 §3). */
  readonly dangling: readonly EventId[];
  /** Distinct events in, before supersession. */
  readonly eventCount: number;
}

/**
 * The knobs for ONE accumulator key. `null` means "this engine holds no knobs for this key" —
 * which is not an error and not an empty accumulator: it is the honest answer for a key whose
 * `budget` and `half_life` are nowhere to be found.
 *
 * That case is real and unavoidable. Knobs live on the ASSERTION (`schemas/assertion.schema.json`
 * → `budget`, `half_life`), and spec 02 §7 accumulates obsolescence against a SCOPE CLAIM, which
 * carries neither — as does any event naming an assertion that has since left `.program/`.
 * Inventing a budget for such a key would be inventing the threshold at which this framework
 * proposes amending its own constitution. See docs/spec/OPEN-QUESTIONS.md Q-56.
 */
export type FoldKnobsFor = (key: AccumulatorKey) => FoldKnobs | null;

/**
 * The walk itself, shared by `foldEvents` (one set of knobs) and `foldEventsPerKey` (one set per
 * key). One traversal, one warrant mint, one place the leaky integrator is driven.
 */
interface Walk {
  readonly states: Map<AccumulatorKey, AccumulatorState>;
  readonly knobs: Map<AccumulatorKey, FoldKnobs>;
  readonly digests: Map<AccumulatorKey, Sha256Ref>;
  readonly firings: Firing[];
  readonly unfolded: AccumulatorKey[];
}

function walkGrouping(grouping: TipGrouping, knobsFor: FoldKnobsFor): Parsed<Walk> {
  const walk: Walk = {
    states: new Map(),
    knobs: new Map(),
    digests: new Map(),
    firings: [],
    unfolded: [],
  };

  // The warrant is minted once, used only for `rawWeight`, and never escapes this call. See the
  // module header for why this is not a declassification the audit needs to worry about.
  const walked = withSentencingWarrant((warrant): Parsed<true> => {
    for (const key of grouping.keys) {
      const knobs = knobsFor(key);
      if (knobs === null) {
        walk.unfolded.push(key);
        continue;
      }
      const guard = checkFoldKnobs(knobs);
      if (!guard.ok) return guard;
      const digest = knobsDigest(knobs);
      if (!digest.ok) return digest;

      const fold = foldKeyEvents(key, grouping.byKey.get(key) ?? [], knobs, digest.value, warrant);
      if (!fold.ok) return fold;
      walk.states.set(key, fold.value.state);
      walk.knobs.set(key, knobs);
      walk.digests.set(key, digest.value);
      walk.firings.push(...fold.value.firings);
    }
    return ok(true);
  });

  return walked.ok ? ok(walk) : walked;
}

/** Total order over firings: committer time, then key, then the triggering event id. */
export function compareFirings(a: Firing, b: Firing): number {
  return (
    compareCommitterTime(a.at, b.at) ||
    compareAccumulatorKeys(a.key, b.key) ||
    (a.triggeredBy < b.triggeredBy ? -1 : a.triggeredBy > b.triggeredBy ? 1 : 0)
  );
}

/**
 * The deterministic fold (spec 02 §4). Resolve supersessions to tips, totally order them, group
 * by accumulator key, and walk each group applying the leaky integrator.
 *
 * Complexity is O(n²) in the contributing list, because every decay step rescales every
 * residual weight so a firing can ship its evidence with live shares. That is the honest cost of
 * "every proposal ships its evidence" (spec 02 §5); epoch compaction (spec 02 §8) is the answer
 * when it starts to matter, not a cleverer fold.
 */
export function foldEvents(
  events: readonly LedgerEvent[],
  knobs: FoldKnobs,
): Parsed<FoldResult> {
  const guard = checkFoldKnobs(knobs);
  if (!guard.ok) return guard;

  const digest = knobsDigest(knobs);
  if (!digest.ok) return digest;

  // Guard and digest run BEFORE the walk, so an unusable knob is reported even for an empty
  // event set — a fold that silently succeeds on nothing is how a misconfigured budget survives
  // to the first real event.
  const grouping = groupTipsByKey(events);
  const walked = walkGrouping(grouping, () => knobs);
  if (!walked.ok) return walked;

  return ok({
    keys: grouping.keys,
    states: walked.value.states,
    firings: walked.value.firings.sort(compareFirings),
    knobs,
    knobsDigest: digest.value,
    tips: grouping.resolution.tips,
    forks: grouping.resolution.forks,
    dangling: grouping.resolution.dangling,
    eventCount: new Set(events.map((e) => e.event)).size,
  });
}

// ---------------------------------------------------------------------------
// The same fold, with one set of knobs PER KEY
// ---------------------------------------------------------------------------

/**
 * What `foldEvents` returns when the knobs are not one set but a lookup. Same walk, same
 * arithmetic, same order — the only difference is that `knobs` and `knobsDigest` are per key,
 * because `budget` and `half_life` are fields of an ASSERTION and every assertion has its own.
 */
export interface KeyedFoldResult {
  /** Keys that were actually folded, ascending. */
  readonly keys: readonly AccumulatorKey[];
  /** Keys present in the event set for which the resolver had no knobs (Q-56). Never dropped. */
  readonly unfolded: readonly AccumulatorKey[];
  readonly states: ReadonlyMap<AccumulatorKey, AccumulatorState>;
  readonly knobs: ReadonlyMap<AccumulatorKey, FoldKnobs>;
  readonly knobsDigest: ReadonlyMap<AccumulatorKey, Sha256Ref>;
  readonly firings: readonly Firing[];
  readonly tips: readonly LedgerEvent[];
  readonly forks: readonly SupersessionFork[];
  readonly dangling: readonly EventId[];
  readonly eventCount: number;
}

/**
 * The fold a real `.program/` needs: `INV-002` has `budget: 2.0, half_life: 180d` and `INV-003`
 * has `budget: 1.0, half_life: 365d`, so folding a whole ledger under ONE `FoldKnobs` would
 * measure every assertion against somebody else's threshold.
 *
 * Everything `foldEvents` guarantees still holds, for the same three reasons (the input is a set,
 * the tips are totally ordered, nothing observable is read out of a Map in Map order): same event
 * set + same resolver -> identical states, whatever order the array arrived in. Purity now
 * depends on the RESOLVER being pure too, which is why it is a function of the key alone.
 */
export function foldEventsPerKey(
  events: readonly LedgerEvent[],
  knobsFor: FoldKnobsFor,
): Parsed<KeyedFoldResult> {
  const grouping = groupTipsByKey(events);
  const walked = walkGrouping(grouping, knobsFor);
  if (!walked.ok) return walked;

  return ok({
    keys: grouping.keys.filter((k) => walked.value.states.has(k)),
    unfolded: walked.value.unfolded,
    states: walked.value.states,
    knobs: walked.value.knobs,
    knobsDigest: walked.value.digests,
    firings: walked.value.firings.sort(compareFirings),
    tips: grouping.resolution.tips,
    forks: grouping.resolution.forks,
    dangling: grouping.resolution.dangling,
    eventCount: new Set(events.map((e) => e.event)).size,
  });
}

/** Firings for one key out of a keyed fold, in committer-time order. */
export function keyedFiringsFor(
  result: KeyedFoldResult,
  key: AccumulatorKey,
): readonly Firing[] {
  return result.firings.filter((f) => f.key === key);
}

/**
 * Ages one accumulator to an EXPLICIT instant and re-tests the re-arm threshold — what
 * `gwtp ledger status` wants when it asks "how hot is this meter today?". The instant is a
 * parameter and never a clock read, so this stays as pure and as replayable as the fold itself.
 */
export function projectStateTo(
  state: AccumulatorState,
  at: CommitterTime,
  knobs: FoldKnobs,
): AccumulatorState {
  return rearm(decayStateTo(state, at, knobs.halfLife), knobs);
}

/** Convenience for the common single-assertion case. `null` when the key saw no events. */
export function stateFor(result: FoldResult, key: AccumulatorKey): AccumulatorState | null {
  return result.states.get(key) ?? null;
}

/** Firings for one key, in committer-time order. */
export function firingsFor(result: FoldResult, key: AccumulatorKey): readonly Firing[] {
  return result.firings.filter((f) => f.key === key);
}
