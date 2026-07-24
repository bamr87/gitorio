// Implements: docs/adr/0006-reference-stack.md ("Schemas in schemas/ are the contract either
// way") and INV-005 ("Engine core imports no forge-specific APIs; GitHub access lives in
// adapters/"). The forge-agnostic public surface: src/ledger, src/judge, src/evidence,
// src/cli and src/adapters import from here; nothing here imports from any of them.
//
// This barrel is a BOUNDARY in its own right. It re-exports every blind module wholesale, but
// from ./sentencing.js it re-exports TYPES ONLY, and from ./accumulator.js and ./dispersion.js
// it withholds the four DECLASSIFIERS. Obtaining `actorId`, `revealActor`, `surprise`,
// `revealSurprise`, `blindCommit`, `withSentencingWarrant`, `rawSurprise`,
// `toAccumulatorSnapshot`, `computeDispersion` or `toDispersionSnapshot` requires a deep import
// of `../core/sentencing.js`, `../core/accumulator.js` or `../core/dispersion.js` — exactly the
// single greppable line INV-003's deterministic prescreen (scripts/check-inv003.ts) looks for.
// With `verbatimModuleSyntax` on, an erased `import type` is textually distinguishable from a
// value import, so the prescreen can allow the first and fail the second under src/judge/** and
// src/evidence/**.
//
// WHY THE WITHHOLDING IS NOT REDUNDANT with the warrant parameters those four now take. A
// warrant is unforgeable only as long as `withSentencingWarrant` is unreachable; the barrel is
// what makes it unreachable. Two independent locks on the same door: even a caller who somehow
// held a warrant still cannot NAME `toAccumulatorSnapshot` without a deep import, and a caller
// with a deep import still needs the warrant. tests/core/barrel-surface.test.ts asserts the
// runtime export surface so a future `export *` cannot quietly reopen either lock.

export * from './brand.js';
export * from './result.js';
export * from './ids.js';
export * from './paths.js';
export * from './time.js';
export * from './canonical.js';
export * from './decode.js';
export * from './severity.js';
export * from './assertion.js';
export * from './precedent.js';
export * from './verdict.js';
export * from './change.js';
export * from './event.js';
// The provider-agnostic ModelClient PORT (spec 03 §1/§6, INV-005). Pure interfaces plus one
// stop-reason const; imports nothing, declassifies nothing, reaches no sentencing module — safe
// to re-export wholesale. src/judge imports the interface; only src/adapters/anthropic names the SDK.
export * from './model.js';
export * from './proposal.js';
// The forge-agnostic delivery port (spec 02 §5, INV-005). Safe to re-export wholesale: nothing
// in it declassifies — a DeliveryDocument is the UNTAINTED product of rendering, and
// `__DELIVERY_BLINDNESS_PROOFS` fails tsc if that ever stops being true.
export * from './delivery.js';
export * from './blindness.js';
export * from './evidence.js';
export * from './program.js';

// Sentencing: TYPES ONLY. Types that merely MENTION Surprise (AccumulatorState, Proposal)
// travel fine through the barrel — you can name them, you cannot read them, and Blind<T>
// rejects them from any evidence bundle.
//
// Deliberately NOT re-exported: actorId, revealActor, actorGroupKey, surprise, parseSurprise,
// revealSurprise, addSurprise, scaleSurprise, surpriseFrom, compareSurprise,
// surpriseReachesBudget, surpriseBelowFraction, withSentencingWarrant, blindCommit,
// isSentencingValue, SENTENCING_TAG, SENTENCING_WARRANT, ZERO_SURPRISE.
export type {
  ActorId,
  SentencingOnly,
  SentencingWarrant,
  SightedCommit,
  SightedCommitPort,
  Surprise,
} from './sentencing.js';

// Accumulator: everything EXCEPT the two declassifiers.
//
// Deliberately NOT re-exported: `rawSurprise` (LedgerEvent -> plain `number`, the increment
// term untainted) and `toAccumulatorSnapshot` (AccumulatorState -> a record whose `value` is a
// plain `number`, i.e. the meter reading). SEED-02 can build the ENTIRE leaky integrator from
// what is listed here — `surpriseOf` returns a `Surprise`, `shouldFire`/`rearm` answer in
// booleans — so nothing on the accumulation path needs either of them.
//
// `decayFactor`, `decay` and `accumulatorStep` stay: they are `number -> number` arithmetic
// and declassify nothing. Feeding them requires already holding a plain number.
export type {
  AccumulatorSnapshot,
  AccumulatorState,
  ArmState,
  ContributingEvent,
  Firing,
  FoldKnobs,
} from './accumulator.js';
export {
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
  surpriseOf,
} from './accumulator.js';

// Dispersion: types and the pure entropy helper only.
//
// Deliberately NOT re-exported: `computeDispersion` (ActorId + Surprise in, aggregates out) and
// `toDispersionSnapshot` (aggregates -> four plain numbers). `shannonEntropy` stays: it is
// `number[] -> EntropyStat`, with no sentencing value anywhere in its signature.
export type {
  DispersionInput,
  DispersionStats,
  DispersionWeighting,
  EntropyStat,
  EvidenceLocus,
  TimeSpread,
} from './dispersion.js';
export { shannonEntropy } from './dispersion.js';

/**
 * The four binding contracts, by `$id`. `gwtp validate` maps artifacts onto these.
 *
 * Deliberately four entries and no more: manifest, scope, trajectory, accumulator and
 * epoch-snapshot artifacts have no schema today (docs/spec/OPEN-QUESTIONS.md Q-08), and
 * inventing `$id`s for them here would quietly manufacture a contract SEED-01 has no
 * authority to write.
 */
export const SCHEMA_ID = {
  assertion: 'gwtp/assertion.schema.json',
  event: 'gwtp/event.schema.json',
  verdict: 'gwtp/verdict.schema.json',
  precedent: 'gwtp/precedent.schema.json',
} as const;
