// Implements: docs/adr/0003-judge-blindness.md ("verdict and sentencing are separate
// branches") and docs/spec/02-ledger.md §5 (dispersion, computed at firing time only).
//
// THE ONLY MODULE IN THE CODEBASE THAT NAMES AUTHOR IDENTITY OR ACCUMULATED SURPRISE.
//
// Everything here is OPAQUE: `ActorId` is not assignable to `string`, `Surprise` is not
// assignable to `number`. That is the whole point, and it is what a conventional
// branded-string design (`type ActorId = string & {__brand}`) fails at — a branded string IS
// a string, so every string field in an evidence bundle would be a smuggling route. Because
// these are not primitives, there is no string-shaped or number-shaped slot anywhere in the
// system they can occupy.
//
// src/core/index.ts re-exports the TYPES here but none of the VALUES. Reaching `actorId`,
// `revealActor`, `surprise`, `revealSurprise` or `withSentencingWarrant` requires a deep
// import of `../core/sentencing.js` — one greppable line, which is exactly the shape
// INV-003's `enforcement: hybrid` deterministic prescreen wants.

import type { Budget, Precision } from './assertion.js';
import type { BlindCommit } from './change.js';
import type { CommitSha } from './ids.js';
import type { RepoPath } from './paths.js';
import { fail, ok, type Parsed } from './result.js';
import type { SeverityWeight } from './severity.js';
import type { CommitterTime } from './time.js';

/**
 * A REAL runtime symbol, unlike the phantom brand key in src/core/brand.ts. It exists at
 * runtime so `assertBlind` can detect a sentencing value inside an `any`-typed or
 * deserialized payload — the half of INV-003 that types cannot cover.
 */
export const SENTENCING_TAG: unique symbol = Symbol.for('gwtp.sentencing');

/**
 * An OPEN-ENDED brand, not a closed list: any future value type declared as
 * `SentencingOnly<'...'>` is automatically rejected by `Blind<T>` with no edit to
 * blindness.ts. The runtime payload key is not named in the type, so reading it requires a
 * cast — and the sanctioned readers require a warrant.
 */
export interface SentencingOnly<Tag extends string> {
  readonly [SENTENCING_TAG]: Tag;
}

/**
 * The crux of INV-003 clause 1. Because `ActorId` is NOT a subtype of `string`, it cannot be
 * widened into any string field anywhere in the contract — not `Hunk.path`, not
 * `charterExcerpt`, not a rationale.
 */
export type ActorId = SentencingOnly<'actor'>;

/**
 * The crux of INV-003 clause 2. Accumulated surprise is not a number, so "the meter reads
 * 2.7 of 3.0" cannot be assigned into any numeric field of any evidence bundle. `ActorId`
 * and `Surprise` are mutually non-assignable because their tags differ.
 */
export type Surprise = SentencingOnly<'surprise'>;

/**
 * The payload lives in a module-private WeakMap, NOT on the handle. A string-keyed `payload`
 * property would be readable with no warrant at all — `JSON.stringify(box)` would emit the
 * author's email, `Object.values(box)` would return it, and a spread would copy it out (the
 * audit's sentencing.ts:62 probe). Keyed off the frozen handle here, the payload is invisible to
 * `JSON.stringify`, `Object.values`, spread and `structuredClone`: the only way back to it is
 * `unbox`, which every declassifier already routes through under a warrant. This is the runtime
 * half of INV-003 that the type system cannot cover (a serialized boundary erases types).
 */
const PAYLOADS = new WeakMap<object, unknown>();

function box<Tag extends string, V>(tag: Tag, payload: V): SentencingOnly<Tag> {
  const handle = Object.freeze({ [SENTENCING_TAG]: tag }) as unknown as SentencingOnly<Tag>;
  PAYLOADS.set(handle as unknown as object, payload);
  return handle;
}

function unbox<Tag extends string, V>(v: SentencingOnly<Tag>): V {
  return PAYLOADS.get(v as unknown as object) as V;
}

// ---------------------------------------------------------------------------
// The warrant
// ---------------------------------------------------------------------------

export const SENTENCING_WARRANT: unique symbol = Symbol.for('gwtp.sentencing.warrant');

/**
 * Names spec 03 §2's own distinction. Unwrapping identity or the meter requires holding one,
 * so every leak site is a CALL WITH AN EXTRA ARGUMENT rather than a plain property read.
 */
export interface SentencingWarrant {
  readonly [SENTENCING_WARRANT]: 'warrant';
}

const WARRANT = Object.freeze({ [SENTENCING_WARRANT]: 'warrant' }) as SentencingWarrant;

/**
 * The only issuer. Its legitimate callers are dispersion (src/core/dispersion.ts, at firing
 * time), proposal rendering (src/adapters/github) and `gwtp ledger status` (src/cli).
 * A call from src/judge/** or src/evidence/** is the reportable INV-003 breach.
 */
export function withSentencingWarrant<R>(fn: (warrant: SentencingWarrant) => R): R {
  return fn(WARRANT);
}

// ---------------------------------------------------------------------------
// Author identity (ADR-0003 clause 1)
// ---------------------------------------------------------------------------

/** Wraps a git author/committer identity. Called only by the git adapter. */
export function actorId(handle: string): ActorId {
  return box('actor', handle);
}

/**
 * Used in exactly one place in the system: grouping contributors for author entropy at
 * firing time (spec 02 §5).
 */
export function revealActor(id: ActorId, _warrant: SentencingWarrant): string {
  return unbox<'actor', string>(id);
}

/** Stable grouping key without revealing the handle. Safe for entropy bucketing. */
export function actorGroupKey(id: ActorId): string {
  return `actor:${unbox<'actor', string>(id)}`;
}

/**
 * The author-bearing commit view. Structurally NOT assignable to `BlindCommit` (its
 * `author: ActorId` collides with `author?: never`), and rejected outright by `Blind<T>` on
 * two independent grounds — the `ActorId` value and the `author` key name.
 */
export interface SightedCommit {
  readonly sha: CommitSha;
  readonly committedAt: CommitterTime;
  readonly paths: readonly RepoPath[];
  readonly author: ActorId;
  readonly committer: ActorId;
}

/**
 * The one-directional door, deliberately placed on the SIGHTED side of the boundary. There
 * is no inverse: recovering identity means calling `SightedCommitPort` with a sha, which
 * means importing this module, which is the checkable event.
 */
export function blindCommit(c: SightedCommit): BlindCommit {
  return { sha: c.sha, committedAt: c.committedAt, paths: c.paths };
}

/**
 * Forge-agnostic port (INV-005); the git CLI adapter implements it. Note the consequence:
 * authorship is never persisted in the ledger, it is re-derived from git at firing time.
 */
export interface SightedCommitPort {
  lookup(shas: readonly CommitSha[]): Promise<ReadonlyMap<CommitSha, SightedCommit>>;
}

// ---------------------------------------------------------------------------
// Accumulated surprise (ADR-0003 clause 2)
// ---------------------------------------------------------------------------

/**
 * The only constructor. Total and pure: non-finite input and negative input both collapse to
 * 0, because an accumulator can never hold less than nothing and `decay` never amplifies.
 */
export function surprise(value: number): Surprise {
  return box('surprise', Number.isFinite(value) && value > 0 ? value : 0);
}

export const ZERO_SURPRISE: Surprise = surprise(0);

export function parseSurprise(raw: unknown, at?: string): Parsed<Surprise> {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fail('wrong-type', 'surprise must be a finite number', at);
  }
  if (raw < 0) return fail('wrong-type', `surprise must be >= 0, got ${raw}`, at);
  return ok(surprise(raw));
}

/** Untaints for display and serialization only. Grep this name to audit every leak site. */
export function revealSurprise(s: Surprise, _warrant: SentencingWarrant): number {
  return unbox<'surprise', number>(s);
}

function raw(s: Surprise): number {
  return unbox<'surprise', number>(s);
}

export function addSurprise(a: Surprise, b: Surprise): Surprise {
  return surprise(raw(a) + raw(b));
}

/** The decay step: `scaleSurprise(A, decayFactor(dt, halfLife))`. */
export function scaleSurprise(s: Surprise, factor: number): Surprise {
  return surprise(raw(s) * factor);
}

/**
 * The increment term of spec 02 §4: `precision_at · severity`. Together with `addSurprise`
 * and `scaleSurprise`, SEED-02 can implement the ENTIRE leaky integrator and firing detector
 * without ever holding a warrant.
 */
export function surpriseFrom(precisionAt: Precision | number, severity: SeverityWeight): Surprise {
  return surprise((precisionAt as number) * severity);
}

export function compareSurprise(a: Surprise, b: Surprise): -1 | 0 | 1 {
  const d = raw(a) - raw(b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/** `A >= budget`, the firing test, answered as a boolean so the caller never needs the number. */
export function surpriseReachesBudget(s: Surprise, threshold: Budget): boolean {
  return raw(s) >= (threshold as number);
}

/** The hysteresis re-arm test (spec 02 §6, "below ~50% of budget"). */
export function surpriseBelowFraction(
  s: Surprise,
  threshold: Budget,
  fraction: number,
): boolean {
  return raw(s) < (threshold as number) * fraction;
}

/** True when the value carries the runtime sentencing tag. Used by the blindness backstop. */
export function isSentencingValue(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    Object.prototype.hasOwnProperty.call(v, SENTENCING_TAG)
  );
}
