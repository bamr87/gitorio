// Implements: docs/spec/03-judge.md §3 (evidence assembly — "the assertion (statement, class,
// scope), its charter provenance, the diff hunks intersecting the assertion's scope"), §4 (the
// output contract), §6 (judge identity = model id + prompt-file hash), and ADR-0005/INV-004
// (anchored severity; "no citation, no verdict"). The prompt-plumbing half of the LLM invariant
// judge: it fills prompts/invariant-judge.md from a SealedEvidence bundle, hashes the prompt FILE
// into the judge's identity, and re-implements the "citation within a shown hunk" check.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  BLIND MODULE (INV-003). Under `src/judge/**`, so scripts/check-inv003.ts forbids it from
//  value-importing core/{sentencing,accumulator,dispersion} and tests/ledger/blindness-
//  boundary.test.ts forbids it from REACHING them through any chain of value imports.
//
//  Value imports are all sentencing-clean: change.ts, verdict.ts, ids.ts, canonical.ts and the
//  external `yaml` — each verified never to reach the sentencing branch (change/verdict/ids/
//  canonical lead only to brand/result/paths/severity/time/node:crypto). model.ts imports
//  nothing at all.
//
//  Type-only (erased) imports: evidence.ts (SealedEvidence, AssertionView) and event.ts
//  (JudgeRef). A VALUE import of evidence.ts would transitively reach core/blindness.ts ->
//  SENTENCING_TAG in core/sentencing.ts (docs/spec/OPEN-QUESTIONS.md Q-60), so — exactly as the
//  shipped deterministic judge does — this module never value-imports it, and re-implements
//  `citationsWithinShownHunks` locally rather than value-importing `citationsWithinBundle`.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { stringify as stringifyYaml } from 'yaml';

import { scopedHunks, type Hunk } from '../../core/change.js';
import { hashBlob } from '../../core/canonical.js';
import { type PromptHash, parseJudgeId, parsePromptHash } from '../../core/ids.js';
import { unwrap } from '../../core/result.js';
// TYPE-ONLY, and load-bearing that it stays that way — see the header.
import type { AssertionView, SealedEvidence } from '../../core/evidence.js';
import type { JudgeRef } from '../../core/event.js';
import type { ModelClient } from '../../core/model.js';
import type { Citation } from '../../core/verdict.js';

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

/**
 * The four — and ONLY four — placeholders prompts/invariant-judge.md interpolates. Each is drawn
 * exclusively from `sealed.bundle` (spec 03 §3): the AssertionView projection {id, statement,
 * class, scope}, the charter excerpt, and the scope-intersected hunks. Author identity, the
 * accumulator, and prior verdicts are ABSENT by construction — none of them exists on the bundle.
 */
export const INVARIANT_PROMPT_PLACEHOLDERS = [
  'assertion_yaml',
  'assertion_id',
  'charter_excerpt',
  'scoped_hunks',
] as const;

/**
 * The single fixed user turn accompanying the filled template (a provider needs a non-empty user
 * message). Constant and evidence-free: it carries no author, no meter, and is NOT part of judge
 * identity — only the prompt FILE hash is. A re-prompt sends `${INVARIANT_JUDGE_TURN}\n\n${...}`.
 */
export const INVARIANT_JUDGE_TURN =
  'Deliver your ruling now as exactly one YAML document, and nothing else.';

// ---------------------------------------------------------------------------
// Template filling — single-pass and injection-safe
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * One left-to-right pass over the TEMPLATE, substituting each `{{key}}` for its value. The
 * replacement text is NEVER re-scanned — `String.replace` with a function does not re-examine
 * inserted content — so a hunk or charter excerpt whose own text contains a literal `{{...}}`
 * cannot re-expand into a fifth placeholder or smuggle content past the projection. An unknown
 * `{{key}}` is left verbatim (it is template text the caller did not fill).
 */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER_RE, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? (values[key] as string) : whole,
  );
}

/**
 * Deterministic YAML projection of exactly {id, statement, class, scope} — the whole of what
 * spec 03 §3 permits a judge to see about the assertion. No precision/budget/half_life/status:
 * AssertionView has no slot for a knob (docs/spec/OPEN-QUESTIONS.md Q-21), so a stray accumulator
 * value has nowhere to land. Same view, same bytes.
 */
export function renderAssertionYaml(view: AssertionView): string {
  return stringifyYaml({
    id: view.id,
    statement: view.statement,
    class: view.class,
    scope: [...view.scope],
  }).trimEnd();
}

/**
 * The hunks intersecting the assertion's scope (spec 03 §3), each as a labelled unified-diff
 * block with its `@@` header, so a cited `file:line` is locatable against post-image line
 * numbers. Deterministic — same hunks, same text.
 */
export function renderScopedHunks(hunks: readonly Hunk[]): string {
  if (hunks.length === 0) {
    return '(no hunks in this change intersect the assertion’s scope)';
  }
  return hunks
    .map(
      (h) =>
        `--- ${h.path}\n@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.text}`,
    )
    .join('\n\n');
}

/**
 * Fill {{assertion_yaml}}, {{assertion_id}}, {{charter_excerpt}}, {{scoped_hunks}} from the sealed
 * bundle and NOTHING else. Draws exclusively from `sealed.bundle`; never touches an accumulator,
 * an author, or a prior verdict — none exist on the bundle. Re-scoping the hunks here matches the
 * deterministic judge and is cheap insurance against a caller that sealed unfiltered hunks.
 */
export function fillInvariantPrompt(template: string, sealed: SealedEvidence): string {
  const view = sealed.bundle.assertion;
  const scoped = scopedHunks(view.scope, sealed.bundle.hunks);
  return fillTemplate(template, {
    assertion_yaml: renderAssertionYaml(view),
    assertion_id: view.id,
    charter_excerpt: sealed.bundle.charterExcerpt,
    scoped_hunks: renderScopedHunks(scoped),
  });
}

// ---------------------------------------------------------------------------
// YAML extraction from the model reply
// ---------------------------------------------------------------------------

const FENCED_BLOCK_RE = /```(?:ya?ml)?\s*\n([\s\S]*?)```/;

/**
 * Strips a single ```yaml … ``` fence (and any surrounding prose) if the model added one despite
 * "respond with exactly one YAML document"; otherwise returns the trimmed text. Minimal
 * robustness before `yaml.parse` — anything still unparseable becomes a re-prompt, not a crash.
 */
export function extractYamlDocument(text: string): string {
  const m = FENCED_BLOCK_RE.exec(text);
  return (m ? (m[1] as string) : text).trim();
}

// ---------------------------------------------------------------------------
// Citation containment — INV-004 turned from a rule the model is ASKED to follow into one
// the harness ENFORCES
// ---------------------------------------------------------------------------

/**
 * True when EVERY cited span lies inside a hunk the judge was actually shown. A violation citing
 * lines outside the bundle is a hallucinated reference and must be re-prompted (ADR-0005,
 * INV-004: "no citation, no verdict" — and no HALLUCINATED citation either).
 *
 * Reimplemented here rather than value-imported as `citationsWithinBundle` from evidence.ts,
 * because a value import of evidence.ts reaches core/blindness -> core/sentencing (Q-60).
 * Structurally identical: path match plus [startLine, endLine] within
 * [newStart, newStart + max(newLines, 1) - 1]. Reads only `sealed.bundle.hunks` (blind data).
 */
export function citationsWithinShownHunks(
  sealed: SealedEvidence,
  citations: readonly Citation[],
): boolean {
  return citations.every((c) =>
    sealed.bundle.hunks.some(
      (h) =>
        h.path === c.path &&
        c.startLine >= h.newStart &&
        c.endLine <= h.newStart + Math.max(h.newLines, 1) - 1,
    ),
  );
}

// ---------------------------------------------------------------------------
// Judge identity (spec 03 §6: model id + prompt-file hash)
// ---------------------------------------------------------------------------

/**
 * sha256 of the prompt FILE, unfilled. Filling placeholders per invocation therefore never
 * changes identity, while EDITING prompts/invariant-judge.md does — which is exactly what
 * spec 03 §6 calls seating a new judge and gates on a ratified PR + a passing bar exam. Total
 * by construction: `hashBlob` always yields a well-formed `sha256:<64 hex>`.
 */
export function promptFileHash(promptTemplate: string): PromptHash {
  return unwrap(parsePromptHash(hashBlob(promptTemplate)));
}

/**
 * The seat this judge stamps on the ledger event it grounds: kind `model`, id = the seated model
 * id, prompt = sha256 of the prompt FILE (spec 03 §6). Changing the model OR the file is seating
 * a new judge. Exposed so the CLI can compare against .program/manifest.yaml and run the bar exam
 * BEFORE this judge is allowed to sit — the judge FUNCTION returns only a Verdict; this ref is
 * applied later at event-mint time by the caller, matching the deterministic judge's split of
 * IMPORT_BOUNDARY_JUDGE vs judgeImportBoundary. Throws ContractViolationError on a malformed
 * model id. `JudgeRef` and `ModelClient` are TYPE-ONLY imports (erased).
 */
export function modelInvariantJudgeRef(client: ModelClient, promptTemplate: string): JudgeRef {
  return {
    kind: 'model',
    id: unwrap(parseJudgeId(client.modelId)),
    prompt: promptFileHash(promptTemplate),
  };
}
