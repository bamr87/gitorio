// Implements: docs/spec/02-ledger.md §5 (firing: dispersion decides direction) and §6
// (post-fire lifecycle: hysteresis, outcomes are events too), docs/adr/0003-judge-blindness.md
// (authorship read only at firing time) and docs/vision.md ("the bidirectional hinge").
//
// The detector is upstream of this file: `shouldFire()` (src/core/accumulator.ts) answers
// "A >= budget AND armed" and the fold produces a `Firing`. What lives HERE is everything that
// happens once the unit spikes:
//
//   Firing ──▶ loci (src/ledger/sighted.ts) ──▶ computeDispersion ──▶ classifyFiring
//                                                                          │
//                             ┌────────────────────────────────────────────┤
//                             ▼                                            ▼
//                       refactor: the code is wrong              reprogram: the law is wrong
//                             └──────────────── Proposal + a firing ledger event ────────────┘
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  SENTENCING-SIDE MODULE, for the same reason src/ledger/sighted.ts is: it holds `Surprise`,
//  it holds `DispersionStats`, and it value-imports the declassifiers. Nothing under
//  src/judge/** or src/evidence/** may import it, directly or transitively (INV-003).
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// TWO THINGS THIS FILE DELIBERATELY DOES NOT DO:
//
//  1. It does not WRITE. Every post-fire artifact — the affirmed precedent, the precision
//     raise, the status amendment — comes back as a proposed unified diff plus rationale. A
//     machine writing to `.program/` is the single act INV-001 forbids at precision 1.0 and
//     budget 1.0: one breach fires immediately. The framework proposing an amendment to its own
//     constitution must still ask a human to apply it. (docs/spec/OPEN-QUESTIONS.md Q-30 is the
//     same collision, met by SEED-01.)
//  2. It does not DELIVER. Rendering a proposal to markdown is forge-agnostic and lives here;
//     opening the issue or the `.program/` PR is `src/adapters/github/**` (INV-005).
//
// Thresholds are NOT law. spec 02 §5 states the refactor/reprogram rule qualitatively and gives
// no numbers, so `classifyFiring` takes a policy and `PROVISIONAL_DISPERSION_POLICY` is only a
// runnable default. Every rendered proposal says so in its first paragraph — see Q-22 and
// proposals/PROPOSED-program-amendment.md Amendment 3.

import {
  type AccumulatorKey,
  type AccumulatorState,
  type Assertion,
  type Budget,
  type CommitterTime,
  type ContractError,
  type Decoded,
  type DispersionPolicy,
  type DispersionSnapshot,
  type DispersionStats,
  type DispersionWeighting,
  type EventBody,
  type EventId,
  type EvidenceLocus,
  type Firing,
  type FoldKnobs,
  type JudgeRef,
  type LedgerEvent,
  type NonEmptyReadonlyArray,
  type Parsed,
  type Precedent,
  type PrecedentId,
  type Precision,
  type Proposal,
  type ProposalKind,
  type ProvenanceRef,
  MILLIS_PER_DAY,
  PROVISIONAL_DISPERSION_POLICY,
  classifyFiring,
  committerTimeMillis,
  emptyAccumulator,
  err,
  fail,
  isAssertionKey,
  isNonEmpty,
  ok,
  parseJudgeId,
  parsePrecision,
  parsePrecedentId,
  sealEvent,
  unwrap,
} from '../core/index.js';
// The two declassifiers the barrel withholds. This deep import is the greppable line
// `scripts/check-inv003.ts` forbids under src/judge/** and src/evidence/** — and permits here,
// because src/ledger is where spec 02 §5 says the statistics are computed.
import { computeDispersion, toDispersionSnapshot } from '../core/dispersion.js';
import {
  type SentencingWarrant,
  type Surprise,
  revealSurprise,
  withSentencingWarrant,
} from '../core/sentencing.js';

// ---------------------------------------------------------------------------
// The one warrant mint in the ledger engine
// ---------------------------------------------------------------------------

/**
 * ADR-0003 permits author identity and the accumulator to be read at exactly one moment:
 * firing time. This function is that moment, named for it.
 *
 * Everything downstream — `assembleFiring`, `renderProposal`, `describeEvidenceLocus` — takes
 * the warrant as a PARAMETER rather than minting its own, exactly as `computeDispersion` and
 * `toAccumulatorSnapshot` do in src/core. So the audit is a two-step grep with a small, fixed
 * answer: `withSentencingWarrant` is value-imported by exactly two modules in src/ledger — here,
 * and `fold.ts`, whose warrant never leaves the walk and only computes `ContributingEvent.
 * rawWeight` — and every declassification is a call carrying an argument that can only have come
 * from one of them. `tests/ledger/blindness-boundary.test.ts` asserts that list from the import
 * graph, so a third minter cannot appear quietly.
 */
export function atFiringTime<R>(fn: (warrant: SentencingWarrant) => R): R {
  return withSentencingWarrant(fn);
}

// ---------------------------------------------------------------------------
// Firing -> Proposal
// ---------------------------------------------------------------------------

/**
 * The firing is recorded by the ledger engine itself, not by a magistrate: a threshold crossing
 * is arithmetic, so the judge rung is `deterministic` and the id names the component rather
 * than a model or a seat.
 */
export const FIRING_JUDGE_ID = 'ledger-firing-detector';

export const DEFAULT_FIRING_JUDGE: JudgeRef = {
  kind: 'deterministic',
  id: unwrap(parseJudgeId(FIRING_JUDGE_ID)),
};

/**
 * The verdict a firing event carries. See docs/spec/OPEN-QUESTIONS.md Q-46.
 *
 * `schemas/event.schema.json` says `dispersion_snapshot` is "present only on firing events", so
 * a firing IS an event — but the `verdict` enum holds five JUDGE rulings and none of them means
 * "the meter crossed its budget". Of the five, `abstain` is the only one that cannot change
 * what the fold computes: violations accumulate surprise, `aligned` inflates the compliance
 * ratio that ships in the next proposal as evidence quality, and `abstain` does neither
 * (spec 02 §4: "abstain never accumulates"). Recording an outcome must not perturb the
 * observations it summarises, so the inert one wins.
 */
export const FIRING_EVENT_VERDICT = 'abstain' as const;

/**
 * The sanctioned way to tell a firing event from a judge's abstention, given Q-46's overload.
 * `dispersion_snapshot` is present on nothing else, and the judge ref names the detector.
 */
export function isFiringEvent(e: LedgerEvent): boolean {
  return e.dispersion_snapshot !== undefined;
}

export interface FiringAssemblyInput {
  readonly firing: Firing;
  /** The event named by `firing.triggeredBy`; supplies the subject the firing event inherits. */
  readonly trigger: LedgerEvent;
  readonly loci: ReadonlyMap<EventId, EvidenceLocus>;
  /** Counted, never subtracted (spec 02 §4). Ships as evidence quality. */
  readonly complianceCount: number;
  /** Defaults to the contributing count; pass the accumulator's own census when it differs. */
  readonly violationCount?: number;
  readonly knobs: FoldKnobs;
  /** Omit for `PROVISIONAL_DISPERSION_POLICY`; the rendered output says which was used. */
  readonly policy?: DispersionPolicy;
  readonly weighting?: DispersionWeighting;
  readonly judge?: JudgeRef;
  /**
   * Free-text caveats about the evidence itself, rendered into the proposal — "3 of 7
   * contributing commits were rebased away (ADR-0004)", "1 locus attributed to silence".
   * `src/ledger/sighted.ts` exposes `orphanedCount` / `unattributedCount` to fill them.
   */
  readonly evidenceNotes?: readonly string[];
}

export type PolicyStatus = 'provisional' | 'caller-supplied';

export interface AssembledFiring {
  readonly proposal: Proposal;
  /** Sealed, content-addressed, ready for `EventStore.append`. Nothing here writes it. */
  readonly event: LedgerEvent;
  readonly snapshot: DispersionSnapshot;
  readonly policy: DispersionPolicy;
  /** `provisional` puts the "not ratified law" banner at the top of the rendered proposal. */
  readonly policyStatus: PolicyStatus;
  readonly evidenceNotes: readonly string[];
}

function samePolicy(a: DispersionPolicy, b: DispersionPolicy): boolean {
  return (
    a.authorEntropyMin === b.authorEntropyMin &&
    a.minDistinctAuthors === b.minDistinctAuthors &&
    a.pathEntropyMin === b.pathEntropyMin &&
    a.timeSpreadMinMs === b.timeSpreadMinMs
  );
}

/**
 * The whole of spec 02 §5 in one function: resolve, measure, classify, bundle, record.
 *
 * Fails loud rather than degrading. An unresolved locus, an empty contributing set and a
 * trigger that does not match the firing all come back as contract errors, because every one of
 * them would bias the statistics toward "low entropy, tight window" — which is `refactor`,
 * which is the answer that leaves the constitution untouched. A classifier whose failure mode
 * is "never propose amending the law" is not neutral, it is conservative by accident.
 */
export function assembleFiring(
  input: FiringAssemblyInput,
  warrant: SentencingWarrant,
): Decoded<AssembledFiring> {
  const { firing, trigger } = input;

  if (trigger.event !== firing.triggeredBy) {
    return err([
      {
        code: 'invalid-id',
        message: `trigger event ${trigger.event} is not the event the firing names (${firing.triggeredBy})`,
        at: '/trigger',
      },
    ]);
  }
  if (trigger.assertion !== firing.key) {
    return err([
      {
        code: 'invalid-id',
        message: `trigger event is keyed ${trigger.assertion}, the firing is keyed ${firing.key}`,
        at: '/trigger/assertion',
      },
    ]);
  }
  const contributing = firing.contributing;
  if (!isNonEmpty(contributing)) {
    return err([
      {
        code: 'missing-field',
        message:
          'a firing with no contributing events cannot ship its evidence (spec 02 §5: "every ' +
          'proposal ships its evidence")',
        at: '/firing/contributing',
      },
    ]);
  }

  const stats = computeDispersion(
    {
      key: firing.key,
      contributing,
      loci: input.loci,
      complianceCount: input.complianceCount,
      ...(input.weighting !== undefined ? { weighting: input.weighting } : {}),
    },
    warrant,
  );
  if (!stats.ok) return stats;

  const policy = input.policy ?? PROVISIONAL_DISPERSION_POLICY;
  const kind: ProposalKind = classifyFiring(stats.value, policy);
  const snapshot = toDispersionSnapshot(stats.value, warrant);
  const judge = input.judge ?? DEFAULT_FIRING_JUDGE;

  // Built directly rather than through `eventBodyFromVerdict`, which src/core documents as "the
  // single sanctioned Verdict -> LedgerEvent transition": a firing is not a verdict, so routing
  // it through the verdict minter would be the actual category error. `sealEvent` — the
  // identity and idempotency gate — is still the only way the record acquires an id.
  const body: EventBody = {
    subject: trigger.subject,
    assertion: firing.key,
    judge,
    t: firing.at,
    supersedes: null,
    dispersion_snapshot: snapshot,
    verdict: FIRING_EVENT_VERDICT,
  };
  const event = sealEvent(body);
  if (!event.ok) return err([event.error]);

  const proposal: Proposal = {
    kind,
    key: firing.key,
    firedAt: firing.at,
    triggeredBy: firing.triggeredBy,
    evidence: {
      contributing,
      dispersion: stats.value,
      violationCount: input.violationCount ?? contributing.length,
      complianceCount: input.complianceCount,
      accumulated: firing.value,
      budget: firing.budget,
      knobs: input.knobs,
    },
  };

  return ok({
    proposal,
    event: event.value,
    snapshot,
    policy,
    policyStatus: samePolicy(policy, PROVISIONAL_DISPERSION_POLICY) ? 'provisional' : 'caller-supplied',
    evidenceNotes: input.evidenceNotes ?? [],
  });
}

// ---------------------------------------------------------------------------
// Rendering — forge-agnostic; delivery belongs to src/adapters/github (INV-005)
// ---------------------------------------------------------------------------

const KIND_TITLE: Record<ProposalKind, string> = {
  refactor: 'Refactoring recommendation',
  reprogram: 'Reprogramming proposal',
};

export function proposalTitle(a: AssembledFiring): string {
  return `[GWTP] ${KIND_TITLE[a.proposal.kind]}: ${a.proposal.key}`;
}

function num(n: number, digits = 3): string {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}

function days(ms: number): string {
  return `${(ms / MILLIS_PER_DAY).toFixed(1)}d`;
}

function met(actual: number, threshold: number): string {
  return actual >= threshold ? 'yes' : 'no';
}

const MAX_RENDERED_EVENTS = 25;

/**
 * The evidence bundle spec 02 §5 requires — "contributing events, dispersion stats, compliance
 * ratio, decay-weighted total" — plus the knobs, so any reader can replay the firing.
 *
 * DECLASSIFIER by composition: it unwraps `Surprise` into printable numbers. It takes the
 * warrant from its caller for the same reason everything else does.
 *
 * The provisionality banner is not decoration. A `reprogram` proposal is an argument that the
 * repository's constitution is wrong, and it was classified by four numbers that no human has
 * ratified. Printing them as if they were law is how a provisional constant becomes a permanent
 * one without anyone deciding.
 */
export function renderProposal(a: AssembledFiring, warrant: SentencingWarrant): string {
  const { proposal, policy } = a;
  const d = proposal.evidence.dispersion;
  const out: string[] = [];

  out.push(`## ${KIND_TITLE[proposal.kind]} — \`${proposal.key}\``);
  out.push('');
  out.push(
    proposal.kind === 'reprogram'
      ? '**The evidence says the law is wrong.** Sustained pressure from many independent hands ' +
          'across many seams. Proposed remedy: a PR against `.program/`. If it opens, the ' +
          'assertion goes `contested` and enforcement mutes (spec 01 §4.2).'
      : '**The evidence says the code is wrong.** Concentrated evidence — few hands, few seams, ' +
          'or a tight window. The assertion stands; the proposed remedy is a refactor.',
  );
  out.push('');

  if (a.policyStatus === 'provisional') {
    out.push(
      '> ⚠️ **Classified by PROVISIONAL thresholds, not by ratified law.** `docs/spec/02-ledger.md`',
      '> §5 states the refactor-vs-reprogram rule qualitatively — "low author/path entropy, tight',
      '> window" versus "high entropy, sustained over months" — and gives **no numbers**. The four',
      '> thresholds below are `PROVISIONAL_DISPERSION_POLICY` in `src/core/proposal.ts`: an',
      '> engineering default so the engine runs, *not* something a human has ratified. They decide',
      '> when this framework proposes amending its own constitution, which is governance rather',
      '> than implementation detail. See `docs/spec/OPEN-QUESTIONS.md` Q-22 and',
      '> `proposals/PROPOSED-program-amendment.md` Amendment 3. **Argue with the numbers before',
      '> you argue with the conclusion.**',
    );
  } else {
    out.push(
      '> ℹ️ Classified by a caller-supplied dispersion policy (not `PROVISIONAL_DISPERSION_POLICY`).',
      '> The thresholds actually used are printed below. spec 02 §5 states no numbers of its own;',
      '> see `docs/spec/OPEN-QUESTIONS.md` Q-22.',
    );
  }
  out.push('');

  out.push('### Dispersion (spec 02 §5)');
  out.push('');
  out.push('| Statistic | Measured | Threshold for `reprogram` | Met |');
  out.push('|---|---:|---:|:--:|');
  out.push(
    `| author entropy (normalized) — *how many independent hands* | ${num(d.authorEntropy.normalized)} | ` +
      `${num(policy.authorEntropyMin)} | ${met(d.authorEntropy.normalized, policy.authorEntropyMin)} |`,
  );
  out.push(
    `| distinct authors | ${d.authorEntropy.distinct} | ${policy.minDistinctAuthors} | ` +
      `${met(d.authorEntropy.distinct, policy.minDistinctAuthors)} |`,
  );
  out.push(
    `| path entropy (normalized) — *one seam or many call sites* | ${num(d.pathEntropy.normalized)} | ` +
      `${num(policy.pathEntropyMin)} | ${met(d.pathEntropy.normalized, policy.pathEntropyMin)} |`,
  );
  out.push(
    `| time spread — *a tight burst or sustained pressure* | ${days(d.timeSpread.spanMs)} | ` +
      `${days(policy.timeSpreadMinMs)} | ${met(d.timeSpread.spanMs, policy.timeSpreadMinMs)} |`,
  );
  out.push('');
  out.push(
    `Classification is a **conjunction**: \`reprogram\` requires all four, anything short is ` +
      `\`refactor\`. Weighted spread (std-dev) ${days(d.timeSpread.weightedStdDevMs)}; window ` +
      `\`${d.timeSpread.firstAt}\` → \`${d.timeSpread.lastAt}\`. Entropies are in bits (log2) over ` +
      `**${d.weighting}**-weighted evidence (Q-18); author identities are never published, only ` +
      `their entropy.`,
  );
  out.push('');

  out.push('### The meter');
  out.push('');
  out.push(`- decay-weighted accumulated surprise at firing: **${num(revealSurprise(proposal.evidence.accumulated, warrant))}**`);
  out.push(`- budget: **${num(proposal.evidence.budget as number)}** — \`A >= budget\` (spec 02 §4)`);
  out.push(`- violations: **${proposal.evidence.violationCount}**, compliances: **${proposal.evidence.complianceCount}**`);
  out.push(
    `- compliance ratio: **${d.complianceRatio === null ? 'n/a' : num(d.complianceRatio)}** ` +
      '(compliances / (compliances + violations); Q-19). Compliances are counted and subtract ' +
      'nothing — decay is the only forgiveness (spec 02 §4).',
  );
  out.push(
    `- knobs: half_life \`${proposal.evidence.knobs.halfLife.source}\`, budget ` +
      `\`${proposal.evidence.knobs.budget as number}\`, re-arm fraction ` +
      `\`${proposal.evidence.knobs.rearmFraction}\`, precision override ` +
      `\`${proposal.evidence.knobs.precisionOverride === null ? 'none' : String(proposal.evidence.knobs.precisionOverride as number)}\``,
  );
  out.push('');

  if (a.evidenceNotes.length > 0) {
    out.push('### Caveats on the evidence');
    out.push('');
    for (const n of a.evidenceNotes) out.push(`- ${n}`);
    out.push('');
  }

  out.push('### Contributing events');
  out.push('');
  out.push('| event | committer time | verdict | raw weight | residual at firing |');
  out.push('|---|---|---|---:|---:|');
  const shown = proposal.evidence.contributing.slice(0, MAX_RENDERED_EVENTS);
  for (const c of shown) {
    out.push(
      `| \`${c.event}\` | ${c.t} | ${c.verdict} | ${num(c.rawWeight)} | ` +
        `${num(revealSurprise(c.residualWeight, warrant))} |`,
    );
  }
  if (proposal.evidence.contributing.length > shown.length) {
    out.push(`| … | … | … | … | *${proposal.evidence.contributing.length - shown.length} more* |`);
  }
  out.push('');
  out.push(`Triggered by \`${proposal.triggeredBy}\` at \`${proposal.firedAt}\` (committer time, ADR-0004).`);
  out.push(`Recorded as ledger event \`${a.event.event}\`.`);
  out.push('');
  out.push(
    '<sub>Hysteresis, not reset: this accumulator re-arms only once it has decayed below ' +
      `${num(proposal.evidence.knobs.rearmFraction * 100, 0)}% of budget (spec 02 §6, Q-14). ` +
      'No author identity appears in this document — spec 02 §5 publishes the entropy of the ' +
      'hands, never the hands (ADR-0003).</sub>',
  );

  return out.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Post-fire lifecycle (spec 02 §6). PURE. Returns artifacts; writes nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * A change to `.program/` that a HUMAN applies. `diff` is a copy-pasteable unified diff against
 * the file as supplied; `result` is what the file becomes, for a reviewer who would rather read
 * the destination than the patch. `diff === null` means there is nothing to change and `note`
 * says why — a no-op amendment is reported, never silently skipped.
 */
export interface ProposedAmendment {
  readonly path: string;
  readonly title: string;
  readonly rationale: string;
  readonly diff: string | null;
  readonly result: string | null;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Rejected: an affirmed precedent, and precision rises
// ---------------------------------------------------------------------------

/**
 * spec 02 §6: "Proposal rejected → new precedent (`ruling: affirmed`), and the assertion's
 * `precision` *rises* — a law ratified under fire is a stronger prior." It gives no function.
 *
 * SHIPPED RULE — **halve the distance to the ceiling**: `p' = p + (1 - p) / 2`.
 * See docs/spec/OPEN-QUESTIONS.md Q-47.
 *
 * Why this one, out of the obvious candidates:
 *   - `schemas/assertion.schema.json` bounds precision to `(0, 1]`, so any rule that ADDS a
 *     constant (`p + 0.1`) or MULTIPLIES (`p * 1.2`) walks off the top and has to be clamped,
 *     at which point repeated affirmations stop being distinguishable — the knob saturates and
 *     the law's strength stops recording its own history (Q-26).
 *   - Halving the remaining doubt is the Bayesian reading of the sentence: each affirmation
 *     under fire halves the probability that the assertion is wrong. It is monotonic, it is
 *     strictly increasing, it never exceeds 1, and it never quite reaches it — so an assertion
 *     affirmed ten times still has somewhere to go.
 *   - It is one line and hand-checkable: 0.7 → 0.85 → 0.925 → 0.9625.
 *
 * Rounded to six decimals so `.program/` stays human-readable; the rounding cannot break
 * monotonicity below the ceiling because the step is at least 5e-7 for any `p <= 1 - 1e-6`.
 */
export const PRECISION_RAISE_RULE = 'halve the distance to 1.0: p + (1 - p) / 2';

export function raisePrecision(current: Precision): Parsed<Precision> {
  const p = current as number;
  if (!(p < 1)) {
    return fail(
      'invalid-precision',
      `precision is already at the schema ceiling 1.0, so it cannot rise (spec 02 §6 vs ` +
        `schemas/assertion.schema.json maximum: 1 — see docs/spec/OPEN-QUESTIONS.md Q-26)`,
    );
  }
  const raised = Math.round((p + (1 - p) / 2) * 1e6) / 1e6;
  return parsePrecision(Math.min(1, raised));
}

export interface RejectionInput {
  readonly proposal: Proposal;
  /** The assertion that was upheld. Its `id` must match the accumulator key. */
  readonly assertion: Assertion;
  /** Current text of `.program/invariants.yaml`, read by the caller. */
  readonly invariantsYaml: string;
  /** Current text of `.program/precedents.yaml`, read by the caller. */
  readonly precedentsYaml: string;
  /** Every `PRE-*` id already in use, so the new one does not collide. */
  readonly existingPrecedentIds: readonly PrecedentId[];
  /** "The pattern that was litigated" (schemas/precedent.schema.json). */
  readonly pattern: string;
  /** Why the proposal was rejected. Becomes the precedent's rationale. */
  readonly rationale: string;
  /** Reverts, issues, PR threads. Doubles as bar-exam corpus (spec 01 §5). */
  readonly evidence: NonEmptyReadonlyArray<ProvenanceRef>;
}

export interface RejectionArtifacts {
  readonly precedent: Precedent;
  /** `.program/precedents.yaml` first, then `.program/invariants.yaml`. */
  readonly amendments: readonly ProposedAmendment[];
  readonly raisedPrecision: Precision | null;
}

const PRECEDENTS_PATH = '.program/precedents.yaml';
const INVARIANTS_PATH = '.program/invariants.yaml';

export function onProposalRejected(input: RejectionInput): Decoded<RejectionArtifacts> {
  const errors: ContractError[] = [];
  const key = input.proposal.key;

  if (input.assertion.id !== key) {
    errors.push({
      code: 'invalid-id',
      message: `assertion ${input.assertion.id} does not match the accumulator key ${key}`,
      at: '/assertion/id',
    });
  }
  const nextId = nextPrecedentId(input.existingPrecedentIds);
  if (!nextId.ok) errors.push(nextId.error);
  if (input.pattern.trim().length === 0) {
    errors.push({ code: 'missing-field', message: 'a precedent needs a pattern', at: '/pattern' });
  }
  if (errors.length > 0 || !nextId.ok) return err(errors);

  const precedent: Precedent = {
    id: nextId.value,
    pattern: input.pattern,
    ruling: 'affirmed',
    rationale: input.rationale,
    evidence: input.evidence,
  };

  const precedentsAfter = appendPrecedentYaml(input.precedentsYaml, precedent);
  if (!precedentsAfter.ok) return err([precedentsAfter.error]);

  const precedentAmendment: ProposedAmendment = {
    path: PRECEDENTS_PATH,
    title: `Record ${precedent.id} — assertion ${key} affirmed under contest`,
    rationale:
      `spec 02 §6: a rejected proposal produces a precedent with \`ruling: affirmed\`. The ` +
      `dispersion evidence was heard and the law was upheld, so the dispute is now settled case ` +
      `law: it joins the regression judge's corpus and the judges' bar exam (spec 01 §5, ` +
      `spec 03 §6). INV-001 forbids a machine writing this file, so it arrives as a diff.`,
    diff: unifiedDiff(PRECEDENTS_PATH, input.precedentsYaml, precedentsAfter.value),
    result: precedentsAfter.value,
  };

  // Precision rises only for a real assertion. An obsolescence accumulator is keyed by a scope
  // CLAIM (spec 02 §7, Q-04), and a scope claim has no `precision` field to raise.
  if (!isAssertionKey(key)) {
    return ok({
      precedent,
      amendments: [
        precedentAmendment,
        {
          path: INVARIANTS_PATH,
          title: `No precision raise for ${key}`,
          rationale: PRECISION_RAISE_RULE,
          diff: null,
          result: null,
          note:
            `${key} is a scope claim, not an assertion id (Q-04). \`scope.yaml\` claims carry a ` +
            'path and a `since`, and no precision knob to raise.',
        },
      ],
      raisedPrecision: null,
    });
  }

  const raised = raisePrecision(input.assertion.precision);
  if (!raised.ok) {
    return ok({
      precedent,
      amendments: [
        precedentAmendment,
        {
          path: INVARIANTS_PATH,
          title: `No precision raise for ${key}`,
          rationale: PRECISION_RAISE_RULE,
          diff: null,
          result: null,
          note: raised.error.message,
        },
      ],
      raisedPrecision: null,
    });
  }

  const invariantsAfter = replaceAssertionField(
    input.invariantsYaml,
    key,
    'precision',
    formatPrecision(raised.value),
  );
  if (!invariantsAfter.ok) return err([invariantsAfter.error]);

  return ok({
    precedent,
    amendments: [
      precedentAmendment,
      {
        path: INVARIANTS_PATH,
        title: `Raise ${key} precision ${input.assertion.precision as number} → ${raised.value as number}`,
        rationale:
          `spec 02 §6: "the assertion's \`precision\` *rises* — a law ratified under fire is a ` +
          `stronger prior". The spec gives no function; this engine ships **${PRECISION_RAISE_RULE}** ` +
          `(docs/spec/OPEN-QUESTIONS.md Q-47), which is monotonic, stays inside the schema's ` +
          `\`(0, 1]\` bound without clamping, and never saturates. Precision is the surprise weight ` +
          `per violation, so raising it means the next breach of ${key} costs more.`,
        diff: unifiedDiff(INVARIANTS_PATH, input.invariantsYaml, invariantsAfter.value),
        result: invariantsAfter.value,
      },
    ],
    raisedPrecision: raised.value,
  });
}

/** Trims the trailing zeros a fixed-point rendering would leave: `0.95`, not `0.950000`. */
function formatPrecision(p: Precision): string {
  const s = String(p as number);
  // `1` must round-trip as `1.0` so the file keeps reading like the rest of `.program/`.
  return s.includes('.') ? s : `${s}.0`;
}

// ---------------------------------------------------------------------------
// Accepted: the assertion is amended, and the accumulator zeroes
// ---------------------------------------------------------------------------

export interface AcceptanceInput {
  readonly proposal: Proposal;
  readonly assertion: Assertion;
  readonly invariantsYaml: string;
  /** What the amendment PR argued. Goes in the amendment rationale, not in `.program/`. */
  readonly rationale: string;
}

export interface AcceptanceArtifacts {
  readonly amendments: readonly ProposedAmendment[];
  readonly nextStatus: 'amended';
}

/**
 * spec 02 §6: "Proposal accepted → amendment PR lands in `.program/`, assertion → `amended`,
 * accumulator zeroes."
 *
 * Only the STATUS transition is emitted here. The substance of the amendment — the new
 * statement, the new scope, the retirement — is the argument the humans just had, and a machine
 * that guessed at it would be legislating. `amended` is a terminal state (spec 01 §4.2), so a
 * successor assertion with a new id is the reviewer's next act, not this function's.
 */
export function onProposalAccepted(input: AcceptanceInput): Decoded<AcceptanceArtifacts> {
  const key = input.proposal.key;
  if (input.assertion.id !== key) {
    return err([
      {
        code: 'invalid-id',
        message: `assertion ${input.assertion.id} does not match the accumulator key ${key}`,
        at: '/assertion/id',
      },
    ]);
  }
  if (!isAssertionKey(key)) {
    return err([
      {
        code: 'invalid-id',
        message: `${key} is a scope claim, not an assertion: it has no status to amend (Q-04)`,
        at: '/proposal/key',
      },
    ]);
  }

  const after = replaceAssertionField(input.invariantsYaml, key, 'status', 'amended');
  if (!after.ok) return err([after.error]);

  return ok({
    nextStatus: 'amended',
    amendments: [
      {
        path: INVARIANTS_PATH,
        title: `${key}: status ${input.assertion.status} → amended`,
        rationale:
          `spec 02 §6: an accepted reprogramming proposal lands as an amendment and the assertion ` +
          `goes \`amended\`. \`amended\` is terminal (spec 01 §4.2): enforcement stops, the history ` +
          `stays in git, and a successor assertion — with its own id, statement and provenance — is ` +
          `the reviewer's call, not the engine's. Accepted argument: ${input.rationale}`,
        diff: unifiedDiff(INVARIANTS_PATH, input.invariantsYaml, after.value),
        result: after.value,
      },
    ],
  });
}

/**
 * "Accumulator zeroes" (spec 02 §6), as a fold-side function because the machine may not write
 * `.program/` but it certainly may rewrite its own derived cache (spec 02 §1.2: accumulators are
 * "recomputable at will, cacheable, never authoritative").
 *
 * WHAT ZEROES, AND WHAT DOES NOT — see docs/spec/OPEN-QUESTIONS.md Q-54. The METER zeroes: `A`
 * and every contributing event's residual share, and the unit re-arms (there is nothing left to
 * decay below 50% of, so waiting for hysteresis would leave the assertion permanently disarmed).
 * The CENSUS does not: violation, compliance and abstention counts are the historical record
 * that the next proposal ships as evidence quality, and erasing them would restate the
 * compliance ratio as if the repository had no past. `knobs` is preserved so the cache still
 * describes the fold that produced it.
 */
export function zeroAccumulator(state: AccumulatorState): AccumulatorState {
  const empty = emptyAccumulator(state.key, state.knobs);
  return {
    ...empty,
    asOf: state.asOf,
    lastEventAt: state.lastEventAt,
    violationCount: state.violationCount,
    complianceCount: state.complianceCount,
    abstentionCount: state.abstentionCount,
  };
}

// ---------------------------------------------------------------------------
// Ignored: governance debt
// ---------------------------------------------------------------------------

/**
 * Which way a proposal was pointed — or `unrecorded`, because the LEDGER cannot say.
 *
 * A firing event carries a `dispersion_snapshot` (spec 02 §2) and no proposal kind, and the
 * snapshot is four numbers that `classifyFiring` cannot be run against: it needs the DISTINCT
 * author count, which the snapshot does not keep. So a reader reconstructing the backlog from
 * `refs/program/ledger` alone knows a proposal was filed and does not know whether it argued with
 * the code or with the law. Saying so is cheaper than either re-deriving authorship (ADR-0003
 * permits that only at firing time) or defaulting to `refactor`, which would silently understate
 * the constitutional half of the debt. See docs/spec/OPEN-QUESTIONS.md Q-57.
 */
export type ProposalDirection = ProposalKind | 'unrecorded';

/** One proposal that fired and has had no answer. The caller decides what "answered" means. */
export interface IgnoredProposal {
  readonly key: AccumulatorKey;
  readonly kind: ProposalDirection;
  readonly firedAt: CommitterTime;
  readonly triggeredBy: EventId;
}

/**
 * GLOSSARY: "**Governance debt** — accumulated staleness of ignored proposals."
 *
 * WHAT THIS MEASURES, precisely, so nobody mistakes it for a second surprise meter
 * (docs/spec/OPEN-QUESTIONS.md Q-55):
 *
 *   `proposalDays` = Σ over open proposals of (asOf − firedAt) in days.
 *
 * A single unit: **proposal-days**. Ten proposals ignored for a day and one ignored for ten
 * days both read 10. That coarseness is deliberate — the meter's job is to make silence
 * visible, not to rank it.
 *
 * Three properties it deliberately does NOT share with the accumulator:
 *   - **It does not decay.** Surprise is forgiven by time (spec 02 §4); an unanswered proposal
 *     is not. Ignoring governance for six months is the debt, not its repayment.
 *   - **It is not weighted by severity, budget or kind.** Weighting a `reprogram` above a
 *     `refactor` would be a judgement about how much a constitutional question is worth, which
 *     is exactly the sort of number spec 02 declines to state. `byKind` reports the split
 *     instead, and lets a human weigh it.
 *   - **It has no budget and fires nothing.** It is a meter to look at. spec 02 §6 says
 *     staleness "accumulates on its own meter" and stops there; giving it a threshold would be
 *     inventing a second firing rule.
 *
 * Time never runs backwards: a proposal dated after `asOf` contributes 0 rather than a negative
 * debt, the same clamp `decayFactor` applies for the same reason (Q-11).
 */
export interface GovernanceDebt {
  readonly asOf: CommitterTime;
  readonly openCount: number;
  /** Σ days unanswered. The meter. */
  readonly proposalDays: number;
  readonly oldestFiredAt: CommitterTime | null;
  readonly oldestAgeDays: number;
  /** The same proposal-days, split by direction. Reported, never weighted. */
  readonly byKind: Readonly<Record<ProposalDirection, number>>;
}

export function governanceDebt(
  open: readonly IgnoredProposal[],
  asOf: CommitterTime,
): GovernanceDebt {
  const now = committerTimeMillis(asOf);
  let proposalDays = 0;
  let oldestFiredAt: CommitterTime | null = null;
  let oldestAgeDays = 0;
  const byKind: Record<ProposalDirection, number> = { refactor: 0, reprogram: 0, unrecorded: 0 };

  for (const p of open) {
    const age = Math.max(0, now - committerTimeMillis(p.firedAt)) / MILLIS_PER_DAY;
    proposalDays += age;
    byKind[p.kind] += age;
    if (age > oldestAgeDays || oldestFiredAt === null) {
      oldestAgeDays = age;
      oldestFiredAt = p.firedAt;
    }
  }

  return {
    asOf,
    openCount: open.length,
    proposalDays,
    oldestFiredAt,
    oldestAgeDays,
    byKind,
  };
}

export function renderGovernanceDebt(debt: GovernanceDebt): string {
  if (debt.openCount === 0) {
    return `Governance debt: 0 proposal-days (no unanswered proposals as of ${debt.asOf}).`;
  }
  const unrecorded =
    debt.byKind.unrecorded > 0 ? `, ${debt.byKind.unrecorded.toFixed(1)} unrecorded (Q-57)` : '';
  return (
    `Governance debt: **${debt.proposalDays.toFixed(1)} proposal-days** across ` +
    `${debt.openCount} unanswered proposal(s) as of ${debt.asOf} — ` +
    `${debt.byKind.refactor.toFixed(1)} refactor, ${debt.byKind.reprogram.toFixed(1)} reprogram` +
    `${unrecorded}. ` +
    `Oldest has waited ${debt.oldestAgeDays.toFixed(1)} days (fired ${debt.oldestFiredAt}). ` +
    'This meter does not decay: unlike surprise, an ignored proposal is not forgiven by time ' +
    '(spec 02 §6, GLOSSARY, docs/spec/OPEN-QUESTIONS.md Q-55).'
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Text mechanics: unified diffs and line-level YAML edits
//
// A hand-rolled diff rather than a dependency, for the same reason src/core has no glob
// library: the engine stays dependency-free, and a governance patch a human is expected to read
// and apply should be produced by something small enough to audit.
//
// These edit LINES, not YAML documents. That is deliberate — a round-trip through a YAML parser
// would reflow comments and quoting across a file whose comments are load-bearing law. The
// price is that the edit must find exactly one matching line and fails loudly when it does not.
//
// THERE IS A SECOND DIFF GENERATOR, in src/adapters/github/amendment.ts (`replacementDiff`), and
// the two are NOT redundant — they answer different questions and neither can be expressed as the
// other without losing what makes it safe:
//   `unifiedDiff` (here)        arbitrary before/after text, insertions and deletions included,
//                               ONE hunk, `string | null` so a no-op amendment is representable.
//                               Used for `.program/precedents.yaml`, where an append adds lines.
//   `replacementDiff` (adapter) equal line counts only — it REFUSES to express an insertion, so a
//                               bug in the amendment builder cannot grow the constitution by a
//                               line nobody proposed. Multi-hunk, `Parsed<string>`.
// A third one appearing is the thing to notice. If they are ever merged, the merged version has
// to keep `replacementDiff`'s refusal, which is a feature and not a limitation. INV-005 also
// forbids the dependency in one direction: src/ledger may not import src/adapters.
// ═══════════════════════════════════════════════════════════════════════════════════════════

interface SplitText {
  readonly lines: readonly string[];
  readonly trailingNewline: boolean;
}

function splitLines(text: string): SplitText {
  return text.endsWith('\n')
    ? { lines: text.slice(0, -1).split('\n'), trailingNewline: true }
    : { lines: text.split('\n'), trailingNewline: false };
}

const NO_NEWLINE = '\\ No newline at end of file';

/**
 * A single-hunk unified diff. Exact for one contiguous changed region — a replaced line, an
 * inserted block — which is every edit this module makes. It is NOT a general differ: two
 * separated changes come back as one hunk spanning both, which still APPLIES correctly (the
 * unchanged middle rides along as removed-and-re-added lines) but reads worse than `git diff`.
 *
 * Returns `null` when there is nothing to change, so a no-op amendment is representable.
 */
export function unifiedDiff(
  path: string,
  before: string,
  after: string,
  context = 3,
): string | null {
  if (before === after) return null;
  const b = splitLines(before);
  const a = splitLines(after);

  let prefix = 0;
  while (
    prefix < b.lines.length &&
    prefix < a.lines.length &&
    b.lines[prefix] === a.lines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < b.lines.length - prefix &&
    suffix < a.lines.length - prefix &&
    b.lines[b.lines.length - 1 - suffix] === a.lines[a.lines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  // A pure trailing-newline change leaves no differing line; treat the last line as changed.
  if (prefix === b.lines.length && prefix === a.lines.length) prefix -= 1;

  const bEnd = b.lines.length - suffix;
  const aEnd = a.lines.length - suffix;
  const leadStart = Math.max(0, prefix - context);
  const trailCount = Math.min(context, suffix);

  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  const oldCount = bEnd - leadStart + trailCount;
  const newCount = aEnd - leadStart + trailCount;
  out.push(`@@ -${leadStart + 1},${oldCount} +${leadStart + 1},${newCount} @@`);

  const emit = (marker: string, line: string, isLast: boolean, trailing: boolean): void => {
    out.push(marker + line);
    if (isLast && !trailing) out.push(NO_NEWLINE);
  };

  for (let i = leadStart; i < prefix; i += 1) {
    emit(' ', b.lines[i] as string, false, true);
  }
  for (let i = prefix; i < bEnd; i += 1) {
    emit('-', b.lines[i] as string, i === b.lines.length - 1, b.trailingNewline);
  }
  for (let i = prefix; i < aEnd; i += 1) {
    emit('+', a.lines[i] as string, i === a.lines.length - 1, a.trailingNewline);
  }
  for (let k = 0; k < trailCount; k += 1) {
    const i = bEnd + k;
    emit(' ', b.lines[i] as string, i === b.lines.length - 1, b.trailingNewline && a.trailingNewline);
  }

  return `${out.join('\n')}\n`;
}

const TOP_LEVEL_ITEM = /^-\s/;
const ITEM_ID = /^-\s+id:\s*([^\s#]+)\s*(?:#.*)?$/;

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces one scalar field inside one `- id: <assertion-id>` block of a `.program/` sequence
 * file, preserving indentation and any trailing comment. Fails — rather than guessing — when
 * the id appears twice, when it appears not at all, or when the field is ambiguous inside the
 * block. A governance edit that silently patched the wrong assertion would be worse than one
 * that refused.
 */
export function replaceAssertionField(
  yaml: string,
  id: AccumulatorKey,
  field: string,
  value: string,
): Parsed<string> {
  const lines = yaml.split('\n');

  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = ITEM_ID.exec(lines[i] as string);
    if (m === null || m[1] !== id) continue;
    if (start !== -1) {
      return fail('strictness', `\`${id}\` appears more than once in the document`, `/${id}`);
    }
    start = i;
  }
  if (start === -1) {
    return fail('missing-field', `no entry with \`id: ${id}\` in the document`, `/${id}`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (TOP_LEVEL_ITEM.test(lines[i] as string)) {
      end = i;
      break;
    }
  }

  const fieldRe = new RegExp(`^(\\s*)${escapeForRegExp(field)}:\\s*([^#\\n]*?)(\\s*)(#.*)?$`);
  let hit = -1;
  for (let i = start; i < end; i += 1) {
    if (!fieldRe.test(lines[i] as string)) continue;
    if (hit !== -1) {
      return fail('strictness', `\`${field}\` appears twice inside ${id}`, `/${id}/${field}`);
    }
    hit = i;
  }
  if (hit === -1) {
    return fail('missing-field', `${id} has no \`${field}\` field`, `/${id}/${field}`);
  }

  const m = fieldRe.exec(lines[hit] as string) as RegExpExecArray;
  const indent = m[1] ?? '';
  const gap = m[3] ?? '';
  const comment = m[4] ?? '';
  const next = [...lines];
  next[hit] = `${indent}${field}: ${value}${gap}${comment}`;
  return ok(next.join('\n'));
}

/** JSON strings are valid YAML double-quoted scalars, escapes and all. */
function yamlString(s: string): string {
  return JSON.stringify(s);
}

export function renderPrecedentBlock(p: Precedent): string {
  const lines = [`- id: ${p.id}`, `  pattern: ${yamlString(p.pattern)}`, `  ruling: ${p.ruling}`];
  if (p.rationale !== undefined) lines.push(`  rationale: ${yamlString(p.rationale)}`);
  lines.push('  evidence:');
  for (const e of p.evidence) lines.push(`    - ${yamlString(e)}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Appends a precedent to `.program/precedents.yaml`. The shipped file's body is the empty flow
 * sequence `[]` under a comment header, so the first append must REPLACE that token rather than
 * add an item beside it — `[]` and `- id: …` cannot coexist in one document.
 */
export function appendPrecedentYaml(yaml: string, precedent: Precedent): Parsed<string> {
  const block = renderPrecedentBlock(precedent);
  const lines = yaml.split('\n');

  let emptyAt = -1;
  let hasItems = false;
  for (let i = 0; i < lines.length; i += 1) {
    const t = (lines[i] as string).trim();
    if (t === '' || t.startsWith('#')) continue;
    if (t === '[]') {
      emptyAt = i;
      continue;
    }
    if (TOP_LEVEL_ITEM.test(t) || t === '-') hasItems = true;
  }

  if (emptyAt !== -1 && hasItems) {
    return fail('wrong-type', 'precedents.yaml holds both `[]` and sequence items', '/');
  }
  if (emptyAt !== -1) {
    const next = [...lines];
    next.splice(emptyAt, 1, ...block.replace(/\n$/, '').split('\n'));
    return ok(next.join('\n'));
  }
  if (hasItems) {
    const base = yaml.endsWith('\n') ? yaml : `${yaml}\n`;
    return ok(base + block);
  }
  return fail(
    'wrong-type',
    'precedents.yaml has neither `[]` nor any sequence item; refusing to guess its shape',
    '/',
  );
}

/** `PRE-001`, `PRE-002`, … — the lowest free three-digit id above every existing one. */
export function nextPrecedentId(existing: readonly PrecedentId[]): Parsed<PrecedentId> {
  let max = 0;
  for (const id of existing) {
    const n = Number.parseInt(id.slice('PRE-'.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return parsePrecedentId(`PRE-${String(max + 1).padStart(3, '0')}`);
}

/** Re-exported for callers assembling evidence bundles; keeps `Surprise` opaque at the border. */
export type FiringSurprise = Surprise;
export type FiringDispersion = DispersionStats;
export type FiringBudget = Budget;
