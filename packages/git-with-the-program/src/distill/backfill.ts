// Implements: docs/spec/04-distillation.md §7 (priming the ledger — "replay the CURRENT epoch
// through the judges … deterministic-class backfills fully; judgment-class at merge granularity
// only … backfilled events arrive PRE-DECAYED because decay runs on committer time") and §8 (the
// watermark: "manifest.yaml records the last SHA walked … advance the manifest watermark"), against
// docs/spec/02-ledger.md §7 (triggers tiered by judge cost) and docs/adr/0004-committer-time-decay.md.
// SEED-04 deliverable 6.
//
// BACKFILL IS SAFE BY CONSTRUCTION. Every minted event carries COMMITTER time (ADR-0004), so the
// leaky integrator ages each observation to its real place in history the instant it lands: an
// eight-month-old breach against a 90-day half-life projects forward to ~15% strength
// (2^(-8·30/90) ≈ 0.157). History is absorbed without firing on stale news, and if drift is
// CURRENTLY underway the accumulators start warm instead of blind. `measureBackfillStrength`
// exposes both the fresh (pre-decayed) increment and the projected value so a test checks the
// arithmetic by hand.
//
// COST CONTROL (spec 04 §7, constraint 5). Deterministic-class assertions replay on EVERY commit;
// judgment-class only at MERGE granularity, and each judged merge is one model call priced against
// a hard, CONFIGURABLE cap. Exceeding the cap STOPS AND REPORTS (`Err(BackfillCostExceeded)`) rather
// than silently spending — the same stop-and-report discipline the whole framework uses for a
// runaway process.
//
// INV-001. The watermark advance is a PROPOSED manifest change — a unified diff against
// `.program/manifest.yaml` (`proposeWatermarkAdvance`), never a write. The machine proposes; the
// human ratifies (spec 04 §6). This module has no `.program/` write path.
//
// INV-005 / constraint 3. This module names no provider SDK. A judgment-class judge is a plain
// `Judge` (SealedEvidence -> Verdict); when it is model-backed, the model is reached through the
// core-side `ModelClient` port inside that judge's closure, and `@anthropic-ai/sdk` stays under
// src/adapters/anthropic. INV-003: judges receive only `SealedEvidence`, which `sealEvidence`
// already strips of author identity — no author name reaches any model on a verdict path.

import type {
  AccumulatorKey,
  Assertion,
  CommitSha,
  CommitterTime,
  ContextRing,
  Enforcement,
  EpochId,
  FoldKnobs,
  HalfLife,
  Hunk,
  Judge,
  JudgeRef,
  LedgerEvent,
  Parsed,
  PrecedentView,
  RatifiedAssertion,
  Result,
  Verdict,
} from '../core/index.js';
import {
  assertionView,
  eventBodyFromVerdict,
  err,
  fail,
  hashBlob,
  isNonEmpty,
  isViolation,
  ok,
  parseRationaleRef,
  scopedHunks,
  sealEvent,
  sealEvidence,
  unwrap,
} from '../core/index.js';
import type { AppendOutcome, EventStore, FoldKnobsFor } from '../ledger/index.js';
import {
  foldEventsPerKey,
  foldKnobs,
  projectStateTo,
  unifiedDiff as singleFileUnifiedDiff,
} from '../ledger/index.js';
// src/distill is not a blind directory (scripts/check-inv003.ts BLIND_DIRS = src/judge, src/evidence),
// so it may hold a `SentencingWarrant` to declassify the meter for a hand-checkable report — the same
// deep import demo-v0.ts and src/ledger/firing.ts use, and the single greppable warrant line here.
import { revealSurprise, withSentencingWarrant, type SentencingWarrant } from '../core/sentencing.js';

// ---------------------------------------------------------------------------
// Cost control (spec 04 §7)
// ---------------------------------------------------------------------------

export interface BackfillBudget {
  /**
   * Hard cap on JUDGED MERGES per backfill run — one model call each. Judgment-class assertions
   * replay only at merge commits (spec 02 §7), and a run that would exceed this stops and reports
   * rather than spending. Deterministic-class judgements are free and uncapped.
   */
  readonly maxJudgedMerges: number;
}

/**
 * Conservative default: generous enough that a real mid-size epoch backfills without tripping,
 * tight enough that a pathological history (thousands of merges) stops and asks. Overridable per
 * run.
 */
export const DEFAULT_BACKFILL_BUDGET: BackfillBudget = { maxJudgedMerges: 500 };

/**
 * The typed stop-and-report out of a backfill run. Loud and distinct from a decode error: it names
 * the cap, how many judged merges had been spent, and the commit the run stopped at.
 */
export interface BackfillCostExceeded {
  readonly reason: 'judged-merge-cap-exceeded';
  readonly cap: number;
  readonly judgedSoFar: number;
  readonly stoppedAt: CommitSha;
}

// ---------------------------------------------------------------------------
// Judge tiering (spec 02 §7)
// ---------------------------------------------------------------------------

/**
 * `deterministic` — runs on every commit (spec 02 §7: "every push"). Free.
 * `judgment`      — runs at merge granularity only (spec 02 §7: "PR-merge granularity"). Priced.
 */
export type BackfillTier = 'deterministic' | 'judgment';

/**
 * The default tiering from an assertion's `enforcement`. `deterministic` maps to the free every-
 * commit tier; `judgment` to the priced merge tier; `hybrid` also to the priced merge tier, because
 * a hybrid's escalated half is the model magistrate (Q-39: the deterministic prescreen is the free
 * half). A caller that wants a hybrid's prescreen replayed fully can seat it separately at the
 * `deterministic` tier.
 */
export function backfillTierOf(enforcement: Enforcement): BackfillTier {
  return enforcement === 'deterministic' ? 'deterministic' : 'judgment';
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One commit of the current epoch, author-free (INV-003) and pre-parsed. Assembled by the caller
 * from git (in tests, from a throwaway repo — the same `git show`→`Hunk[]` reader demo-v0.ts uses),
 * so backfill neither re-shells git nor depends on the pass-one history walker.
 */
export interface BackfillCommit {
  readonly sha: CommitSha;
  /** Committer time (ADR-0004). This is what backfilled events carry, so decay applies on arrival. */
  readonly committerTime: CommitterTime;
  readonly isMerge: boolean;
  readonly hunks: readonly Hunk[];
}

/** A seated judge for one ratified assertion, plus the tier that decides when it runs. */
export interface SeatedBackfillJudge {
  /**
   * Only RATIFIED assertions are replayed (spec 01 §4.2: `inferred` is not enforced). The type
   * says so — a `CandidateAssertion` is not assignable here.
   */
  readonly assertion: RatifiedAssertion;
  readonly tier: BackfillTier;
  /** The seat stamped on every event this judge mints. */
  readonly ref: JudgeRef;
  /** `SealedEvidence -> Verdict`. A model-backed judge reaches its `ModelClient` inside this closure. */
  readonly judge: Judge;
  /** Settled case law for the regression judge (spec 03 §7). `null` for everything else. */
  readonly precedent?: PrecedentView | null;
}

export interface BackfillInput {
  /** The current epoch's commits, OLDEST-FIRST (accumulation is order-sensitive; Q-11). */
  readonly commits: readonly BackfillCommit[];
  readonly judges: readonly SeatedBackfillJudge[];
  /** charter excerpt the sealed evidence carries (spec 03 §3). */
  readonly charterExcerpt?: string;
  readonly ring?: ContextRing;
  readonly budget?: BackfillBudget;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface BackfilledVerdict {
  readonly assertion: AccumulatorKey;
  readonly sha: CommitSha;
  readonly committerTime: CommitterTime;
  readonly tier: BackfillTier;
  readonly verdict: Verdict;
  /** Sealed, content-addressed, carrying committer time. Ready for `EventStore.append`. */
  readonly event: LedgerEvent;
}

export interface BackfillResult {
  /** Every minted event, in the order judged. */
  readonly events: readonly LedgerEvent[];
  readonly verdicts: readonly BackfilledVerdict[];
  readonly commitsReplayed: number;
  /** Deterministic-class judgements — free, one per (deterministic seat × commit). */
  readonly deterministicJudgements: number;
  /** Judged merges — priced, one model call each, capped by the budget. */
  readonly judgedMerges: number;
}

// ---------------------------------------------------------------------------
// The replay (spec 04 §7)
// ---------------------------------------------------------------------------

/**
 * Replays the epoch through the seated judges, minting one ledger event per judgement. Pure of I/O:
 * it neither reads git nor writes the ledger — `backfillLedger` does the append. Every event carries
 * the commit's COMMITTER time, so the fold ages it correctly on arrival (spec 04 §7).
 *
 * Deterministic-class seats judge every commit; judgment-class seats judge only merges and are
 * priced against `budget.maxJudgedMerges`. The cap is tested BEFORE the (expensive) judge is called,
 * so exceeding it stops and reports rather than spending the call — `Err(BackfillCostExceeded)`.
 */
export async function replayEpoch(
  input: BackfillInput,
): Promise<Result<BackfillResult, BackfillCostExceeded>> {
  const budget = input.budget ?? DEFAULT_BACKFILL_BUDGET;
  const charterExcerpt = input.charterExcerpt ?? '';
  const ring: ContextRing = input.ring ?? 'hunk';

  const events: LedgerEvent[] = [];
  const verdicts: BackfilledVerdict[] = [];
  let deterministicJudgements = 0;
  let judgedMerges = 0;

  for (const commit of input.commits) {
    for (const seat of input.judges) {
      if (seat.tier === 'judgment') {
        // spec 02 §7: judgment class runs at merge granularity only.
        if (!commit.isMerge) continue;
        // spec 04 §7: stop and report rather than silently spend. Checked before the model call.
        if (judgedMerges >= budget.maxJudgedMerges) {
          return err({
            reason: 'judged-merge-cap-exceeded',
            cap: budget.maxJudgedMerges,
            judgedSoFar: judgedMerges,
            stoppedAt: commit.sha,
          });
        }
      }

      const scoped = scopedHunks(seat.assertion.scope, commit.hunks);
      // sealEvidence is the blindness chokepoint (INV-003): the judge — and any model behind it —
      // sees only this sealed bundle, which carries no author identity. A seal failure is a
      // programming error on a well-formed assertion, so it throws rather than masquerading as a
      // budget failure.
      const sealed = unwrap(
        sealEvidence({
          assertion: assertionView(seat.assertion),
          charterExcerpt,
          hunks: scoped,
          ring,
          precedent: seat.precedent ?? null,
        }),
      );

      const verdict = await seat.judge(sealed);
      const event = mintBackfillEvent(commit, seat, verdict);
      events.push(event);
      verdicts.push({
        assertion: seat.assertion.id,
        sha: commit.sha,
        committerTime: commit.committerTime,
        tier: seat.tier,
        verdict,
        event,
      });

      if (seat.tier === 'judgment') judgedMerges += 1;
      else deterministicJudgements += 1;
    }
  }

  return ok({
    events,
    verdicts,
    commitsReplayed: input.commits.length,
    deterministicJudgements,
    judgedMerges,
  });
}

/**
 * The one sanctioned Verdict -> LedgerEvent transition for backfill. A violation carries frozen
 * precision, a rationale blob ref (pure function of the diff, so the event id is stable) and the
 * commit's committer time; an aligned/abstain verdict carries only the committer time. Mirrors the
 * mint in demo-v0.ts's pipeline.
 */
function mintBackfillEvent(
  commit: BackfillCommit,
  seat: SeatedBackfillJudge,
  verdict: Verdict,
): LedgerEvent {
  const body = isViolation(verdict)
    ? eventBodyFromVerdict({
        subject: { commit: commit.sha },
        judge: seat.ref,
        t: commit.committerTime,
        verdict,
        precision_at: seat.assertion.precision,
        rationale: unwrap(parseRationaleRef(hashBlob(verdict.rationale))),
      })
    : eventBodyFromVerdict({
        subject: { commit: commit.sha },
        judge: seat.ref,
        t: commit.committerTime,
        verdict,
      });
  return unwrap(sealEvent(body));
}

// ---------------------------------------------------------------------------
// Orchestration: replay + append + watermark proposal
// ---------------------------------------------------------------------------

export interface BackfillLedgerInput extends BackfillInput {
  /** The throwaway ledger the events are appended to. Injected, so tests need no real ref. */
  readonly store: EventStore;
  /** Current text of `.program/manifest.yaml`, for the watermark advance PROPOSAL (spec 04 §8). */
  readonly manifestYaml?: string;
  /** Optionally advance `watermark.last_epoch` alongside `last_walked`. */
  readonly lastEpoch?: EpochId;
}

export interface BackfillLedgerResult {
  readonly result: BackfillResult;
  readonly append: AppendOutcome;
  /** The PROPOSED manifest change (never a write). `null` when no manifest text or no commits. */
  readonly watermark: ProposedWatermarkAdvance | null;
}

/**
 * The whole deliverable-6 loop: replay the epoch, append the minted events to the (throwaway)
 * ledger, and produce the watermark advance as a PROPOSAL. Returns `Err(BackfillCostExceeded)`
 * without appending anything if the judged-merge cap is exceeded — nothing is spent and nothing is
 * half-written.
 */
export async function backfillLedger(
  input: BackfillLedgerInput,
): Promise<Result<BackfillLedgerResult, BackfillCostExceeded>> {
  const replay = await replayEpoch(input);
  if (!replay.ok) return replay;

  const events = replay.value.events;
  const append: AppendOutcome = isNonEmpty(events)
    ? await input.store.append(events)
    : { written: [], deduped: [] };

  let watermark: ProposedWatermarkAdvance | null = null;
  const newest = input.commits[input.commits.length - 1];
  if (input.manifestYaml !== undefined && newest !== undefined) {
    const proposed = proposeWatermarkAdvance({
      manifestYaml: input.manifestYaml,
      lastWalked: newest.sha,
      ...(input.lastEpoch !== undefined ? { lastEpoch: input.lastEpoch } : {}),
    });
    if (!proposed.ok) {
      // A watermark that cannot be located is a programming error, not a cost overrun. Rather than
      // widen `BackfillCostExceeded`, surface it by throwing — `backfillLedger` returns a typed Err
      // for the ONE thing that is a normal, expected outcome: the cost cap.
      throw new Error(
        `backfill: could not build the watermark advance proposal: ${proposed.error.message}`,
      );
    }
    watermark = proposed.value;
  }

  return ok({ result: replay.value, append, watermark });
}

// ---------------------------------------------------------------------------
// The watermark advance (spec 04 §8) — PROPOSED, never written
// ---------------------------------------------------------------------------

export const MANIFEST_PATH = '.program/manifest.yaml';

export interface ProposedWatermarkAdvance {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  /** A `-p1`-shaped unified diff a human applies. */
  readonly diff: string;
  readonly lastWalked: CommitSha;
  readonly lastEpoch: EpochId | null;
}

export interface WatermarkAdvanceInput {
  /** Current text of `.program/manifest.yaml`. This function never reads a file. */
  readonly manifestYaml: string;
  /** The last SHA walked (spec 04 §8) — the newest commit of the replayed epoch. */
  readonly lastWalked: CommitSha;
  readonly lastEpoch?: EpochId;
}

/**
 * Advances `watermark.last_walked` (and optionally `watermark.last_epoch`) in
 * `.program/manifest.yaml`, as a PROPOSED unified diff. Pure `string -> string` with no filesystem:
 * there is no code path here through which `.program/` could be written (INV-001, the trick
 * src/adapters/github/amendment.ts plays). Textual — a YAML round-trip would reflow the file's
 * load-bearing comments — so it replaces exactly the scalar values and fails loudly if it cannot
 * find them.
 */
export function proposeWatermarkAdvance(input: WatermarkAdvanceInput): Parsed<ProposedWatermarkAdvance> {
  const before = input.manifestYaml;

  // A commit sha is `[0-9a-f]{4,40}`; an all-digit one would read back as a YAML NUMBER, which the
  // manifest decoder (parseCommitSha expects a string) would reject. Quote it.
  let after = before;
  const walked = setManifestScalar(after, 'last_walked', JSON.stringify(input.lastWalked));
  if (!walked.ok) return walked;
  after = walked.value;

  let lastEpoch: EpochId | null = null;
  if (input.lastEpoch !== undefined) {
    const epoch = setManifestScalar(after, 'last_epoch', input.lastEpoch);
    if (!epoch.ok) return epoch;
    after = epoch.value;
    lastEpoch = input.lastEpoch;
  }

  const diff = singleFileUnifiedDiff(MANIFEST_PATH, before, after);
  if (diff === null) {
    return fail(
      'wrong-type',
      `${MANIFEST_PATH} already records last_walked ${input.lastWalked}; nothing to propose`,
    );
  }

  return ok({ path: MANIFEST_PATH, before, after, diff, lastWalked: input.lastWalked, lastEpoch });
}

const SCALAR_FIELD_TAIL = String.raw`:\s*([^#\n]*?)(\s*)(#.*)?$`;

/**
 * Replaces one top-level scalar field's value in a YAML mapping, preserving indentation and any
 * trailing comment (the discipline src/adapters/github/amendment.ts and src/ledger/firing.ts use).
 * Fails when the field is missing or appears more than once — a governance edit that silently
 * patched the wrong line would be worse than one that refused.
 */
export function setManifestScalar(yaml: string, field: string, value: string): Parsed<string> {
  const re = new RegExp(`^(\\s*)${field}${SCALAR_FIELD_TAIL}`);
  const lines = yaml.split('\n');
  let hit = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!re.test(lines[i] as string)) continue;
    if (hit !== -1) return fail('strictness', `\`${field}\` appears more than once in ${MANIFEST_PATH}`, `/${field}`);
    hit = i;
  }
  if (hit === -1) return fail('missing-field', `no \`${field}\` field in ${MANIFEST_PATH}`, `/${field}`);

  const m = re.exec(lines[hit] as string) as RegExpExecArray;
  const indent = m[1] ?? '';
  const gap = m[3] ?? '';
  const comment = m[4] ?? '';
  const next = [...lines];
  next[hit] = `${indent}${field}: ${value}${gap}${comment}`;
  return ok(next.join('\n'));
}

// ---------------------------------------------------------------------------
// Pre-decayed value exposure (spec 04 §7) — the hand-checkable arithmetic
// ---------------------------------------------------------------------------

export interface BackfillStrength {
  readonly key: AccumulatorKey;
  /**
   * The accumulator value AS OF its last violating event, before projecting forward — the FRESH,
   * undecayed increment for a single backfilled breach (`precision_at · severity`).
   */
  readonly preDecayed: number;
  /** The value projected forward to `asOf`: what a backfilled event is worth on arrival (spec 04 §7). */
  readonly decayed: number;
  /** `decayed / preDecayed` — the surviving fraction, e.g. ≈0.157 for 8 months against 90d. */
  readonly survivingFraction: number;
  readonly asOf: CommitterTime;
  readonly halfLife: HalfLife;
  readonly violationCount: number;
}

/**
 * Folds the (backfilled) events and reports, per accumulator, the fresh increment and the value
 * projected forward to `asOf`. The surviving fraction is `2^(-Δt / half_life)`, so an 8-month-old
 * breach against a 90-day half-life lands at ~15% strength (spec 04 §7). This is the ONE place the
 * meter is declassified — under a warrant this non-blind module may hold — so a test can assert the
 * exact number against a calculator.
 */
export function measureBackfillStrength(
  events: readonly LedgerEvent[],
  knobsFor: FoldKnobsFor,
  asOf: CommitterTime,
): Parsed<readonly BackfillStrength[]> {
  const fold = foldEventsPerKey(events, knobsFor);
  if (!fold.ok) return fold;

  return withSentencingWarrant((warrant: SentencingWarrant): Parsed<readonly BackfillStrength[]> => {
    const out: BackfillStrength[] = [];
    for (const key of fold.value.keys) {
      const state = fold.value.states.get(key);
      const knobs = fold.value.knobs.get(key);
      if (state === undefined || knobs === undefined) continue;
      const preDecayed = revealSurprise(state.value, warrant);
      const decayed = revealSurprise(projectStateTo(state, asOf, knobs).value, warrant);
      out.push({
        key,
        preDecayed,
        decayed,
        survivingFraction: preDecayed > 0 ? decayed / preDecayed : 1,
        asOf,
        halfLife: knobs.halfLife,
        violationCount: state.violationCount,
      });
    }
    return ok(out);
  });
}

/**
 * A `FoldKnobsFor` resolver keyed on a set of assertions — every assertion carries its own budget
 * and half-life, so folding a whole ledger under one set of knobs would measure each against
 * somebody else's threshold. `null` for a key with no matching assertion (Q-56).
 */
export function knobsForAssertions(assertions: readonly Assertion[]): FoldKnobsFor {
  const byId = new Map<string, Assertion>(assertions.map((a) => [a.id, a]));
  return (key: AccumulatorKey): FoldKnobs | null => {
    const a = byId.get(key);
    return a === undefined ? null : foldKnobs(a);
  };
}
