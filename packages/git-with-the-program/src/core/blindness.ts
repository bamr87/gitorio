// Implements: docs/adr/0003-judge-blindness.md and docs/spec/03-judge.md §2 ("Enforced
// structurally: the evidence assembler simply cannot read authorship fields or
// accumulators/"). INV-003, made a COMPILE ERROR rather than a code-review convention.
//
// `Blind<T>` is a recursive conditional type that rewrites any sentencing-only value, any
// forbidden field NAME, and any callable into a nominal, uninhabited error type. Used as a
// constraint at the one chokepoint (`sealEvidence`), a bundle carrying one fails to compile
// and the compiler error names the offending property.
//
// Plus the runtime backstop, because a type-level check over data that arrived as `unknown`
// from YAML or a forge API proves nothing.

import type { AccumulatorState, ContributingEvent, Firing } from './accumulator.js';
import type { Primitive } from './brand.js';
import type { DispersionStats } from './dispersion.js';
import type { LedgerEvent } from './event.js';
import { SENTENCING_TAG, type SentencingOnly } from './sentencing.js';

export const BLINDNESS_VIOLATION: unique symbol = Symbol.for('gwtp.blindness.violation');

/**
 * Nominal and uninhabitable in practice: nothing in the codebase constructs this symbol key.
 * `Blind<T>` substitutes it at the exact offending property, so the compiler error names the
 * leaking field and carries the reason string in the type.
 */
export interface BlindnessViolation<Why extends string = string> {
  readonly [BLINDNESS_VIOLATION]: Why;
}

/**
 * Defence in depth, explicitly NOT the primary mechanism. The value-type arm below catches
 * identity and the meter regardless of what they are called; this arm catches the regression
 * where someone reintroduces them as bare strings or numbers under the obvious names.
 */
export type ForbiddenKey =
  | 'author'
  | 'authors'
  | 'authorId'
  | 'author_id'
  | 'authorEmail'
  | 'author_email'
  | 'committer'
  | 'committers'
  | 'committerEmail'
  | 'committer_email'
  | 'signed_off_by'
  | 'blame'
  | 'accumulator'
  | 'accumulators'
  | 'accumulated'
  | 'surprise'
  | 'dispersion'
  | 'dispersion_snapshot'
  | 'author_entropy'
  | 'compliance_ratio'
  | 'budget_remaining'
  | 'armed'
  | 'last_fired'
  | 'priorVerdicts'
  | 'history';

/** Runtime twin of `ForbiddenKey`, kept in lockstep by `satisfies` plus an exhaustiveness test. */
export const FORBIDDEN_KEYS = [
  'author',
  'authors',
  'authorId',
  'author_id',
  'authorEmail',
  'author_email',
  'committer',
  'committers',
  'committerEmail',
  'committer_email',
  'signed_off_by',
  'blame',
  'accumulator',
  'accumulators',
  'accumulated',
  'surprise',
  'dispersion',
  'dispersion_snapshot',
  'author_entropy',
  'compliance_ratio',
  'budget_remaining',
  'armed',
  'last_fired',
  'priorVerdicts',
  'history',
] as const satisfies readonly ForbiddenKey[];

/**
 * `SentencingOnly<string>` is the open-ended arm: it covers `ActorId`, `Surprise`, and
 * anything declared sentencing-only in future with no edit to this file.
 *
 * The named types are belt-and-braces for CASE HISTORY. spec 03 §2 names two blindness rules,
 * but prompts/invariant-judge.md tells the magistrate it is given "no history of prior
 * rulings" — a judge that can see prior verdicts on this assertion autocorrelates exactly as
 * badly as one that can see the meter. `Precedent` is deliberately ABSENT: settled case law
 * is normative and the regression judge is required to read it (spec 03 §7). Case law yes,
 * running case history no. See docs/spec/OPEN-QUESTIONS.md Q-20.
 */
export type SentencingOnlyValue =
  | SentencingOnly<string>
  | LedgerEvent
  | AccumulatorState
  | ContributingEvent
  | Firing
  | DispersionStats;

type Depth = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type Prev = readonly [never, 0, 1, 2, 3, 4, 5, 6, 7];

/**
 * Clause ORDER is load-bearing:
 *  1. depth exhaustion FAILS CLOSED — an unprovable type is treated as leaking, which also
 *     forces judge-facing types to stay shallow plain data;
 *  2. the `never` guard, so a `?: never` poison pill does not derail the walk;
 *  3. sentencing values BEFORE the primitive short-circuit (a branded primitive is
 *     `string & {...}`, so `T extends string` would otherwise swallow it);
 *  4. callables, since a function in a bundle can close over state no structural walk sees;
 *  5. arrays, then a homomorphic mapped type that preserves `readonly` and optionality.
 */
type BlindAt<T, D extends Depth> = [D] extends [never]
  ? BlindnessViolation<'INV-003: type too deep to prove blind'>
  : [T] extends [never]
    ? T
    : T extends SentencingOnlyValue
      ? BlindnessViolation<'INV-003: a sentencing-only value reached the verdict branch'>
      : T extends Primitive
        ? T
        : T extends (...args: never[]) => unknown
          ? BlindnessViolation<'INV-003: a callable in an evidence bundle can close over sentencing state'>
          : T extends readonly (infer U)[]
            ? readonly BlindAt<U, Prev[D]>[]
            : {
                readonly [K in keyof T]: K extends ForbiddenKey
                  ? BlindnessViolation<'INV-003: forbidden field name in the verdict branch'>
                  : BlindAt<T[K], Prev[D]>;
              };

export type Blind<T> = BlindAt<T, 8>;

/**
 * For the SEED-03 acceptance test "attempting to feed author or accumulator data to the
 * assembler fails to compile", written as `expectTypeOf` assertions — no extra dependency.
 * The COUNTER-test matters as much as the proof: `IsBlind<AccumulatorState>` must be `false`,
 * or the scanner is passing vacuously.
 */
export type IsBlind<T> = [T] extends [Blind<T>] ? true : false;

/**
 * Type-level assertion. `type _ = Proof<IsBlind<EvidenceBundle>>` is a compile error the
 * instant EvidenceBundle stops being blind. Emits no JavaScript.
 */
export type Proof<T extends true> = T;

export class BlindnessBreach extends Error {
  readonly at: string;
  readonly detail: string;

  constructor(at: string, detail: string) {
    super(`INV-003 blindness breach at ${at === '' ? '<root>' : at}: ${detail}`);
    this.name = 'BlindnessBreach';
    this.at = at;
    this.detail = detail;
  }
}

const FORBIDDEN_KEY_SET = new Set<string>(FORBIDDEN_KEYS);

/**
 * The runtime backstop, called by `sealEvidence`. Walks the value looking for the real
 * `SENTENCING_TAG` symbol (present on every `ActorId` and `Surprise`), for forbidden property
 * names, and for functions. Covers bundles reconstituted from a cache, a subprocess, or
 * parsed YAML, where the types guaranteed nothing.
 *
 * Honest limitation: it cannot see identity already flattened into free text. This is a
 * SECOND line, not the line. See docs/spec/OPEN-QUESTIONS.md Q-09.
 */
export function assertBlind(value: unknown, at = '', seen = new WeakSet<object>()): void {
  if (typeof value === 'function') {
    throw new BlindnessBreach(at, 'a callable can close over sentencing state');
  }
  if (typeof value !== 'object' || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Object.prototype.hasOwnProperty.call(value, SENTENCING_TAG)) {
    throw new BlindnessBreach(at, 'a sentencing-only value (author identity or the meter)');
  }
  for (const sym of Object.getOwnPropertySymbols(value)) {
    if (sym === SENTENCING_TAG) {
      throw new BlindnessBreach(at, 'a sentencing-only value (author identity or the meter)');
    }
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => assertBlind(item, `${at}/${i}`, seen));
    return;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_SET.has(key)) {
      throw new BlindnessBreach(`${at}/${key}`, `forbidden field name \`${key}\``);
    }
    assertBlind(item, `${at}/${key}`, seen);
  }
}
