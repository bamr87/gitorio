// Implements: docs/spec/02-ledger.md §5 (firing: dispersion decides direction) and
// docs/adr/0003-judge-blindness.md ("authorship is used only downstream, in dispersion
// statistics at firing time").
//
// `computeDispersion` is the SANCTIONED DECLASSIFIER: tainted `ActorId` and `Surprise` in,
// aggregate statistics out. Together with `toDispersionSnapshot` (which turns those aggregates
// into four plain numbers for the ledger) it is the only route in this module from sentencing
// data to untainted data — and BOTH take a `SentencingWarrant` from the caller, so both are a
// call with an extra argument rather than a plain property read. That makes INV-003 auditable
// by inspection, mechanically checkable by `scripts/check-inv003.ts`, and checkable by GWTP's
// own dependency judge later.

import type { ContributingEvent } from './accumulator.js';
import type { DispersionSnapshot } from './event.js';
import type { AccumulatorKey, EventId } from './ids.js';
import type { RepoPath } from './paths.js';
import { type ContractError, err, ok, type Decoded } from './result.js';
import {
  type ActorId,
  type SentencingWarrant,
  actorGroupKey,
  revealSurprise,
} from './sentencing.js';
import { type CommitterTime, committerTimeMillis } from './time.js';

/**
 * Where a contributing event landed and whose hand made it. Resolved OUTSIDE the fold,
 * because the event schema records no touched-path list for drift events (only stale-claim
 * events carry `subject.path`) — see docs/spec/OPEN-QUESTIONS.md Q-17. Supplied by a
 * git-side resolver; src/core only consumes it, and only here.
 */
export interface EvidenceLocus {
  readonly event: EventId;
  readonly actor: ActorId;
  readonly paths: readonly RepoPath[];
}

/**
 * spec 02 §5 says dispersion runs over "the contributing (undecayed-weighted) events", which
 * reads two ways. `residual` weights each event by its decayed share at firing time
 * (default); `uniform` gives every event weight 1. Recorded on the stats so any figure is
 * self-describing. See OPEN-QUESTIONS Q-18.
 */
export type DispersionWeighting = 'residual' | 'uniform';

export interface EntropyStat {
  /** Shannon entropy in BITS (log2), the natural companion to a base-2 decay. */
  readonly bits: number;
  /** bits / log2(distinct); 0 when distinct <= 1. Comparable across cardinalities. */
  readonly normalized: number;
  readonly distinct: number;
}

export interface TimeSpread {
  readonly firstAt: CommitterTime;
  readonly lastAt: CommitterTime;
  readonly spanMs: number;
  /**
   * Weight-aware spread. Distinguishes "sustained pressure" from "one tight burst plus one
   * ancient straggler", which share a `spanMs`.
   */
  readonly weightedStdDevMs: number;
}

/**
 * Aggregate only — no `ActorId`, no `Surprise`. Untainted by construction, which is what lets
 * it ride in a ledger event's `dispersion_snapshot`. It is nevertheless forbidden from
 * evidence bundles by `Blind<T>`: aggregates about who is drifting are still sentencing data,
 * and no judge has business seeing them.
 */
export interface DispersionStats {
  readonly key: AccumulatorKey;
  /** "How many independent hands." */
  readonly authorEntropy: EntropyStat;
  /** "One seam or many call sites." */
  readonly pathEntropy: EntropyStat;
  /** "A tight burst or sustained pressure." */
  readonly timeSpread: TimeSpread;
  /**
   * compliances / (compliances + violations), in [0,1]; `null` when both are 0. The literal
   * "violation-to-compliance ratio" is unbounded and undefined at zero compliances, so this
   * is the least-committal bounded reading. See OPEN-QUESTIONS Q-19.
   */
  readonly complianceRatio: number | null;
  readonly weighting: DispersionWeighting;
  readonly eventCount: number;
}

/**
 * `-sum(p log2 p)` over normalised non-negative weights. Non-positive weights are dropped;
 * empty or single-category input yields zeros. The only statistic spec 02 §5 actually names,
 * so the only one src/core provides.
 */
export function shannonEntropy(weights: readonly number[]): EntropyStat {
  const positive = weights.filter((w) => Number.isFinite(w) && w > 0);
  const total = positive.reduce((a, b) => a + b, 0);
  if (total <= 0 || positive.length === 0) return { bits: 0, normalized: 0, distinct: 0 };
  if (positive.length === 1) return { bits: 0, normalized: 0, distinct: 1 };
  let bits = 0;
  for (const w of positive) {
    const p = w / total;
    bits -= p * Math.log2(p);
  }
  const max = Math.log2(positive.length);
  return { bits, normalized: max > 0 ? bits / max : 0, distinct: positive.length };
}

export interface DispersionInput {
  readonly key: AccumulatorKey;
  readonly contributing: readonly ContributingEvent[];
  readonly loci: ReadonlyMap<EventId, EvidenceLocus>;
  readonly complianceCount: number;
  readonly weighting?: DispersionWeighting;
}

/**
 * The declassification point. Pure. An event whose weight splits across n paths contributes
 * `weight / n` to each. Errors with `unresolved-locus` if any contributing event has no
 * locus — biased statistics fail loud rather than quietly favouring "refactor".
 *
 * Takes the warrant from its CALLER rather than minting one, on the same principle as
 * `toAccumulatorSnapshot`: a declassification is a call with an extra argument, and the
 * argument is only obtainable by value-importing `./sentencing.js`.
 */
export function computeDispersion(
  input: DispersionInput,
  warrant: SentencingWarrant,
): Decoded<DispersionStats> {
  const weighting = input.weighting ?? 'residual';
  const errors: ContractError[] = [];

  if (input.contributing.length === 0) {
    return err([
      { code: 'unresolved-locus', message: 'dispersion requires at least one contributing event' },
    ]);
  }

  const authorWeights = new Map<string, number>();
  const pathWeights = new Map<string, number>();
  const times: { at: number; weight: number }[] = [];

  for (const c of input.contributing) {
    const locus = input.loci.get(c.event);
    if (locus === undefined) {
      errors.push({
        code: 'unresolved-locus',
        message: `no evidence locus for contributing event ${c.event}`,
      });
      continue;
    }
    const weight = weighting === 'uniform' ? 1 : revealSurprise(c.residualWeight, warrant);
    if (!(weight > 0)) continue;

    const actorKey = actorGroupKey(locus.actor);
    authorWeights.set(actorKey, (authorWeights.get(actorKey) ?? 0) + weight);

    const paths = locus.paths.length === 0 ? ['<unknown>'] : locus.paths;
    const share = weight / paths.length;
    for (const p of paths) pathWeights.set(p, (pathWeights.get(p) ?? 0) + share);

    times.push({ at: committerTimeMillis(c.t), weight });
  }

  if (errors.length > 0) return err(errors);
  if (times.length === 0) {
    return err([
      { code: 'unresolved-locus', message: 'every contributing event carried zero weight' },
    ]);
  }

  const totalWeight = times.reduce((a, b) => a + b.weight, 0);
  const mean = times.reduce((a, b) => a + b.at * b.weight, 0) / totalWeight;
  const variance = times.reduce((a, b) => a + b.weight * (b.at - mean) ** 2, 0) / totalWeight;

  const sortedTimes = input.contributing
    .map((c) => c.t)
    .sort((a, b) => committerTimeMillis(a) - committerTimeMillis(b));
  const firstAt = sortedTimes[0] as CommitterTime;
  const lastAt = sortedTimes[sortedTimes.length - 1] as CommitterTime;

  const violations = input.contributing.length;
  const denominator = violations + input.complianceCount;

  return ok({
    key: input.key,
    authorEntropy: shannonEntropy([...authorWeights.values()]),
    pathEntropy: shannonEntropy([...pathWeights.values()]),
    timeSpread: {
      firstAt,
      lastAt,
      spanMs: committerTimeMillis(lastAt) - committerTimeMillis(firstAt),
      weightedStdDevMs: Math.sqrt(variance),
    },
    complianceRatio: denominator === 0 ? null : input.complianceCount / denominator,
    weighting,
    eventCount: violations,
  });
}

/**
 * Normalized entropies + span, for the firing event's `dispersion_snapshot` (spec 02 §2).
 *
 * DECLASSIFIER, and the least obvious of the three. `DispersionStats` is listed in
 * `SentencingOnlyValue`, so `Blind<T>` rejects it from any evidence bundle; `DispersionSnapshot`
 * is four plain numbers and is rejected only by field NAME. Unwrapping one into the other
 * therefore launders "how many independent hands are drifting" into values a judge could hold,
 * so it takes a warrant like the rest.
 */
export function toDispersionSnapshot(
  s: DispersionStats,
  _warrant: SentencingWarrant,
): DispersionSnapshot {
  return {
    author_entropy: s.authorEntropy.normalized,
    path_entropy: s.pathEntropy.normalized,
    time_spread: s.timeSpread.spanMs,
    compliance_ratio: s.complianceRatio,
  };
}
