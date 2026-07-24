// Implements: docs/spec/03-judge.md §4 (the output contract), against
// schemas/verdict.schema.json. THE JUDGE VERDICT CONTRACT: ordinal severity, prose
// rationale, pre-ledger. Nothing in this file knows what an accumulator is.
//
// Every conditional requirement the schema expresses with allOf/if/then is expressed here as
// UNION MEMBERSHIP, so an invalid verdict is unconstructable rather than merely unvalidatable.

import type { NonEmptyReadonlyArray } from './brand.js';
import { isNonEmpty } from './brand.js';
import type { CanonicalObject } from './canonical.js';
import { optionalString, requireArray, requireRecord, requireString, take } from './decode.js';
import {
  type AccumulatorKey,
  type PrecedentId,
  parseAccumulatorKey,
  parsePrecedentId,
} from './ids.js';
import { type RepoPath, parseRepoPath } from './paths.js';
import { type ContractError, err, fail, ok, type Decoded, type Parsed } from './result.js';
import { type SeverityOrdinal, parseSeverityOrdinal } from './severity.js';
import type { Brand } from './brand.js';

const SCHEMA = 'gwtp/verdict.schema.json';

export type VerdictKind = 'aligned' | 'drift' | 'regression' | 'stale-claim' | 'abstain';

export const VERDICT_KINDS = [
  'aligned',
  'drift',
  'regression',
  'stale-claim',
  'abstain',
] as const satisfies readonly VerdictKind[];

/** The three that accumulate (spec 02 §4). DERIVED, so it cannot drift from VerdictKind. */
export type ViolationVerdictKind = Extract<VerdictKind, 'drift' | 'regression' | 'stale-claim'>;

export const VIOLATION_VERDICT_KINDS = [
  'drift',
  'regression',
  'stale-claim',
] as const satisfies readonly ViolationVerdictKind[];

/** `aligned` is counted but pays nothing down; `abstain` never accumulates, it escalates. */
export type NonAccumulatingVerdictKind = Exclude<VerdictKind, ViolationVerdictKind>;

/** The fold's trichotomy (spec 02 §4, spec 03 §4). */
export type VerdictDisposition = 'violation' | 'compliance' | 'abstention';

export function isViolationKind(kind: VerdictKind): kind is ViolationVerdictKind {
  return kind === 'drift' || kind === 'regression' || kind === 'stale-claim';
}

export function dispositionOfKind(kind: VerdictKind): VerdictDisposition {
  if (isViolationKind(kind)) return 'violation';
  return kind === 'abstain' ? 'abstention' : 'compliance';
}

// ---------------------------------------------------------------------------
// Citations — "no citation, no verdict" (ADR-0005, INV-004)
// ---------------------------------------------------------------------------

/** Mirrors gwtp/verdict.schema.json#/properties/evidence/items/pattern VERBATIM. */
export const CITATION_PATTERN = /^.+:[0-9]+(-[0-9]+)?$/;

const CITATION_CAPTURE = /^(.+):([0-9]+)(?:-([0-9]+))?$/;

/**
 * A struct rather than an opaque string, so SEED-03 can mechanically check that a cited span
 * lies inside a hunk the judge was actually shown. Lines are 1-based inclusive;
 * `endLine === startLine` for a single-line span. `source` re-emits verbatim.
 */
export interface Citation {
  readonly path: RepoPath;
  readonly startLine: number;
  readonly endLine: number;
  readonly source: string;
}

export function parseCitation(raw: unknown, at?: string): Parsed<Citation> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string citation', at);
  const m = CITATION_CAPTURE.exec(raw);
  if (m === null) {
    return fail(
      'invalid-citation',
      `expected <file>:<line> or <file>:<start>-<end>, got ${JSON.stringify(raw)}`,
      at,
      `${SCHEMA}#/properties/evidence/items`,
    );
  }
  const p = parseRepoPath(m[1] as string, at);
  if (!p.ok) return p;
  const startLine = Number.parseInt(m[2] as string, 10);
  const endLine = m[3] === undefined ? startLine : Number.parseInt(m[3], 10);
  if (startLine < 1) return fail('invalid-citation', 'line numbers are 1-based', at);
  if (endLine < startLine) {
    return fail('invalid-citation', `citation span runs backwards: ${raw}`, at);
  }
  return ok({ path: p.value, startLine, endLine, source: raw });
}

export function formatCitation(c: Citation): string {
  return c.startLine === c.endLine ? `${c.path}:${c.startLine}` : `${c.path}:${c.startLine}-${c.endLine}`;
}

/** Schema: minimum 0, maximum 1, inclusive both ends. */
export type Confidence = Brand<number, 'Confidence'>;

export function parseConfidence(raw: unknown, at?: string): Parsed<Confidence> {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fail('wrong-type', 'confidence must be a finite number', at);
  }
  if (raw < 0 || raw > 1) {
    return fail(
      'invalid-confidence',
      `confidence must be in [0, 1], got ${raw}`,
      at,
      `${SCHEMA}#/properties/confidence`,
    );
  }
  return ok(raw as Confidence);
}

// ---------------------------------------------------------------------------
// The verdict union
// ---------------------------------------------------------------------------

export interface VerdictCommon {
  readonly assertion: AccumulatorKey;
  readonly confidence?: Confidence;
}

/**
 * "Aligned verdicts stay terse" (spec 03 §4; prompts/invariant-judge.md: "verdict +
 * confidence only"). The `?: never` poison pills make terseness STRUCTURAL: a judge adapter
 * that hands back an aligned verdict carrying a rationale fails to compile.
 *
 * Stricter than the schema, which never forbids these fields.
 * See docs/spec/OPEN-QUESTIONS.md Q-03.
 */
export interface AlignedVerdict extends VerdictCommon {
  readonly verdict: 'aligned';
  readonly severity?: never;
  readonly evidence?: never;
  readonly rationale?: never;
  readonly precedent?: null;
}

/**
 * "Honest insufficiency": never accumulates, always escalates with a wider context ring.
 * `rationale` is permitted, unlike on `aligned` — an abstention that says what it lacked is
 * worth keeping, and it feeds the escalation decision. Forbidding `severity` is what stops
 * an abstention from ever being folded as surprise by a later refactor: the ledger event
 * type simply has nowhere to put it.
 */
export interface AbstainVerdict extends VerdictCommon {
  readonly verdict: 'abstain';
  readonly severity?: never;
  readonly evidence?: never;
  readonly rationale?: string;
  readonly precedent?: null;
}

/**
 * gwtp/verdict.schema.json#/allOf/0: drift|regression|stale-claim require
 * severity + evidence + rationale. The conditional becomes three NON-OPTIONAL properties.
 *
 * `NonEmptyReadonlyArray` is one notch stricter than the schema (which omits `minItems`) and
 * is required by ADR-0005, INV-004, both judge prompts, and SEED-03's acceptance test
 * "uncited violation rejected". See docs/spec/OPEN-QUESTIONS.md Q-06.
 */
export interface ViolationVerdictCommon extends VerdictCommon {
  readonly severity: SeverityOrdinal;
  readonly evidence: NonEmptyReadonlyArray<Citation>;
  readonly rationale: string;
}

export interface DriftVerdict extends ViolationVerdictCommon {
  readonly verdict: 'drift';
  readonly precedent?: PrecedentId | null;
}

/** Emitted by the scheduled obsolescence sweep (spec 02 §7), not by a commit trigger. */
export interface StaleClaimVerdict extends ViolationVerdictCommon {
  readonly verdict: 'stale-claim';
  readonly precedent?: PrecedentId | null;
}

/**
 * gwtp/verdict.schema.json#/allOf/1: `verdict: regression` requires `precedent`.
 * Non-optional AND non-nullable: a regression verdict without a PRE-id is unconstructable.
 * "Case law works by citation" (prompts/regression-judge.md).
 */
export interface RegressionVerdict extends ViolationVerdictCommon {
  readonly verdict: 'regression';
  readonly precedent: PrecedentId;
}

export type ViolationVerdict = DriftVerdict | StaleClaimVerdict | RegressionVerdict;

export type Verdict = AlignedVerdict | AbstainVerdict | ViolationVerdict;

/** Narrows on the `verdict` literal discriminant; no runtime shape sniffing. */
export function isViolation(v: Verdict): v is ViolationVerdict {
  return isViolationKind(v.verdict);
}

export function verdictDisposition(v: Verdict): VerdictDisposition {
  return dispositionOfKind(v.verdict);
}

// ---------------------------------------------------------------------------
// Decode / encode
// ---------------------------------------------------------------------------

const KNOWN_KEYS = [
  'assertion',
  'verdict',
  'severity',
  'confidence',
  'evidence',
  'precedent',
  'rationale',
] as const;

export function decodeVerdict(raw: unknown, at = ''): Decoded<Verdict> {
  const rec = requireRecord(raw, at);
  if (!rec.ok) return err([rec.error]);
  const r = rec.value;
  const errors: ContractError[] = [];

  const assertionRaw = take(requireString(r, 'assertion', at), errors);
  const assertion =
    assertionRaw === undefined
      ? undefined
      : take(parseAccumulatorKey(assertionRaw, `${at}/assertion`), errors);

  const kindRaw = take(requireString(r, 'verdict', at), errors);
  const kind = VERDICT_KINDS.find((k) => k === kindRaw);
  if (kindRaw !== undefined && kind === undefined) {
    errors.push({
      code: 'invalid-verdict',
      message: `verdict must be one of ${VERDICT_KINDS.join(' | ')}, got ${JSON.stringify(kindRaw)}`,
      at: `${at}/verdict`,
      clause: `${SCHEMA}#/properties/verdict`,
    });
  }

  let confidence: Confidence | undefined;
  if (r['confidence'] !== undefined && r['confidence'] !== null) {
    confidence = take(parseConfidence(r['confidence'], `${at}/confidence`), errors);
  }

  let precedent: PrecedentId | null | undefined;
  if (r['precedent'] !== undefined && r['precedent'] !== null) {
    precedent = take(parsePrecedentId(r['precedent'], `${at}/precedent`), errors);
  } else if (r['precedent'] === null) {
    precedent = null;
  }

  const rationale = take(optionalString(r, 'rationale', at), errors);

  const citations: Citation[] = [];
  let hasEvidenceField = false;
  if (r['evidence'] !== undefined && r['evidence'] !== null) {
    hasEvidenceField = true;
    const arr = requireArray(r['evidence'], `${at}/evidence`);
    if (!arr.ok) errors.push(arr.error);
    else {
      arr.value.forEach((item, i) => {
        const c = take(parseCitation(item, `${at}/evidence/${i}`), errors);
        if (c !== undefined) citations.push(c);
      });
    }
  }

  let severity: SeverityOrdinal | undefined;
  if (r['severity'] !== undefined && r['severity'] !== null) {
    severity = take(parseSeverityOrdinal(r['severity'], `${at}/severity`), errors);
  }

  for (const key of Object.keys(r)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
      errors.push({ code: 'strictness', message: `unknown field \`${key}\``, at: `${at}/${key}` });
    }
  }

  // Only an unknown verdict kind stops the walk: without it there is no shape to check
  // against. A missing `assertion` does NOT short-circuit, so one pass still reports every
  // violation-shape problem alongside it.
  if (kind === undefined) {
    return err(errors.length > 0 ? errors : [{ code: 'missing-field', message: 'incomplete verdict', at }]);
  }

  if (isViolationKind(kind)) {
    if (severity === undefined) {
      errors.push({
        code: 'invalid-severity',
        message: `${kind} requires an anchored ordinal severity`,
        at: `${at}/severity`,
        clause: `${SCHEMA}#/allOf/0`,
      });
    }
    if (!isNonEmpty(citations)) {
      errors.push({
        code: 'uncited-violation',
        message: 'no citation, no verdict (ADR-0005, INV-004)',
        at: `${at}/evidence`,
        clause: `${SCHEMA}#/allOf/0`,
      });
    }
    if (rationale === undefined || rationale.length === 0) {
      errors.push({
        code: 'missing-field',
        message: `${kind} requires a rationale`,
        at: `${at}/rationale`,
        clause: `${SCHEMA}#/allOf/0`,
      });
    }
    if (kind === 'regression' && (precedent === undefined || precedent === null)) {
      errors.push({
        code: 'missing-precedent',
        message: 'regression verdicts must cite a PRE-id (spec 03 §7)',
        at: `${at}/precedent`,
        clause: `${SCHEMA}#/allOf/1`,
      });
    }
    if (
      errors.length > 0 ||
      assertion === undefined ||
      severity === undefined ||
      rationale === undefined ||
      !isNonEmpty(citations)
    ) {
      return err(errors);
    }
    const common: ViolationVerdictCommon = {
      assertion,
      severity,
      evidence: citations,
      rationale,
      ...(confidence !== undefined ? { confidence } : {}),
    };
    if (kind === 'regression') {
      return ok({ ...common, verdict: 'regression', precedent: precedent as PrecedentId });
    }
    if (kind === 'drift') {
      return ok({ ...common, verdict: 'drift', ...(precedent !== undefined ? { precedent } : {}) });
    }
    return ok({ ...common, verdict: 'stale-claim', ...(precedent !== undefined ? { precedent } : {}) });
  }

  // aligned | abstain — spec 03 §4: terse, and never carrying a violation payload.
  if (severity !== undefined) {
    errors.push({
      code: 'strictness',
      message: `\`${kind}\` verdicts carry no severity (spec 03 §4)`,
      at: `${at}/severity`,
    });
  }
  if (hasEvidenceField) {
    errors.push({
      code: 'strictness',
      message: `\`${kind}\` verdicts carry no evidence (spec 03 §4)`,
      at: `${at}/evidence`,
    });
  }
  if (kind === 'aligned' && rationale !== undefined) {
    errors.push({
      code: 'strictness',
      message: 'aligned verdicts stay terse: verdict + confidence only (spec 03 §4)',
      at: `${at}/rationale`,
    });
  }
  if (precedent !== undefined && precedent !== null) {
    errors.push({
      code: 'strictness',
      message: `\`${kind}\` verdicts cite no precedent`,
      at: `${at}/precedent`,
    });
  }
  if (errors.length > 0 || assertion === undefined) return err(errors);

  if (kind === 'aligned') {
    return ok({ assertion, verdict: 'aligned', ...(confidence !== undefined ? { confidence } : {}) });
  }
  return ok({
    assertion,
    verdict: 'abstain',
    ...(confidence !== undefined ? { confidence } : {}),
    ...(rationale !== undefined ? { rationale } : {}),
  });
}

export function encodeVerdict(v: Verdict): CanonicalObject {
  return {
    assertion: v.assertion,
    verdict: v.verdict,
    severity: isViolation(v) ? v.severity : undefined,
    confidence: v.confidence,
    evidence: isViolation(v) ? v.evidence.map(formatCitation) : undefined,
    precedent: v.precedent === undefined ? undefined : v.precedent,
    rationale: isViolation(v) ? v.rationale : v.verdict === 'abstain' ? v.rationale : undefined,
  };
}
