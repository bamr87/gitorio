// Implements: docs/spec/03-judge.md §3 (evidence assembly), §4 (the output contract: anchored
// ordinal severity, mandatory citations for violations, first-class `abstain`), §6 (judge
// identity), ADR-0005 and .program/invariants.yaml INV-004 ("Violation verdicts carry line-span
// citations and anchored ordinal severity only"). THE LLM INVARIANT JUDGE.
//
// It wraps prompts/invariant-judge.md, fills it from a SealedEvidence bundle, sends it through a
// ModelClient PORT (src/core/model.ts — the judge never names a provider SDK, INV-005), parses
// the single-YAML-document reply strictly through decodeVerdict (so an uncited violation, an
// off-anchor severity, or a regression-without-PRE-id is rejected by the contract, not re-derived
// here — INV-004), enforces that every cited span lies inside a hunk it was shown, and on any of
// those failures re-prompts EXACTLY ONCE before abstaining. A model refusal becomes a safe
// abstain without a re-prompt. It never forces a call.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  BLIND MODULE (INV-003). See the header of ./prompt.js for the full import discipline: value
//  imports are sentencing-clean core modules (verdict.ts) plus the external `yaml` and this
//  package's own ./prompt.js; SealedEvidence / Judge / ModelClient are TYPE-ONLY (erased).
//  The judge's ONLY parameter is a SealedEvidence that only sealEvidence() mints, so there is no
//  second argument through which authorship or a running total could arrive.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { parse as parseYaml } from 'yaml';

import {
  decodeVerdict,
  isViolation,
  type AbstainVerdict,
  type Verdict,
} from '../../core/verdict.js';
import type { AccumulatorKey } from '../../core/ids.js';
import type { ContractError } from '../../core/result.js';
import type { Judge, SealedEvidence } from '../../core/evidence.js';
import type { ModelClient, ModelRequest, ModelResponse } from '../../core/model.js';

import {
  INVARIANT_JUDGE_TURN,
  citationsWithinShownHunks,
  extractYamlDocument,
  fillInvariantPrompt,
} from './prompt.js';

// The seat is stamped by the caller at event-mint time, exactly like the deterministic judge —
// re-exported here so a seating/bar-exam path has one entry point for this judge's identity.
export { modelInvariantJudgeRef, promptFileHash } from './prompt.js';

/**
 * Everything the judge closes over. The template is passed in (not read from disk here) so the
 * Judge stays pure over its inputs — the harness/CLI does the I/O and the seating comparison.
 */
export interface ModelInvariantJudgeConfig {
  readonly client: ModelClient;
  /** Raw bytes of prompts/invariant-judge.md, placeholders UNFILLED. Hashed for identity; a copy is filled per invocation. */
  readonly promptTemplate: string;
  /** Optional output cap forwarded on every complete(); the client applies its own default when omitted. */
  readonly maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Corrections (the one re-prompt carries what was wrong)
// ---------------------------------------------------------------------------

const PARSE_CORRECTION =
  'Your previous reply was not a single parseable YAML document. Reply with exactly one YAML ' +
  'document and nothing else — no prose before or after.';

const HALLUCINATION_CORRECTION =
  'Your evidence cited lines outside the hunks you were shown. Cite only file:line spans that ' +
  'appear in the change above; if the shown hunks do not let you point at specific offending ' +
  'lines, your verdict is `abstain`.';

function decodeCorrection(errors: readonly ContractError[]): string {
  const detail = errors
    .slice(0, 4)
    .map((e) => e.message)
    .join('; ');
  return (
    `Your ruling did not satisfy the output contract (${detail}). Re-read the rules of the ` +
    'bench: a violation requires an anchored severity (grazes|bends|breach|entrenches) AND at ' +
    'least one file:line-span citation AND a rationale; aligned and abstain carry verdict + ' +
    'confidence only.'
  );
}

function mismatchCorrection(expected: AccumulatorKey, got: AccumulatorKey): string {
  return (
    `You ruled on assertion ${got}, but you must rule on exactly ${expected}. Re-issue your ` +
    `ruling with assertion: ${expected}.`
  );
}

// ---------------------------------------------------------------------------
// Interpreting one model reply
// ---------------------------------------------------------------------------

type Interpretation =
  | { readonly status: 'accept'; readonly verdict: Verdict }
  | { readonly status: 'refusal' }
  | { readonly status: 'retry'; readonly correction: string };

/**
 * Everything is routed through the contract. `decodeVerdict` already rejects an uncited violation
 * (`uncited-violation`), an off-anchor severity (`invalid-severity`), and a regression without a
 * PRE-id (`missing-precedent`) — INV-004 without re-deriving it. On top of mere citation PRESENCE
 * we enforce that each cited span lies inside a shown hunk, killing hallucinated line references.
 */
function interpret(sealed: SealedEvidence, key: AccumulatorKey, response: ModelResponse): Interpretation {
  // A refusal is not re-promptable — re-asking a refusal is pointless (spec 03 §4).
  if (response.stopReason === 'refusal') return { status: 'refusal' };

  let parsed: unknown;
  try {
    parsed = parseYaml(extractYamlDocument(response.text));
  } catch {
    return { status: 'retry', correction: PARSE_CORRECTION };
  }

  const decoded = decodeVerdict(parsed);
  if (!decoded.ok) return { status: 'retry', correction: decodeCorrection(decoded.error) };

  const verdict = decoded.value;
  if (verdict.assertion !== key) {
    return { status: 'retry', correction: mismatchCorrection(key, verdict.assertion) };
  }
  if (isViolation(verdict) && !citationsWithinShownHunks(sealed, verdict.evidence)) {
    return { status: 'retry', correction: HALLUCINATION_CORRECTION };
  }
  return { status: 'accept', verdict };
}

// ---------------------------------------------------------------------------
// Abstentions (spec 03 §4: honest uncertainty, never a forced call; never accumulates)
// ---------------------------------------------------------------------------

function abstain(key: AccumulatorKey, rationale: string): AbstainVerdict {
  return { assertion: key, verdict: 'abstain', rationale };
}

const REFUSAL_ABSTAIN =
  'The model declined to rule on this change (stop reason: refusal). Abstaining rather than ' +
  'forcing a call (spec 03 §4); abstain never accumulates and escalates with a wider context ring.';

function exhaustedAbstain(key: AccumulatorKey, lastCorrection: string): AbstainVerdict {
  return abstain(
    key,
    'After a correction and one re-prompt the model still did not return a clean ruling ' +
      `(${lastCorrection}). Abstaining; abstain never accumulates and escalates (spec 03 §4).`,
  );
}

// ---------------------------------------------------------------------------
// THE JUDGE
// ---------------------------------------------------------------------------

/**
 * SealedEvidence in, Verdict out — the one signature every rung of the ladder implements
 * (src/core/evidence.ts), so this is drop-in substitutable for the deterministic rung. Total:
 * every path returns a Verdict.
 *
 * Flow: fill the template from `sealed.bundle` -> complete() -> interpret. A `refusal` -> abstain
 * immediately. A malformed YAML, a decodeVerdict failure (uncited violation / off-anchor severity
 * / regression-without-PRE-id), an assertion-id mismatch, or a citation outside the shown hunks
 * -> exactly ONE re-prompt whose user turn carries a correction -> if the second ruling is still
 * not a clean accept, abstain. A clean aligned/abstain/cited-violation is returned unchanged.
 */
export function modelInvariantJudge(config: ModelInvariantJudgeConfig): Judge {
  const { client, promptTemplate, maxTokens } = config;

  return async (sealed: SealedEvidence): Promise<Verdict> => {
    const view = sealed.bundle.assertion;
    const key: AccumulatorKey = view.id;
    const system = fillInvariantPrompt(promptTemplate, sealed);

    const request = (user: string): ModelRequest =>
      maxTokens === undefined ? { system, user } : { system, user, maxTokens };

    const first = interpret(sealed, key, await client.complete(request(INVARIANT_JUDGE_TURN)));
    if (first.status === 'accept') return first.verdict;
    if (first.status === 'refusal') return abstain(key, REFUSAL_ABSTAIN);

    // Exactly one corrective re-prompt: a fresh single-shot call folding the correction into the
    // user turn (the port is stateless; there is no message history to carry).
    const secondUser = `${INVARIANT_JUDGE_TURN}\n\n${first.correction}`;
    const second = interpret(sealed, key, await client.complete(request(secondUser)));
    if (second.status === 'accept') return second.verdict;
    if (second.status === 'refusal') return abstain(key, REFUSAL_ABSTAIN);
    return exhaustedAbstain(key, second.correction);
  };
}
