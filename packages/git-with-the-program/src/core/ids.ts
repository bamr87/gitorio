// Implements: docs/spec/01-core-memory.md §3 (the assertion atom: stable ids), §5 (precedent
// ids), §7 (manifest / seated judges), and docs/spec/02-ledger.md §1-2 (content-addressed
// events). Patterns are copied VERBATIM from schemas/assertion.schema.json,
// schemas/precedent.schema.json and schemas/event.schema.json so the mirror is greppable.
//
// Everything surprise can accumulate against, and everything the ledger addresses content by.

import type { Brand } from './brand.js';
import { fail, ok, type Parsed } from './result.js';

// ---------------------------------------------------------------------------
// Content references
// ---------------------------------------------------------------------------

/** Mirrors gwtp/event.schema.json#/properties/event and #/properties/judge/properties/prompt. */
export const SHA256_REF_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** `sha256:<64 lowercase hex>` — the single content-reference format in GWTP. */
export type Sha256Ref = Brand<`sha256:${string}`, 'Sha256Ref'>;

/** A Sha256Ref that is specifically an event's content hash / filename / idempotency key. */
export type EventId = Brand<Sha256Ref, 'EventId'>;

/** sha256 of a file under prompts/. Part of judge identity (spec 01 §7, spec 03 §6). */
export type PromptHash = Brand<Sha256Ref, 'PromptHash'>;

/**
 * Blob ref to full rationale text, retained out of the hot path (spec 02 §2).
 * gwtp/event.schema.json types `rationale` as a bare string whose description says
 * "Blob ref (sha256:…)" but carries no `pattern`; the parser enforces what the
 * description states. See docs/spec/OPEN-QUESTIONS.md Q-05.
 */
export type RationaleRef = Brand<Sha256Ref, 'RationaleRef'>;

/** Order-independent hash of the hunks a judge was shown. Half of the verdict cache key. */
export type HunkHash = Brand<Sha256Ref, 'HunkHash'>;

/** Hash over `{kind, id, prompt}`. Changing either field is seating a new judge. */
export type JudgeHash = Brand<Sha256Ref, 'JudgeHash'>;

/** spec 03 §1: `assertion-id + hunk-hash + judge-hash`. */
export type VerdictCacheKey = Brand<string, 'VerdictCacheKey'>;

export function parseSha256Ref(raw: unknown, at?: string): Parsed<Sha256Ref> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string sha256 ref', at);
  if (!SHA256_REF_PATTERN.test(raw)) {
    return fail('invalid-id', `expected ${SHA256_REF_PATTERN.source}, got ${JSON.stringify(raw)}`, at);
  }
  return ok(raw as Sha256Ref);
}

export function sha256RefFromHex(hex: string, at?: string): Parsed<Sha256Ref> {
  return parseSha256Ref(`sha256:${hex}`, at);
}

/** Strips the `sha256:` prefix. Used for filenames and cache-key segments. */
export function sha256RefHex(ref: Sha256Ref): string {
  return ref.slice('sha256:'.length);
}

export function parseEventId(raw: unknown, at?: string): Parsed<EventId> {
  const r = parseSha256Ref(raw, at);
  return r.ok ? ok(r.value as EventId) : r;
}

export function parsePromptHash(raw: unknown, at?: string): Parsed<PromptHash> {
  const r = parseSha256Ref(raw, at);
  return r.ok ? ok(r.value as PromptHash) : r;
}

export function parseRationaleRef(raw: unknown, at?: string): Parsed<RationaleRef> {
  const r = parseSha256Ref(raw, at);
  return r.ok ? ok(r.value as RationaleRef) : r;
}

// ---------------------------------------------------------------------------
// Assertion / precedent ids
// ---------------------------------------------------------------------------

/** Mirrors gwtp/assertion.schema.json#/properties/id VERBATIM. */
export const ASSERTION_ID_PATTERN = /^(INV|CAND)-[0-9]{3,}$/;

/** Mirrors gwtp/precedent.schema.json#/properties/id VERBATIM. */
export const PRECEDENT_ID_PATTERN = /^PRE-[0-9]{3,}$/;

/**
 * The supertype. `InvariantId` and `CandidateId` are subtypes via stacked brand tags,
 * which is what lets `CandidateAssertion` pin `status` to the literal `'inferred'`
 * (schemas/assertion.schema.json#/allOf/0, spec 04 §4) at compile time.
 */
export type AssertionId = Brand<string, 'AssertionId'>;
export type InvariantId = Brand<string, 'AssertionId' | 'InvariantId'>;
export type CandidateId = Brand<string, 'AssertionId' | 'CandidateId'>;

export type PrecedentId = Brand<string, 'PrecedentId'>;

/**
 * Identifies a scope.yaml claim. Obsolescence sweeps accumulate against a claim rather
 * than an assertion (spec 02 §7), and `event.assertion` / `verdict.assertion` are
 * unconstrained strings in the schemas — exactly wide enough to carry one.
 */
export type ScopeClaimKey = Brand<string, 'ScopeClaimKey'>;

/**
 * What surprise accumulates against. Least-committal reading of the fact that
 * `assertion.id` is patterned while `event.assertion` is not.
 * See docs/spec/OPEN-QUESTIONS.md Q-04.
 */
export type AccumulatorKey = AssertionId | ScopeClaimKey;

export function parseAssertionId(raw: unknown, at?: string): Parsed<AssertionId> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string assertion id', at);
  if (!ASSERTION_ID_PATTERN.test(raw)) {
    return fail('invalid-id', `expected ${ASSERTION_ID_PATTERN.source}, got ${JSON.stringify(raw)}`, at);
  }
  return ok(raw as AssertionId);
}

export function parseInvariantId(raw: unknown, at?: string): Parsed<InvariantId> {
  const r = parseAssertionId(raw, at);
  if (!r.ok) return r;
  if (!isInvariantId(r.value)) return fail('invalid-id', 'expected an INV-* id', at);
  return ok(r.value);
}

export function parseCandidateId(raw: unknown, at?: string): Parsed<CandidateId> {
  const r = parseAssertionId(raw, at);
  if (!r.ok) return r;
  if (!isCandidateId(r.value)) return fail('invalid-id', 'expected a CAND-* id', at);
  return ok(r.value);
}

/** CAND-* ids may only carry `status: inferred` (schema allOf/0; spec 04 §4). */
export function isCandidateId(id: AssertionId): id is CandidateId {
  return id.startsWith('CAND-');
}

export function isInvariantId(id: AssertionId): id is InvariantId {
  return id.startsWith('INV-');
}

export function parsePrecedentId(raw: unknown, at?: string): Parsed<PrecedentId> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string precedent id', at);
  if (!PRECEDENT_ID_PATTERN.test(raw)) {
    return fail('invalid-id', `expected ${PRECEDENT_ID_PATTERN.source}, got ${JSON.stringify(raw)}`, at);
  }
  return ok(raw as PrecedentId);
}

/** Accepts an AssertionId; otherwise brands any non-empty whitespace-free string as a claim key. */
export function parseAccumulatorKey(raw: unknown, at?: string): Parsed<AccumulatorKey> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string accumulator key', at);
  if (ASSERTION_ID_PATTERN.test(raw)) return ok(raw as AssertionId);
  if (raw.length === 0 || /\s/.test(raw)) {
    return fail('invalid-id', 'accumulator key must be non-empty and whitespace-free', at);
  }
  return ok(raw as ScopeClaimKey);
}

export function isAssertionKey(key: AccumulatorKey): key is AssertionId {
  return ASSERTION_ID_PATTERN.test(key);
}

// ---------------------------------------------------------------------------
// Epochs, trajectory, judges, commits
// ---------------------------------------------------------------------------

/**
 * `.program/manifest.yaml` and `.program/scope.yaml` spell epochs `e0`; spec 04 §3 uses
 * `e2..e6`. No schema governs the shape. Least-committal: `^e[0-9]+$`, plus an ordinal
 * accessor because spec 04 §3's recency asymmetry needs epochs ORDERED.
 */
export const EPOCH_ID_PATTERN = /^e([0-9]+)$/;
export type EpochId = Brand<string, 'EpochId'>;

export function parseEpochId(raw: unknown, at?: string): Parsed<EpochId> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string epoch id', at);
  if (!EPOCH_ID_PATTERN.test(raw)) {
    return fail('invalid-id', `expected ${EPOCH_ID_PATTERN.source}, got ${JSON.stringify(raw)}`, at);
  }
  return ok(raw as EpochId);
}

/** e6 -> 6. */
export function epochOrdinal(id: EpochId): number {
  const m = EPOCH_ID_PATTERN.exec(id);
  return m === null ? Number.NaN : Number.parseInt(m[1] as string, 10);
}

/** `.program/trajectory.yaml` uses `TRJ-001`. Unschema'd; validated loosely on purpose. */
export const TRAJECTORY_ID_PATTERN = /^TRJ-[0-9]{3,}$/;
export type TrajectoryId = Brand<string, 'TrajectoryId'>;

export function parseTrajectoryId(raw: unknown, at?: string): Parsed<TrajectoryId> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string trajectory id', at);
  if (!TRAJECTORY_ID_PATTERN.test(raw)) {
    return fail('invalid-id', `expected ${TRAJECTORY_ID_PATTERN.source}, got ${JSON.stringify(raw)}`, at);
  }
  return ok(raw as TrajectoryId);
}

/** Seat name (`invariant-judge`) or a model id for `kind: model`. See OPEN-QUESTIONS Q-15. */
export type JudgeId = Brand<string, 'JudgeId'>;

export function parseJudgeId(raw: unknown, at?: string): Parsed<JudgeId> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string judge id', at);
  if (raw.length === 0 || /\s/.test(raw)) {
    return fail('invalid-id', 'judge id must be non-empty and whitespace-free', at);
  }
  return ok(raw as JudgeId);
}

/**
 * gwtp/event.schema.json leaves `subject.commit` an unconstrained string and spec 02 §2's
 * example is the 6-char `9f2c1d`, so imposing 7 or 40 would reject the spec's own record.
 */
export const COMMIT_SHA_PATTERN = /^[0-9a-f]{4,40}$/;
export type CommitSha = Brand<string, 'CommitSha'>;

export function parseCommitSha(raw: unknown, at?: string): Parsed<CommitSha> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected a string commit sha', at);
  if (!COMMIT_SHA_PATTERN.test(raw)) {
    return fail('invalid-id', `expected ${COMMIT_SHA_PATTERN.source}, got ${JSON.stringify(raw)}`, at);
  }
  return ok(raw as CommitSha);
}

/** gwtp/event.schema.json types `subject.pr` as `integer`; TypeScript has no integer type. */
export type PullRequestNumber = Brand<number, 'PullRequestNumber'>;

export function parsePullRequestNumber(raw: unknown, at?: string): Parsed<PullRequestNumber> {
  if (typeof raw !== 'number') return fail('wrong-type', 'expected a number PR reference', at);
  if (!Number.isInteger(raw) || raw <= 0) {
    return fail('invalid-id', `PR number must be a positive integer, got ${raw}`, at);
  }
  return ok(raw as PullRequestNumber);
}

/**
 * "No assertion without provenance" (spec 01 §4.1): `pr#41`, `adr-0003`, `commit abc123`.
 * Deliberately an alias and NOT a brand: schemas/assertion.schema.json puts no shape on
 * provenance entries, so a brand here would be fake safety.
 */
export type ProvenanceRef = string;
