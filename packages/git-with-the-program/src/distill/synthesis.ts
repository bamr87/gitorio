// Implements: docs/spec/04-distillation.md §3 (pass two — map-reduce synthesis over epochs),
// §4 ("distillation may only emit `inferred`"), §5 (evidence-seeded precision, via
// ./precision.js) and §6 (tombstones are binding). Also spec 01 §4 rule 1 ("no assertion
// without provenance"). SEED-04 deliverable 3.
//
// TWO INVARIANTS HELD STRUCTURALLY, NOT BY CONVENTION:
//
//  - INV-005 / provider-agnostic. Synthesis reaches a model ONLY through the core `ModelClient`
//    port (src/core/model.ts). Nothing here names `@anthropic-ai/sdk`; the port carries a
//    `system` string and a `user` string and nothing else, so this file cannot depend on a
//    provider. Every test injects a fake `ModelClient`; no network is reachable.
//
//  - INV-003 / blindness. `EpochSynthesisInput` has NO author-bearing field — doc snapshots,
//    churn diffs and fact aggregates are the author-free (SYNTHESIZABLE) side of the fact base.
//    The author-file matrix is a DISPERSION artifact and is deliberately absent from this
//    module's inputs, so no raw author identity can reach `buildEpochPrompt` — there is no slot
//    for one (spec 04 §2 mines the matrix; pass-two prompts must not carry it).
//
// The return type is `CandidateAssertion` (src/core/assertion.ts), pinned to `status: 'inferred'`
// by construction: this miner cannot self-ratify even by mistake (spec 04 §4).
//
// RECONCILED (SEED-04 integration). The `*View` interfaces below are the AUTHOR-FREE projection of
// the pass-one record types in src/distill/factbase.ts (DocSnapshot, NegativeSpaceProof,
// ManifestEvent, CoChangeEdge). They are deliberately kept as a narrow input contract — nothing
// author-bearing can be spelled here, which is INV-003 restated structurally at pass two — and the
// integration layer (src/distill/wire.ts) maps the real FactBase records onto them (e.g. a
// NegativeSpaceProof's `probe.scope` maps to `NegativeSpaceProofView.scope`). `RegularityKey` is now
// imported from ./factbase.js — one definition, shared with pass one and ratification.

import type { NonEmptyReadonlyArray } from '../core/brand.js';
import { isNonEmpty } from '../core/brand.js';
import type {
  AssertionClass,
  Budget,
  CandidateAssertion,
  DistillationEvidence,
  Enforcement,
  Precision,
} from '../core/assertion.js';
import {
  ASSERTION_CLASSES,
  ENFORCEMENTS,
  parseBudget,
  parsePrecision,
} from '../core/assertion.js';
import type {
  CandidateId,
  CommitSha,
  EpochId,
  ProvenanceRef,
} from '../core/ids.js';
import { epochOrdinal, parseCandidateId } from '../core/ids.js';
import {
  findRegularityMarker,
  normalizeStatement,
  statementRegularityKey,
  type RegularityKey,
} from './factbase.js';

// Re-exported so callers that key a regularity from a statement have one import site; the
// derivation itself is defined once in ./factbase.js and shared with ratify.ts (spec 04 §6).
export { statementRegularityKey };
import type { ModelClient, ModelRequest } from '../core/model.js';
import type { PathGlob } from '../core/paths.js';
import { parsePathGlob } from '../core/paths.js';
import type { Precedent } from '../core/precedent.js';
import { isTombstone } from '../core/precedent.js';
import type { Result } from '../core/result.js';
import { err, ok } from '../core/result.js';
import type { CommitterTime, HalfLife } from '../core/time.js';
import { parseDuration } from '../core/time.js';
import type { PrecisionEvidence } from './precision.js';
import { seedPrecision, spanDaysBetween } from './precision.js';

// ---------------------------------------------------------------------------
// Tombstone corpus (spec 04 §6 — a human's rejection may not be resurrected)
// ---------------------------------------------------------------------------
//
// `normalizeStatement`, `statementRegularityKey` and the `gwtp-regularity:` marker are defined once
// in ./factbase.js and shared with ratify.ts, so pass two and ratification bind a tombstone the
// SAME way — a rejection recorded by either layer keys identically here.

/** A read-only set of the regularity keys a human has already rejected. */
export interface TombstoneCorpus {
  readonly keys: ReadonlySet<string>;
}

/**
 * Assembles the binding set from BOTH the program's `precedents` corpus (every `ruling:
 * coincidence` precedent — spec 04 §6) AND any prior distillation run's rejections. A coincidence
 * precedent contributes its key two ways: the statement key of its `pattern` (which is the rejected
 * law text) and any `gwtp-regularity:<hex>` marker embedded in its pattern/rationale/evidence — so
 * a hand-authored tombstone and a machine-written one are both honoured, with the same key space
 * ratify.ts uses.
 */
export function buildTombstoneCorpus(
  precedents: readonly Precedent[],
  priorRejections: readonly RegularityKey[] = [],
): TombstoneCorpus {
  const keys = new Set<string>();
  for (const p of precedents) {
    if (!isTombstone(p)) continue;
    keys.add(statementRegularityKey(p.pattern) as string);
    const marker = findRegularityMarker([p.pattern, p.rationale ?? '', ...p.evidence].join('\n'));
    if (marker !== null) keys.add(marker as string);
  }
  for (const k of priorRejections) keys.add(k as string);
  return { keys };
}

function isTombstoned(corpus: TombstoneCorpus, key: RegularityKey): boolean {
  return corpus.keys.has(key as string);
}

// ---------------------------------------------------------------------------
// Author-free fact views (HANDOFF — structural mirrors of src/distill/facts.ts)
// ---------------------------------------------------------------------------

/** Mirror of facts.ts `DocSnapshot` — author-free, so it may reach a prompt. */
export interface DocSnapshotView {
  readonly path: string;
  readonly kind: string;
  readonly present: boolean;
  readonly text: string | null;
}

/**
 * A top-churn diff summary. AUTHOR-FREE by construction (INV-003): the shape carries WHAT changed
 * (path, magnitude, a name-status/hunk-header summary), never WHO changed it.
 */
export interface ChurnDiffView {
  readonly path: string;
  readonly churn: number;
  readonly summary: string;
}

/** Mirror of facts.ts `NegativeSpaceProof` (with `probe.scope` flattened to `scope`). */
export interface NegativeSpaceProofView {
  readonly scope: string;
  readonly held: boolean;
  readonly commitsChecked: number;
  readonly spanFrom: CommitterTime | null;
  readonly spanTo: CommitterTime | null;
  readonly regularity: RegularityKey;
}

/** Mirror of facts.ts `ManifestEvent` aggregate — the manifest-upheaval signal (spec 04 §1). */
export interface ManifestChurnView {
  readonly manifest: string;
  readonly ecosystem: string;
  readonly churn: number;
}

/** Mirror of facts.ts `CoChangeEdge` — a co-change coupling worth naming (spec 04 §2). */
export interface CoChangeEdgeView {
  readonly a: string;
  readonly b: string;
  readonly confidence: number;
}

/** The author-free aggregates a synthesis prompt cites. */
export interface FactAggregatesView {
  readonly negativeSpaceProofs: readonly NegativeSpaceProofView[];
  readonly manifestChurn: readonly ManifestChurnView[];
  readonly coChangeTopEdges: readonly CoChangeEdgeView[];
}

/**
 * One epoch's worth of pass-two input (spec 04 §3: "each reads its epoch's doc snapshot,
 * top-churn diffs, contested PR threads, and fact-base aggregates"). NO author-bearing field —
 * that is the pass-one INV-003 boundary re-stated at pass two.
 */
export interface EpochSynthesisInput {
  readonly epoch: EpochId;
  readonly boundary: CommitSha;
  /** Recency asymmetry (spec 04 §3): only the FINAL epoch may yield statute candidates. */
  readonly isFinal: boolean;
  readonly docs: readonly DocSnapshotView[];
  readonly topChurnDiffs: readonly ChurnDiffView[];
  readonly aggregates: FactAggregatesView;
}

// ---------------------------------------------------------------------------
// Candidate shape and outcomes
// ---------------------------------------------------------------------------

/**
 * What a candidate is proposed AS (spec 04 §3). Only the final epoch yields `statute`; earlier
 * epochs are "case law, not current law" — precedent or trajectory. `kind` guides the
 * ratification generator (SEED-04 deliverable 5); the assertion atom itself is always a
 * `CandidateAssertion` (CAND-*, `inferred`).
 */
export type CandidateKind = 'statute' | 'precedent' | 'trajectory';

export const CANDIDATE_KINDS = ['statute', 'precedent', 'trajectory'] as const satisfies readonly CandidateKind[];

export interface SynthesizedCandidate {
  readonly assertion: CandidateAssertion;
  readonly kind: CandidateKind;
  readonly regularity: RegularityKey;
  /** Every epoch the merged regularity surfaced in (cross-epoch persistence — spec 04 §5). */
  readonly epochs: NonEmptyReadonlyArray<EpochId>;
  /** The exact inputs that seeded `assertion.precision` (spec 04 §5), retained for audit. */
  readonly evidence: PrecisionEvidence;
}

export type DropReason =
  | 'unparseable-reply'
  | 'model-refusal'
  | 'invalid-statement'
  | 'invalid-class'
  | 'invalid-scope'
  | 'invalid-enforcement'
  | 'invalid-kind'
  | 'missing-provenance'
  | 'tombstoned';

/** A candidate that never became a proposal, with the reason it was refused. */
export interface DroppedCandidate {
  readonly reason: DropReason;
  readonly detail: string;
  readonly epoch?: EpochId;
  readonly statement?: string;
}

export interface SynthesisResult {
  /** Merged, tombstone-filtered, precision-seeded, id-assigned. Ranked by evidence, strongest first. */
  readonly candidates: readonly SynthesizedCandidate[];
  readonly dropped: readonly DroppedCandidate[];
  readonly modelCalls: number;
  readonly epochsSynthesized: number;
}

// ---------------------------------------------------------------------------
// Cost guard (spec 04 §7 — a hard, configurable cap on synthesis model calls)
// ---------------------------------------------------------------------------

export interface SynthesisBudget {
  /** Hard cap on model calls (one per epoch). Exceeding it STOPS and reports, never spends. */
  readonly maxModelCalls: number;
}

export const DEFAULT_SYNTHESIS_BUDGET: SynthesisBudget = { maxModelCalls: 64 };

/** The typed stop-and-report when the run would exceed its model-call cap (spec 04 §7). */
export interface SynthesisCapExceeded {
  readonly reason: 'model-call-cap-exceeded';
  readonly cap: number;
  readonly requested: number;
}

// ---------------------------------------------------------------------------
// Candidate defaults (the fields the model does not choose)
// ---------------------------------------------------------------------------

export interface SynthesisConfig {
  /** First numeric id; a resume run continues numbering. Cold start: 1. */
  readonly idStart: number;
  /** `budget` seed for a candidate (spec 01 §3 example: 3.0). Humans retune at ratification. */
  readonly defaultBudget: number;
  /** `half_life` seed (spec 01 §3 example: 90d). */
  readonly defaultHalfLife: string;
  /** `enforcement` when the model omits it. Inferred candidates are never enforced regardless. */
  readonly defaultEnforcement: Enforcement;
  /** Max doc characters folded into a prompt, to bound prompt size. */
  readonly maxDocChars: number;
}

export const DEFAULT_SYNTHESIS_CONFIG: SynthesisConfig = {
  idStart: 1,
  defaultBudget: 3.0,
  defaultHalfLife: '90d',
  defaultEnforcement: 'judgment',
  maxDocChars: 4000,
};

// ---------------------------------------------------------------------------
// The synthesis prompt (spec 04 §3). Held in-code, NOT under prompts/**: those files seat
// judges (their sha256 is judge identity, spec 01 §7) and constraint 6 forbids re-seating one.
// A distillation synthesizer is not a seated judge.
// ---------------------------------------------------------------------------

export const SYNTHESIS_SYSTEM_PROMPT = [
  'You are a distillation synthesizer. You are shown one epoch of a repository as OBSERVATIONS',
  '(a doc snapshot, the highest-churn diffs, and deterministic fact aggregates) and you NAME the',
  'laws those observations imply. You infer the model from the evidence; you never enforce.',
  '',
  'Rules:',
  '  - Emit ONLY laws the shown evidence supports. Prefer negative-space laws (a boundary that',
  '    was never crossed) — they are the firmest.',
  '  - EVERY candidate MUST cite provenance: the commits, PRs, ADRs or proven boundaries it rests',
  '    on. A candidate without provenance is unreviewable and will be discarded.',
  '  - `kind`: "statute" for a current, enforceable-shaped law; "precedent" for settled case law;',
  '    "trajectory" for a directional intent. Earlier epochs yield precedent/trajectory only.',
  '',
  'Reply with JSON and nothing else:',
  '{"candidates":[{"statement":"...","class":"boundary|dependency|interface|behavior|convention",',
  '"scope":["glob/**"],"enforcement":"deterministic|judgment|hybrid","kind":"statute|precedent|trajectory",',
  '"provenance":["commit <sha>","pr#<n>","adr-<nnnn>"]}]}',
].join('\n');

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/**
 * Builds the per-epoch model request from AUTHOR-FREE views only (INV-003). Pure and
 * deterministic: the same epoch input yields the same prompt, so the model call is cacheable and
 * the walk is replayable.
 */
export function buildEpochPrompt(
  input: EpochSynthesisInput,
  config: SynthesisConfig = DEFAULT_SYNTHESIS_CONFIG,
): ModelRequest {
  const lines: string[] = [];
  lines.push(`# Epoch ${input.epoch} (boundary ${input.boundary})`);
  lines.push(input.isFinal ? 'This is the FINAL epoch: statute candidates are permitted.' : 'This is an EARLIER epoch: emit precedent/trajectory only.');

  for (const doc of input.docs) {
    if (!doc.present || doc.text === null) continue;
    lines.push('', `## Doc: ${doc.kind} — ${doc.path}`, truncate(doc.text, config.maxDocChars));
  }

  const held = input.aggregates.negativeSpaceProofs.filter((p) => p.held);
  if (held.length > 0) {
    lines.push('', '## Proven boundaries (negative space — the firmest laws)');
    for (const p of held) {
      lines.push(`- \`${p.scope}\` held violation-free across ${p.commitsChecked} commits`);
    }
  }

  if (input.aggregates.manifestChurn.length > 0) {
    lines.push('', '## Dependency-manifest upheaval');
    for (const m of input.aggregates.manifestChurn) {
      lines.push(`- ${m.manifest} (${m.ecosystem}): churn ${m.churn}`);
    }
  }

  if (input.aggregates.coChangeTopEdges.length > 0) {
    lines.push('', '## Top co-change couplings');
    for (const e of input.aggregates.coChangeTopEdges) {
      lines.push(`- ${e.a} <-> ${e.b} (confidence ${e.confidence})`);
    }
  }

  if (input.topChurnDiffs.length > 0) {
    lines.push('', '## Highest-churn changes');
    for (const d of input.topChurnDiffs) {
      lines.push('', `### ${d.path} (churn ${d.churn})`, d.summary);
    }
  }

  return { system: SYNTHESIS_SYSTEM_PROMPT, user: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Reply parsing (per epoch) — validate, drop the invalid, keep provenance mandatory
// ---------------------------------------------------------------------------

interface ParsedCandidate {
  readonly statement: string;
  readonly class: AssertionClass;
  readonly scope: NonEmptyReadonlyArray<PathGlob>;
  readonly enforcement: Enforcement;
  readonly kind: CandidateKind;
  readonly provenance: NonEmptyReadonlyArray<ProvenanceRef>;
  readonly epoch: EpochId;
  readonly ordinal: number;
}

interface EpochParse {
  readonly candidates: readonly ParsedCandidate[];
  readonly dropped: readonly DroppedCandidate[];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function inList<T extends string>(v: unknown, list: readonly T[]): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

/**
 * Parses one epoch's reply. A refusal or unparseable body yields ZERO candidates and a diagnostic
 * (honest abstain, spec 03 §4 — no candidate escapes on a bad reply). Each candidate is validated
 * independently; an invalid one is DROPPED with its reason, so a missing-provenance candidate is
 * "rejected before it can be proposed" (spec 01 §4 rule 1) while its siblings survive.
 */
export function parseEpochReply(
  text: string,
  epoch: EpochId,
  isFinal: boolean,
  config: SynthesisConfig,
): EpochParse {
  const ordinal = epochOrdinal(epoch);
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return {
      candidates: [],
      dropped: [{ reason: 'unparseable-reply', detail: 'reply was not valid JSON', epoch }],
    };
  }
  const rawList = (root as { candidates?: unknown }).candidates;
  if (!Array.isArray(rawList)) {
    return {
      candidates: [],
      dropped: [{ reason: 'unparseable-reply', detail: 'reply had no `candidates` array', epoch }],
    };
  }

  const candidates: ParsedCandidate[] = [];
  const dropped: DroppedCandidate[] = [];

  for (const raw of rawList) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const statementRaw = typeof c['statement'] === 'string' ? (c['statement'] as string) : '';
    const statement = statementRaw.trim();
    const drop = (reason: DropReason, detail: string): void => {
      dropped.push({ reason, detail, epoch, statement: statement.length > 0 ? statement : undefined });
    };

    if (statement.length < 8) {
      drop('invalid-statement', 'statement missing or shorter than 8 characters');
      continue;
    }
    if (!inList(c['class'], ASSERTION_CLASSES)) {
      drop('invalid-class', `class not one of ${ASSERTION_CLASSES.join('|')}`);
      continue;
    }
    if (!isStringArray(c['scope']) || c['scope'].length === 0) {
      drop('invalid-scope', 'scope missing or not a non-empty string array');
      continue;
    }
    const globs: PathGlob[] = [];
    let scopeBad = false;
    for (const g of c['scope']) {
      const p = parsePathGlob(g);
      if (!p.ok) {
        scopeBad = true;
        break;
      }
      globs.push(p.value);
    }
    if (scopeBad || !isNonEmpty(globs)) {
      drop('invalid-scope', 'scope contains an unsupported glob');
      continue;
    }

    let enforcement: Enforcement = config.defaultEnforcement;
    if (c['enforcement'] !== undefined) {
      if (!inList(c['enforcement'], ENFORCEMENTS)) {
        drop('invalid-enforcement', `enforcement not one of ${ENFORCEMENTS.join('|')}`);
        continue;
      }
      enforcement = c['enforcement'];
    }

    // Default kind is the conservative `precedent`: never assume a statute the model did not name.
    let kind: CandidateKind = 'precedent';
    if (c['kind'] !== undefined) {
      if (!inList(c['kind'], CANDIDATE_KINDS)) {
        drop('invalid-kind', `kind not one of ${CANDIDATE_KINDS.join('|')}`);
        continue;
      }
      kind = c['kind'];
    }
    // Recency asymmetry (spec 04 §3): an earlier epoch may not write statute; downgrade it.
    if (!isFinal && kind === 'statute') kind = 'precedent';

    // No assertion without provenance (spec 01 §4 rule 1): a candidate missing it is refused HERE.
    const provRaw = c['provenance'];
    if (!isStringArray(provRaw)) {
      drop('missing-provenance', 'provenance missing or not a string array');
      continue;
    }
    const provenance = provRaw.map((s) => s.trim()).filter((s) => s.length > 0);
    if (!isNonEmpty(provenance)) {
      drop('missing-provenance', 'provenance empty after trimming');
      continue;
    }

    candidates.push({ statement, class: c['class'], scope: globs, enforcement, kind, provenance, epoch, ordinal });
  }

  return { candidates, dropped };
}

// ---------------------------------------------------------------------------
// Merge across epochs (spec 04 §3 — the same law in N epochs merges, evidence strengthens)
// ---------------------------------------------------------------------------

interface MergedCandidate {
  readonly regularity: RegularityKey;
  readonly statement: string;
  readonly class: AssertionClass;
  readonly scope: NonEmptyReadonlyArray<PathGlob>;
  readonly enforcement: Enforcement;
  readonly kind: CandidateKind;
  readonly provenance: NonEmptyReadonlyArray<ProvenanceRef>;
  readonly epochs: NonEmptyReadonlyArray<EpochId>;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Groups parsed candidates by `RegularityKey` (identical normalized statement). The merged
 * candidate takes its phrasing, class, enforcement and kind from the HIGHEST-ORDINAL contributing
 * epoch (recency wins — "the final epoch writes the statute"), unions provenance and scope, and
 * records every epoch it surfaced in. Because recency downgrade already ran per epoch, a `statute`
 * can only have come from the final epoch, so a merged `statute` is recency-correct by
 * construction.
 */
function mergeByRegularity(parsed: readonly ParsedCandidate[]): readonly MergedCandidate[] {
  const groups = new Map<string, ParsedCandidate[]>();
  for (const c of parsed) {
    const key = statementRegularityKey(c.statement) as string;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [c]);
    else bucket.push(c);
  }

  const merged: MergedCandidate[] = [];
  for (const [key, bucket] of groups) {
    // Recency: the contributor from the latest epoch dictates phrasing/class/enforcement/kind.
    const latest = bucket.reduce((a, b) => (b.ordinal >= a.ordinal ? b : a));
    const scope = uniqueSorted(bucket.flatMap((c) => c.scope as readonly string[])) as PathGlob[];
    const provenance = uniqueSorted(bucket.flatMap((c) => c.provenance as readonly string[]));
    const epochs = uniqueSorted(bucket.map((c) => c.epoch as string)) as EpochId[];
    if (!isNonEmpty(scope) || !isNonEmpty(provenance) || !isNonEmpty(epochs)) continue;
    merged.push({
      regularity: key as RegularityKey,
      statement: latest.statement,
      class: latest.class,
      scope,
      enforcement: latest.enforcement,
      kind: latest.kind,
      provenance,
      epochs,
    });
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Precision-evidence assembly (spec 04 §5)
// ---------------------------------------------------------------------------

interface SpanFacts {
  readonly days: number;
  readonly label: string | null;
}

/**
 * The violation-free span underwriting a candidate: the longest HELD negative-space proof whose
 * scope the candidate governs (exact-glob match). 0 days when nothing exhaustive underwrites it.
 */
function spanForScope(
  scope: NonEmptyReadonlyArray<PathGlob>,
  proofs: readonly NegativeSpaceProofView[],
): SpanFacts {
  const scopeStrings = new Set(scope as readonly string[]);
  let best: SpanFacts = { days: 0, label: null };
  for (const p of proofs) {
    if (!p.held || !scopeStrings.has(p.scope)) continue;
    const days = spanDaysBetween(p.spanFrom, p.spanTo);
    if (days > best.days) {
      best = { days, label: p.spanFrom !== null && p.spanTo !== null ? `${p.spanFrom} → ${p.spanTo}` : null };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The orchestrator
// ---------------------------------------------------------------------------

export interface SynthesisRequest {
  /** Epochs oldest-first; the last is the final epoch (recency asymmetry, spec 04 §3). */
  readonly epochs: readonly EpochSynthesisInput[];
  readonly tombstones: TombstoneCorpus;
  readonly budget?: SynthesisBudget;
  readonly config?: SynthesisConfig;
}

function candidateId(n: number): CandidateId {
  const parsed = parseCandidateId(`CAND-${String(n).padStart(3, '0')}`);
  // Total by construction: n is a positive integer and the pattern admits ≥3 digits.
  if (!parsed.ok) throw new Error(`unreachable: invalid candidate id for ${n}`);
  return parsed.value;
}

/**
 * Pass two, end to end (spec 04 §3–§6):
 *   1. Cost guard (spec 04 §7): if there are more epochs than the model-call cap, STOP and report
 *      before spending a single call.
 *   2. For each epoch, oldest-first: build an author-free prompt, call the ModelClient port, parse
 *      the reply, apply recency downgrade.
 *   3. Merge across epochs by regularity; union provenance; count cross-epoch persistence.
 *   4. Drop any regularity a human has tombstoned (spec 04 §6).
 *   5. Seed precision from (violation-free span + corroborations + persistence) via ./precision.js.
 *   6. Rank by evidence, strongest first, and assign stable CAND-* ids.
 *
 * Returns `Err(SynthesisCapExceeded)` for the cost guard; otherwise `Ok(SynthesisResult)`.
 */
export async function synthesize(
  model: ModelClient,
  request: SynthesisRequest,
): Promise<Result<SynthesisResult, SynthesisCapExceeded>> {
  const config = request.config ?? DEFAULT_SYNTHESIS_CONFIG;
  const budget = request.budget ?? DEFAULT_SYNTHESIS_BUDGET;
  const epochs = request.epochs;

  // 1. Cost guard — stop-and-report, never silently spend (spec 04 §7).
  if (epochs.length > budget.maxModelCalls) {
    return err({ reason: 'model-call-cap-exceeded', cap: budget.maxModelCalls, requested: epochs.length });
  }

  // Default budget/half_life for every candidate: validated once, reused.
  const seedBudget = parseBudget(config.defaultBudget);
  const seedHalfLife = parseDuration(config.defaultHalfLife);
  if (!seedBudget.ok || !seedHalfLife.ok) {
    // A misconfigured default is a programming error, not a model failure; fail loudly.
    throw new Error('SynthesisConfig defaultBudget/defaultHalfLife is not a valid Budget/HalfLife');
  }
  const budgetVal: Budget = seedBudget.value;
  const halfLifeVal: HalfLife = seedHalfLife.value;

  // 2. Per-epoch model calls.
  const parsed: ParsedCandidate[] = [];
  const dropped: DroppedCandidate[] = [];
  const allProofs: NegativeSpaceProofView[] = [];
  let modelCalls = 0;

  for (const epoch of epochs) {
    allProofs.push(...epoch.aggregates.negativeSpaceProofs);
    const prompt = buildEpochPrompt(epoch, config);
    const reply = await model.complete(prompt);
    modelCalls += 1;
    if (reply.stopReason === 'refusal') {
      dropped.push({ reason: 'model-refusal', detail: 'model abstained on this epoch', epoch: epoch.epoch });
      continue;
    }
    const parse = parseEpochReply(reply.text, epoch.epoch, epoch.isFinal, config);
    parsed.push(...parse.candidates);
    dropped.push(...parse.dropped);
  }

  // 3. Merge across epochs.
  const merged = mergeByRegularity(parsed);

  // 4. Tombstone filter (spec 04 §6) + 5. precision seed.
  const epochsObserved = epochs.length;
  const survivors: SynthesizedCandidate[] = [];
  for (const m of merged) {
    if (isTombstoned(request.tombstones, m.regularity)) {
      dropped.push({ reason: 'tombstoned', detail: 'regularity previously rejected by a human', statement: m.statement });
      continue;
    }
    const span = spanForScope(m.scope, allProofs);
    const evidence: PrecisionEvidence = {
      violationFreeSpanDays: span.days,
      corroborations: m.provenance.length,
      epochsPersisted: m.epochs.length,
      epochsObserved,
    };
    const seed = seedPrecision(evidence);
    const precisionParsed = parsePrecision(seed);
    if (!precisionParsed.ok) {
      // Unreachable while the seed stays in (0,1], but never mint an invalid prior.
      dropped.push({ reason: 'invalid-statement', detail: `seeded precision out of range: ${seed}`, statement: m.statement });
      continue;
    }
    const precision: Precision = precisionParsed.value;
    const distEvidence: DistillationEvidence = {
      ...(span.label !== null ? { span: span.label } : {}),
      corroborations: m.provenance,
    };
    survivors.push({
      regularity: m.regularity,
      kind: m.kind,
      epochs: m.epochs,
      evidence,
      assertion: {
        id: candidateId(0), // placeholder; replaced after ranking so ids follow evidence order
        statement: m.statement,
        class: m.class,
        scope: m.scope,
        enforcement: m.enforcement,
        precision,
        budget: budgetVal,
        half_life: halfLifeVal,
        status: 'inferred',
        provenance: m.provenance,
        precision_seed: seed,
        evidence: distEvidence,
      },
    });
  }

  // 6. Rank by evidence (precision desc, then statement asc) and assign stable ids.
  survivors.sort((a, b) => {
    const dp = b.assertion.precision - a.assertion.precision;
    if (dp !== 0) return dp;
    return a.assertion.statement < b.assertion.statement ? -1 : a.assertion.statement > b.assertion.statement ? 1 : 0;
  });
  const ranked: SynthesizedCandidate[] = survivors.map((s, i) => ({
    ...s,
    assertion: { ...s.assertion, id: candidateId(config.idStart + i) },
  }));

  return ok({ candidates: ranked, dropped, modelCalls, epochsSynthesized: epochs.length });
}
