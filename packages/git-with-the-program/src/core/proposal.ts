// Implements: docs/spec/02-ledger.md §5 (firing: dispersion decides direction) and
// docs/vision.md ("the bidirectional hinge"). The two outputs: the code is wrong, or the law
// is wrong.
//
// Thresholds are CONFIGURATION, not spec. spec 02 §5 states the rule qualitatively and gives
// no numbers, so `classifyFiring` takes an explicit policy and the provisional constants are
// exported under a name that says they are provisional. Inventing law here would be inventing
// law. See docs/spec/OPEN-QUESTIONS.md Q-22.

import type { Budget } from './assertion.js';
import type { ContributingEvent, FoldKnobs } from './accumulator.js';
import type { DispersionStats } from './dispersion.js';
import type { NonEmptyReadonlyArray } from './brand.js';
import type { AccumulatorKey, EventId } from './ids.js';
import type { Surprise } from './sentencing.js';
import { MILLIS_PER_DAY } from './time.js';
import type { CommitterTime } from './time.js';

/**
 * `refactor`  — refactoring recommendation: the code is wrong, the assertion stands.
 * `reprogram` — reprogramming proposal: the law is wrong. A PR against `.program/`; the
 *               assertion goes `contested` and enforcement mutes (spec 01 §4.2, GLOSSARY).
 */
export type ProposalKind = 'refactor' | 'reprogram';

export interface DispersionPolicy {
  readonly authorEntropyMin: number;
  readonly minDistinctAuthors: number;
  readonly pathEntropyMin: number;
  readonly timeSpreadMinMs: number;
}

/**
 * NOT from any spec. Provisional so SEED-02 has a runnable default instead of silently
 * inventing one at the call site. These knobs are governance-relevant enough to belong in
 * `.program/` and must be ratified before v1 — see proposals/PROPOSED-program-amendment.md.
 */
export const PROVISIONAL_DISPERSION_POLICY: DispersionPolicy = {
  authorEntropyMin: 0.6,
  minDistinctAuthors: 3,
  pathEntropyMin: 0.5,
  timeSpreadMinMs: 60 * MILLIS_PER_DAY,
};

/**
 * Conjunction, faithful to spec 02 §5's table: `reprogram` requires HIGH author entropy AND
 * enough distinct hands AND high path entropy AND a sustained window. Anything short of all
 * four is `refactor` — one person drifting versus the org outvoting the statute, decided by
 * statistics instead of vibes.
 */
export function classifyFiring(stats: DispersionStats, policy: DispersionPolicy): ProposalKind {
  const sustained = stats.timeSpread.spanMs >= policy.timeSpreadMinMs;
  const manyHands =
    stats.authorEntropy.normalized >= policy.authorEntropyMin &&
    stats.authorEntropy.distinct >= policy.minDistinctAuthors;
  const manySeams = stats.pathEntropy.normalized >= policy.pathEntropyMin;
  return sustained && manyHands && manySeams ? 'reprogram' : 'refactor';
}

/**
 * "Every proposal ships its evidence: contributing events, dispersion stats, compliance
 * ratio, decay-weighted total" (spec 02 §5) — plus the knobs, so any reader can replay the
 * firing.
 */
export interface ProposalEvidence {
  readonly contributing: NonEmptyReadonlyArray<ContributingEvent>;
  readonly dispersion: DispersionStats;
  readonly violationCount: number;
  readonly complianceCount: number;
  /** The decay-weighted total at firing. */
  readonly accumulated: Surprise;
  readonly budget: Budget;
  readonly knobs: FoldKnobs;
}

/**
 * Unschema'd — there is no proposal.schema.json. Delivery (issue vs `.program/` PR) belongs
 * to src/adapters/github; this type is forge-agnostic (INV-005).
 *
 * Tainted via `ProposalEvidence`, and correctly so: a proposal is accumulator state made
 * legible, and must never reach a judge. Rendering it requires a warrant.
 */
export interface Proposal {
  readonly kind: ProposalKind;
  readonly key: AccumulatorKey;
  readonly firedAt: CommitterTime;
  readonly triggeredBy: EventId;
  readonly evidence: ProposalEvidence;
}
