// Implements: docs/spec/03-judge.md §5 ("Panels turn disagreement into signal": for
// judgment-class assertions with high precision, sample N=3, take the MEDIAN severity, and let
// inter-judge variance either DISCOUNT the event's effective surprise or bounce the case to a
// human) and §4 (aligned stays terse, abstain never accumulates and escalates). SEED-03
// deliverable 4.
//
// Two halves, deliberately separable:
//   - SAMPLING is injected: `samplePanel` runs an array of `Judge`s over one sealed bundle. The
//     panel does not know or care whether a sample came from a model, a deterministic check, or a
//     canned fake — which is exactly what lets the tests seat fakes and hold no model in the loop.
//   - The DECISION is pure over the sampled verdicts: `decidePanel` takes `readonly Verdict[]` and
//     nothing else. Median, spread, escalation and the surprise discount are all functions of the
//     ballots, so the whole judgment is replayable and property-testable without any I/O.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  BLIND MODULE (INV-003). Under `src/judge/**`. Every value import leads only to
//  `severity`/`verdict`/`ids`/`result` (none reach the sentencing branch); `SealedEvidence` and
//  `Judge` are TYPE-ONLY (a value import of `core/evidence.js` reaches `core/blindness.ts` →
//  `core/sentencing.ts`, Q-60). The panel reasons over `Verdict` values, which src/core proves
//  blind (`Proof<IsBlind<Verdict>>`), and over the four anchored severity rungs — never over a
//  meter reading, a running total, or an author.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// On Q-27: spec 03 §5 says variance may "discount the event's effective surprise", but
// `event.severity` is enum-constrained to the four anchors, so a discounted increment is not
// representable in the event today. This module therefore EXPOSES `surpriseMultiplier` (a
// dimensionless factor in [0,1]) and `spread` on the decision rather than folding a discount that
// has nowhere to be recorded; wiring it into effective surprise is the ledger side's call once
// Q-27 is answered. The panel is blind to precision, so it emits a factor, never a surprise.

import type { AccumulatorKey } from '../core/ids.js';
import { fail, ok, type Parsed } from '../core/result.js';
import {
  SEVERITY_ORDINALS,
  medianSeverityOrdinal,
  severityRungSpread,
  type SeverityOrdinal,
} from '../core/severity.js';
import {
  isViolation,
  verdictDisposition,
  type AbstainVerdict,
  type AlignedVerdict,
  type Verdict,
  type VerdictDisposition,
  type ViolationVerdict,
} from '../core/verdict.js';
// TYPE-ONLY, and load-bearing that it stays that way — see the header.
import type { Judge, SealedEvidence } from '../core/evidence.js';

// ---------------------------------------------------------------------------
// Policy (arguable knobs, named exports so a reprogramming proposal has something to argue with)
// ---------------------------------------------------------------------------

/** The widest possible disagreement: `entrenches` (rank 3) against `grazes` (rank 0). */
export const MAX_SEVERITY_SPREAD = SEVERITY_ORDINALS.length - 1;

/**
 * How a panel turns disagreement into a number.
 *
 * `size`            — N. Spec 03 §5 fixes it at 3; kept a knob so a high-precision assertion can
 *                     seat a wider bench without a code change. Only used to compute the majority
 *                     threshold; `decidePanel` accepts whatever ballots it is handed.
 * `escalateAtSpread`— the disagreement at which the case bounces to a HUMAN instead of being
 *                     recorded with a discount. Default `MAX_SEVERITY_SPREAD` (3): only a bench
 *                     that splits all the way from "grazes" to "entrenches" is too uncertain to
 *                     leave in the ledger. Everything narrower is signal the ledger keeps
 *                     (spec 03 §5: "that uncertainty belongs in the ledger, not papered over").
 * `discountWeight`  — how hard variance discounts effective surprise. Default 1: a maximal spread
 *                     fully discounts (multiplier 0), a unanimous bench discounts nothing
 *                     (multiplier 1), and it is linear in the rung spread between.
 *
 * This is engine judgement, NOT spec text — spec 03 §5 states the mechanism ("median", "discount
 * or escalate") and no numbers — so it is a named constant a proposal can contest, the same
 * posture `IMPORT_FORM_SEVERITY` takes for the deterministic rung. See OPEN-QUESTIONS Q-27.
 */
export interface PanelPolicy {
  readonly size: number;
  readonly escalateAtSpread: number;
  readonly discountWeight: number;
}

export const DEFAULT_PANEL_POLICY: PanelPolicy = {
  size: 3,
  escalateAtSpread: MAX_SEVERITY_SPREAD,
  discountWeight: 1,
};

/**
 * The variance discount on effective surprise (Q-27), as a factor in [0,1]:
 * `1 − discountWeight · spread / MAX_SEVERITY_SPREAD`, clamped. Unanimous (spread 0) → 1, i.e. no
 * discount; maximal split (spread 3, weight 1) → 0, i.e. the surprise is entirely discounted and
 * the case has almost certainly also escalated. Linear between, so a one-rung disagreement shaves
 * a third with the default weight.
 */
export function surpriseMultiplier(spread: number, policy: PanelPolicy = DEFAULT_PANEL_POLICY): number {
  const raw = 1 - (policy.discountWeight * spread) / MAX_SEVERITY_SPREAD;
  return raw < 0 ? 0 : raw > 1 ? 1 : raw;
}

/** N=3 → 2. The number of concurring ballots a disposition needs to carry the panel. */
export function majorityThreshold(size: number): number {
  return Math.floor(size / 2) + 1;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export interface PanelTally {
  readonly violation: number;
  readonly compliance: number;
  readonly abstention: number;
}

export interface PanelDecision {
  readonly assertion: AccumulatorKey;
  /** The ballots, in the order sampled. */
  readonly samples: readonly Verdict[];
  readonly tally: PanelTally;
  /** The panel's disposition, decided by majority (see `decidePanel`). */
  readonly disposition: VerdictDisposition;
  /**
   * The representative ruling the panel records. For a violation this IS one of the sampled
   * violation verdicts — the one carrying the median severity, so its citations and rationale are
   * a real magistrate's and "no citation, no verdict" (INV-004) is preserved. For compliance /
   * abstention it is a terse synthesized verdict (spec 03 §4).
   */
  readonly verdict: Verdict;
  /** Present iff the disposition is a violation. The median rung across the violating ballots. */
  readonly severity?: SeverityOrdinal;
  /** Inter-judge severity disagreement across the violating ballots (0 when not a violation). */
  readonly spread: number;
  /** Bounce to a human: a violation split at/above `escalateAtSpread`, or a bench with no majority. */
  readonly escalate: boolean;
  /** The variance discount on effective surprise (Q-27); 1 when there is nothing to discount. */
  readonly surpriseMultiplier: number;
}

function tallyOf(samples: readonly Verdict[]): PanelTally {
  let violation = 0;
  let compliance = 0;
  let abstention = 0;
  for (const v of samples) {
    const d = verdictDisposition(v);
    if (d === 'violation') violation += 1;
    else if (d === 'compliance') compliance += 1;
    else abstention += 1;
  }
  return { violation, compliance, abstention };
}

/** Terse aligned/abstain representatives (spec 03 §4): the union type has nowhere to put more. */
function alignment(assertion: AccumulatorKey): AlignedVerdict {
  return { assertion, verdict: 'aligned' };
}
function abstention(assertion: AccumulatorKey, rationale: string): AbstainVerdict {
  return { assertion, verdict: 'abstain', rationale };
}

/**
 * THE PANEL, pure over its ballots (spec 03 §5). Not a `Judge`: a panel's product is richer than a
 * single `Verdict` — it carries the median severity, the disagreement, the escalation decision and
 * the surprise discount that a bench exists to produce.
 *
 * Majority rule (documented, least-committal): a disposition carries the panel when at least
 * `majorityThreshold(N)` ballots share it. With that,
 *   - VIOLATION majority → the panel rules a violation. Severity is the MEDIAN over the violating
 *     ballots (`medianSeverityOrdinal`, which breaks an even split toward leniency); the spread is
 *     `severityRungSpread` over the same; the case escalates to a human at/above
 *     `escalateAtSpread`, and otherwise records `surpriseMultiplier(spread)`.
 *   - COMPLIANCE majority → aligned, terse, nothing to discount, no escalation.
 *   - otherwise (ABSTAIN majority, OR a three-way split with no majority) → abstain and ESCALATE:
 *     at the panel rung the next step up the ladder is a human (spec 03 §5), and an abstention
 *     never accumulates (spec 03 §4). A bench that cannot muster a majority for guilt or innocence
 *     is precisely the uncertainty that belongs with a human, not papered into a forced call.
 *
 * All ballots must name one assertion (spec 03 §1: one assertion per invocation); a mismatch or an
 * empty panel fails rather than silently picking one.
 */
export function decidePanel(
  samples: readonly Verdict[],
  policy: PanelPolicy = DEFAULT_PANEL_POLICY,
): Parsed<PanelDecision> {
  if (samples.length === 0) {
    return fail('missing-field', 'a panel over zero ballots has nothing to decide');
  }
  const assertion = (samples[0] as Verdict).assertion;
  for (const v of samples) {
    if (v.assertion !== assertion) {
      return fail(
        'invalid-verdict',
        `a panel rules on ONE assertion (spec 03 §1); got ${assertion} and ${v.assertion}`,
      );
    }
  }

  const tally = tallyOf(samples);
  const need = majorityThreshold(policy.size);

  // Violation majority: median severity, spread, discount-or-escalate.
  if (tally.violation >= need) {
    const violations = samples.filter(isViolation);
    const severities = violations.map((v) => v.severity);
    const median = medianSeverityOrdinal(severities);
    if (!median.ok) return median;
    const spread = severityRungSpread(severities);
    // A real ballot carries the median rung — its citations and rationale are a magistrate's, so
    // the recorded verdict satisfies INV-004 rather than being synthesized without evidence.
    const representative = violations.find(
      (v) => v.severity === median.value,
    ) as ViolationVerdict;
    return ok({
      assertion,
      samples,
      tally,
      disposition: 'violation',
      verdict: representative,
      severity: median.value,
      spread,
      escalate: spread >= policy.escalateAtSpread,
      surpriseMultiplier: surpriseMultiplier(spread, policy),
    });
  }

  // Compliance majority: terse aligned, nothing accumulates, nothing to escalate.
  if (tally.compliance >= need) {
    return ok({
      assertion,
      samples,
      tally,
      disposition: 'compliance',
      verdict: alignment(assertion),
      spread: 0,
      escalate: false,
      surpriseMultiplier: 1,
    });
  }

  // Abstain majority, or no majority at all: honest uncertainty → a human (spec 03 §4-§5).
  return ok({
    assertion,
    samples,
    tally,
    disposition: 'abstention',
    verdict: abstention(
      assertion,
      `panel of ${samples.length} reached no majority for guilt or innocence ` +
        `(violation ${tally.violation}, compliance ${tally.compliance}, abstain ${tally.abstention}); ` +
        'escalating to a human rather than forcing a call (spec 03 §5).',
    ),
    spread: 0,
    escalate: true,
    surpriseMultiplier: 1,
  });
}

// ---------------------------------------------------------------------------
// Sampling (injected — no real model in the loop)
// ---------------------------------------------------------------------------

/**
 * Run each seated `Judge` over ONE sealed bundle and collect the ballots (spec 03 §5: "sample
 * N=3"). The judges are the injection point: in production they are N differently-seeded model
 * benches; in tests they are fakes returning canned verdicts. Sampling in order keeps the ballot
 * list deterministic, which keeps `decidePanel`'s representative selection deterministic.
 *
 * The panel is `SealedEvidence`-in only — the same blind bundle every judge on the bench sees — so
 * no ballot can have been cast with knowledge of authorship or the meter (ADR-0003).
 */
export async function samplePanel(
  judges: readonly Judge[],
  sealed: SealedEvidence,
): Promise<readonly Verdict[]> {
  const ballots: Verdict[] = [];
  for (const judge of judges) {
    ballots.push(await judge(sealed));
  }
  return ballots;
}

/**
 * Seat a bench: sample N judges over the sealed bundle, then decide. The one call a caller makes to
 * run a panel end to end. Returns the decision or the first contract failure (empty bench, ballots
 * disagreeing on the assertion).
 */
export async function runPanel(
  judges: readonly Judge[],
  sealed: SealedEvidence,
  policy: PanelPolicy = DEFAULT_PANEL_POLICY,
): Promise<Parsed<PanelDecision>> {
  const samples = await samplePanel(judges, sealed);
  return decidePanel(samples, policy);
}
