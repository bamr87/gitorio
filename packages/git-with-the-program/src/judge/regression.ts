// Implements: docs/spec/03-judge.md §7 ("The regression judge is a different animal": it works by
// ANALOGY over case law — embed the `killed` patterns, retrieve candidate matches against the
// incoming diff, and an LLM confirms *same pattern or lookalike*, citing the `PRE-id`; false
// lookalikes a human overturns become `ruling: coincidence` precedents). SEED-03 deliverable 7.
//
// The pipeline, retrieval-first so the expensive confirming call is narrow (spec 03 §7):
//   1. RETRIEVE — rank the killed corpus against the diff by a simple, documented similarity
//      (v0.5: token Jaccard; the embedding step this stands in for is a later slice).
//   2. CONFIRM  — hand the top candidate + its matched hunks to an INJECTED confirmer (the
//      seal-then-LLM-regression-judge path; a fake in tests) and read back its raw ruling.
//   3. ENFORCE  — decode the ruling through the CONTRACT (`decodeVerdict`): a `regression` MUST
//      cite the retrieved `PRE-id` (spec 03 §7; "case law works by citation") and MUST cite lines
//      inside the hunks it was shown (INV-004). A regression that cites no precedent is rejected;
//      an `aligned`/`abstain` is a lookalike.
//   4. TOMBSTONE — a lookalike yields a proposed `ruling: coincidence` precedent (spec 04 §6),
//      exposed as a `.program/precedents.yaml` diff a human ratifies, because the machine may not
//      write `.program/` (INV-001).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  BLIND MODULE (INV-003). Under `src/judge/**`. It reads only `PrecedentView` — the projection
//  that DROPS a precedent's `evidence` array (the one field that names authors and PR threads),
//  so settled case law reaches the bench with its identity stripped (src/core/precedent.ts,
//  ADR-0003). Every value import leads only to `verdict`/`precedent`/`change`/`ids`/`result` +
//  the external `yaml`; `Judge`/`SealedEvidence` are TYPE-ONLY (a value import of
//  `core/evidence.js` reaches `core/blindness.ts` → `core/sentencing.ts`, Q-60), and this module
//  never seals a bundle — the confirmer, injected from the assembler side, does.
//
//  Note on the tombstone: its `evidence` (reverts, PR threads) is SIGHTED and cannot be derived
//  here, so `CoincidenceContext` carries it in from the caller, alongside the fresh `PRE-id` (id
//  allocation is a program-level concern) and the current file bytes (to build the diff).
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { NonEmptyReadonlyArray } from '../core/brand.js';
import type { Hunk } from '../core/change.js';
import type { PrecedentId, ProvenanceRef } from '../core/ids.js';
import { decodePrecedentsFile, type Precedent, type PrecedentView } from '../core/precedent.js';
import { ContractViolationError, fail, ok, type ContractError, type Parsed } from '../core/result.js';
import {
  decodeVerdict,
  encodeVerdict,
  type AbstainVerdict,
  type AlignedVerdict,
  type Citation,
  type RegressionVerdict,
  type Verdict,
} from '../core/verdict.js';
// TYPE-ONLY, and load-bearing that it stays that way — see the header.
import type { Judge, SealedEvidence } from '../core/evidence.js';

const CLAUSE_REGRESSION = 'gwtp/verdict.schema.json#/allOf/1';

/** The one file a coincidence tombstone lands against. Never written by the machine (INV-001). */
export const PRECEDENTS_PATH = '.program/precedents.yaml' as const;

// ---------------------------------------------------------------------------
// Retrieval (spec 03 §7 steps 1-2). v0.5 similarity: token Jaccard.
// ---------------------------------------------------------------------------

/**
 * Lowercase alphanumeric tokens of length ≥ 2. Deliberately crude and deterministic: it is the
 * placeholder for the embedding retrieval spec 03 §7 describes, chosen so v0.5 has a runnable,
 * replay-stable retriever with no model and no dependency. Short tokens are dropped so `a`, `x`
 * and single digits do not manufacture spurious overlap.
 */
export function tokenize(text: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (t.length >= 2) out.add(t);
  }
  return out;
}

/** |A ∩ B| / |A ∪ B|. 0 when either side is empty. Symmetric, in [0,1]. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface RetrievalOptions {
  /** Discard candidates scoring below this (default 0.05 — surface any real overlap). */
  readonly minScore?: number;
  /** Keep at most this many, highest score first (default 5). */
  readonly limit?: number;
}

export const DEFAULT_MIN_SCORE = 0.05;
export const DEFAULT_RETRIEVAL_LIMIT = 5;

export interface RetrievalCandidate {
  readonly precedent: PrecedentView;
  readonly score: number;
  /** The hunks that individually share a token with the pattern — what the confirmer rules on. */
  readonly matchedHunks: readonly Hunk[];
}

/**
 * Rank the KILLED case law against the diff (spec 03 §7 step 1: only `killed` patterns are the
 * regression corpus). Pure and deterministic: same precedents and hunks, same ranking, ordered by
 * score descending then `PRE-id` ascending so ties are stable.
 *
 * Non-killed precedents are filtered out even if the caller passes them — an `affirmed` law is not
 * a regression pattern, and a `coincidence` tombstone is the OPPOSITE of one.
 */
export function retrieveCandidates(
  precedents: readonly PrecedentView[],
  hunks: readonly Hunk[],
  opts?: RetrievalOptions,
): readonly RetrievalCandidate[] {
  const minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;
  const limit = opts?.limit ?? DEFAULT_RETRIEVAL_LIMIT;

  const perHunkTokens = hunks.map((h) => tokenize(h.text));
  const diffTokens = new Set<string>();
  for (const set of perHunkTokens) for (const t of set) diffTokens.add(t);

  const candidates: RetrievalCandidate[] = [];
  for (const p of precedents) {
    if (p.ruling !== 'killed') continue;
    const patternTokens = tokenize(p.pattern);
    const score = jaccard(patternTokens, diffTokens);
    if (score < minScore) continue;
    const matched = hunks.filter((_h, i) => {
      const set = perHunkTokens[i] as ReadonlySet<string>;
      for (const t of set) if (patternTokens.has(t)) return true;
      return false;
    });
    candidates.push({ precedent: p, score, matchedHunks: matched.length > 0 ? matched : hunks });
  }

  return candidates
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.precedent.id < b.precedent.id ? -1 : a.precedent.id > b.precedent.id ? 1 : 0),
    )
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Confirmation (spec 03 §7 step 3) — routed through the contract
// ---------------------------------------------------------------------------

/**
 * Every cited span lies inside a hunk the confirmer was actually SHOWN — the same mechanical check
 * `citationsWithinBundle` (src/core/evidence.ts) performs, reimplemented here because a VALUE
 * import of `core/evidence.js` would reach the sentencing branch (Q-60). Structurally identical:
 * path match, and `[startLine, endLine]` within `[newStart, newStart + max(newLines, 1) − 1]`.
 */
export function citationsWithinHunks(
  hunks: readonly Hunk[],
  citations: readonly Citation[],
): boolean {
  return citations.every((c) =>
    hunks.some(
      (h) =>
        h.path === c.path &&
        c.startLine >= h.newStart &&
        c.endLine <= h.newStart + Math.max(h.newLines, 1) - 1,
    ),
  );
}

/** The injected confirming magistrate: seal a bundle for `candidate` over `hunks`, rule, return
 *  the RAW ruling record (pre-decode), exactly as the LLM regression judge would emit YAML.
 *  Sealing lives here (the assembler side), NOT in src/judge — see the module header. */
export interface RegressionConfirmer {
  confirm(candidate: PrecedentView, hunks: readonly Hunk[]): Promise<unknown>;
}

/** A `RegressionConfirmer` that produces its `SealedEvidence` outside src/judge and seals per
 *  candidate. The assembler owns `sealEvidence`; this module only names the injected seam. */
export interface RegressionSealer {
  seal(precedent: PrecedentView, hunks: readonly Hunk[]): Parsed<SealedEvidence>;
}

/**
 * Bridge a typed confirming `Judge` into a raw `RegressionConfirmer`, using an injected sealer.
 * The judge sees only the sealed bundle (blind); its typed `Verdict` is re-encoded to the raw
 * record shape so the ONE enforcement path (`interpretConfirmation` → `decodeVerdict`) applies
 * whether the confirmer is a real model judge or a canned fake.
 */
export function confirmerFromJudge(judge: Judge, sealer: RegressionSealer): RegressionConfirmer {
  return {
    async confirm(candidate, hunks) {
      const sealed = sealer.seal(candidate, hunks);
      if (!sealed.ok) throw new ContractViolationError([sealed.error]);
      const verdict = await judge(sealed.value);
      return encodeVerdict(verdict);
    },
  };
}

export type ConfirmationOutcome =
  | { readonly kind: 'regression'; readonly verdict: RegressionVerdict }
  | { readonly kind: 'lookalike'; readonly verdict: AlignedVerdict | AbstainVerdict }
  | { readonly kind: 'rejected'; readonly verdict: Verdict | null; readonly errors: readonly ContractError[] };

/**
 * Interpret a confirmer's raw ruling against the retrieved candidate (spec 03 §7 step 3). Pure.
 *
 *   regression — MUST decode cleanly, cite THIS candidate's `PRE-id` (not merely *some* precedent,
 *                and not none — decodeVerdict already rejects a regression without one, code
 *                `missing-precedent`), and cite lines inside the matched hunks. Any of those
 *                failing makes it `rejected`, never a silently accepted regression.
 *   lookalike  — a clean `aligned`/`abstain`: retrieval matched on surface tokens, the magistrate
 *                found a different mechanism (spec 03 §7).
 *   rejected   — a malformed ruling, a `regression` citing the wrong or no precedent or lines
 *                outside the bundle, or a `drift`/`stale-claim` (outside the regression bench's
 *                remit, prompts/regression-judge.md rules regression | aligned | abstain).
 */
export function interpretConfirmation(
  candidate: PrecedentView,
  matchedHunks: readonly Hunk[],
  raw: unknown,
): ConfirmationOutcome {
  const decoded = decodeVerdict(raw, '/confirmation');
  if (!decoded.ok) return { kind: 'rejected', verdict: null, errors: decoded.error };
  const v = decoded.value;

  if (v.verdict === 'regression') {
    const errors: ContractError[] = [];
    if (v.precedent !== candidate.id) {
      errors.push({
        code: 'missing-precedent',
        message: `a regression must cite the retrieved precedent ${candidate.id}, got ${JSON.stringify(v.precedent)} (spec 03 §7)`,
        at: '/confirmation/precedent',
        clause: CLAUSE_REGRESSION,
      });
    }
    if (!citationsWithinHunks(matchedHunks, v.evidence)) {
      errors.push({
        code: 'invalid-citation',
        message: 'a regression cites lines outside the matched hunks — hallucinated evidence (INV-004)',
        at: '/confirmation/evidence',
        clause: 'gwtp/verdict.schema.json#/allOf/0',
      });
    }
    if (errors.length > 0) return { kind: 'rejected', verdict: v, errors };
    return { kind: 'regression', verdict: v };
  }

  if (v.verdict === 'aligned' || v.verdict === 'abstain') {
    return { kind: 'lookalike', verdict: v };
  }

  return {
    kind: 'rejected',
    verdict: v,
    errors: [
      {
        code: 'invalid-verdict',
        message: `the regression bench rules regression | aligned | abstain; got \`${v.verdict}\` (prompts/regression-judge.md)`,
        at: '/confirmation/verdict',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The coincidence tombstone (spec 03 §7, spec 04 §6) — a PROPOSED diff, never a write
// ---------------------------------------------------------------------------

/** Sighted context a tombstone needs but a blind judge cannot supply. */
export interface CoincidenceContext {
  /** Fresh PRE-id; allocation is a program-level, sighted concern. */
  readonly nextId: PrecedentId;
  /** Reverts / issues / PR threads (schema minItems 1). Sighted — supplied by the caller. */
  readonly evidence: NonEmptyReadonlyArray<ProvenanceRef>;
  /** Current bytes of `.program/precedents.yaml`, so the diff's pre-image matches exactly. */
  readonly existingPrecedentsYaml: string;
}

export interface ProposedCoincidence {
  readonly precedent: Precedent;
  readonly path: typeof PRECEDENTS_PATH;
  /** A unified diff appending the tombstone; a human ratifies it (INV-001). */
  readonly diff: string;
  readonly rationale: string;
}

/** id, pattern, ruling, [rationale], evidence — same field order as `encodePrecedent`, undefined
 *  rationale dropped so the rendered YAML carries no `null`. */
function precedentToPlain(p: Precedent): Record<string, unknown> {
  const out: Record<string, unknown> = { id: p.id, pattern: p.pattern, ruling: p.ruling };
  if (p.rationale !== undefined) out.rationale = p.rationale;
  out.evidence = [...p.evidence];
  return out;
}

function renderPrecedentsYaml(precedents: readonly Precedent[]): string {
  if (precedents.length === 0) return '[]\n';
  return stringifyYaml(precedents.map(precedentToPlain));
}

function parseExistingPrecedents(text: string): Parsed<readonly Precedent[]> {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    return fail('wrong-type', `precedents.yaml is not valid YAML: ${(e as Error).message}`, PRECEDENTS_PATH);
  }
  const decoded = decodePrecedentsFile(raw, PRECEDENTS_PATH);
  if (!decoded.ok) {
    const first = decoded.error[0];
    return fail(first?.code ?? 'wrong-type', first?.message ?? 'invalid precedents file', first?.at);
  }
  return ok(decoded.value);
}

interface SplitText {
  readonly lines: readonly string[];
  readonly finalNewline: boolean;
}

function splitLines(text: string): SplitText {
  if (text === '') return { lines: [], finalNewline: false };
  const finalNewline = text.endsWith('\n');
  const body = finalNewline ? text.slice(0, -1) : text;
  return { lines: body.split('\n'), finalNewline };
}

/**
 * A whole-file-replacement unified diff: every old line removed, every new line added, under one
 * hunk header with exact line counts, and a `\ No newline at end of file` marker whenever a side
 * lacks a trailing newline. Deterministic and — because the pre-image is `oldText` verbatim —
 * `git apply`-able against the file it was rendered from. Not minimal; a proposal is read and
 * ratified by a human, not optimized for diff size.
 */
export function wholeFileReplaceDiff(path: string, oldText: string, newText: string): string {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const out: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${a.lines.length === 0 ? 0 : 1},${a.lines.length} +${b.lines.length === 0 ? 0 : 1},${b.lines.length} @@`,
  ];
  a.lines.forEach((l, i) => {
    out.push(`-${l}`);
    if (i === a.lines.length - 1 && !a.finalNewline) out.push('\\ No newline at end of file');
  });
  b.lines.forEach((l, i) => {
    out.push(`+${l}`);
    if (i === b.lines.length - 1 && !b.finalNewline) out.push('\\ No newline at end of file');
  });
  out.push('');
  return out.join('\n');
}

/**
 * Build the proposed `coincidence` precedent and its diff (spec 03 §7: "false lookalikes that a
 * human overturns become `ruling: coincidence` precedents — the case law sharpens itself"). The
 * tombstone records that retrieval matched `candidate` but the magistrate ruled a superficial
 * resemblance, so the same lookalike is not re-litigated (spec 04 §6 checks tombstones). Pure;
 * writes nothing.
 */
export function proposeCoincidence(args: {
  readonly candidate: PrecedentView;
  readonly verdict: AlignedVerdict | AbstainVerdict;
  readonly context: CoincidenceContext;
}): Parsed<ProposedCoincidence> {
  const { candidate, verdict, context } = args;
  const existing = parseExistingPrecedents(context.existingPrecedentsYaml);
  if (!existing.ok) return existing;

  const rationale =
    `Retrieval matched this change against killed precedent ${candidate.id} ` +
    `("${candidate.pattern}"), but the regression magistrate ruled \`${verdict.verdict}\` — a ` +
    'superficial resemblance, not the same mechanism (spec 03 §7). Recording a `coincidence` ' +
    'tombstone so the same lookalike is not re-litigated (spec 04 §6).';

  const tombstone: Precedent = {
    id: context.nextId,
    pattern: `Lookalike of ${candidate.id}: ${candidate.pattern}`,
    ruling: 'coincidence',
    rationale,
    evidence: context.evidence,
  };

  const newText = renderPrecedentsYaml([...existing.value, tombstone]);
  const diff = wholeFileReplaceDiff(PRECEDENTS_PATH, context.existingPrecedentsYaml, newText);
  return ok({ precedent: tombstone, path: PRECEDENTS_PATH, diff, rationale });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface RegressionInput {
  /** The incoming diff. */
  readonly hunks: readonly Hunk[];
  /** The killed case law, already projected to the blind `PrecedentView` (no evidence leaks). */
  readonly precedents: readonly PrecedentView[];
}

export interface RegressionConfig {
  readonly confirmer: RegressionConfirmer;
  readonly retrieval?: RetrievalOptions;
  /** When present, a lookalike outcome carries a proposed `.program/precedents.yaml` tombstone. */
  readonly coincidence?: CoincidenceContext;
}

export type RegressionOutcome =
  | { readonly kind: 'no-candidate' }
  | { readonly kind: 'regression'; readonly candidate: RetrievalCandidate; readonly verdict: RegressionVerdict }
  | {
      readonly kind: 'lookalike';
      readonly candidate: RetrievalCandidate;
      readonly verdict: AlignedVerdict | AbstainVerdict;
      readonly tombstone: ProposedCoincidence | null;
    }
  | {
      readonly kind: 'rejected';
      readonly candidate: RetrievalCandidate;
      readonly verdict: Verdict | null;
      readonly errors: readonly ContractError[];
    };

export interface RegressionResult {
  readonly candidates: readonly RetrievalCandidate[];
  readonly outcome: RegressionOutcome;
}

/**
 * Retrieve → confirm the single best match → enforce the PRE-id contract → classify. v0.5 confirms
 * only the top-ranked candidate: retrieval is the cheap wide net, and the confirming call is
 * "narrow" (spec 03 §7). A confirmed regression short-circuits; a lookalike proposes a tombstone
 * (if the caller supplied the sighted context); a malformed or uncited regression is rejected.
 */
export async function runRegression(
  input: RegressionInput,
  config: RegressionConfig,
): Promise<RegressionResult> {
  const candidates = retrieveCandidates(input.precedents, input.hunks, config.retrieval);
  if (candidates.length === 0) return { candidates, outcome: { kind: 'no-candidate' } };

  const top = candidates[0] as RetrievalCandidate;
  const raw = await config.confirmer.confirm(top.precedent, top.matchedHunks);
  const c = interpretConfirmation(top.precedent, top.matchedHunks, raw);

  if (c.kind === 'regression') {
    return { candidates, outcome: { kind: 'regression', candidate: top, verdict: c.verdict } };
  }
  if (c.kind === 'lookalike') {
    let tombstone: ProposedCoincidence | null = null;
    if (config.coincidence !== undefined) {
      const proposed = proposeCoincidence({
        candidate: top.precedent,
        verdict: c.verdict,
        context: config.coincidence,
      });
      tombstone = proposed.ok ? proposed.value : null;
    }
    return { candidates, outcome: { kind: 'lookalike', candidate: top, verdict: c.verdict, tombstone } };
  }
  return { candidates, outcome: { kind: 'rejected', candidate: top, verdict: c.verdict, errors: c.errors } };
}
