// Implements: docs/spec/01-core-memory.md §4 (the two non-negotiable field rules) and
// docs/spec/03-judge.md §4 (the output contract) — every contract boundary in src/core
// reports failure as DATA, never as an exception. Two reasons this is load-bearing:
// `gwtp validate` must report every problem in a file in one pass, and the ledger fold
// (docs/spec/02-ledger.md §4) must stay pure and property-testable.

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

/**
 * A closed union so tests assert on codes, not on message strings. SEED-03's contract
 * tests ("uncited violation rejected", "regression without PRE-id rejected", "severity
 * outside the four anchors rejected") map onto specific codes here.
 *
 * `strictness` marks the three places the engine is deliberately tighter than the JSON
 * Schema (see docs/spec/OPEN-QUESTIONS.md); the conformance test whitelists exactly those.
 */
export type ContractErrorCode =
  | 'wrong-type'
  | 'missing-field'
  | 'invalid-id'
  | 'invalid-path'
  | 'invalid-glob'
  | 'invalid-duration'
  | 'invalid-timestamp'
  | 'invalid-precision'
  | 'invalid-budget'
  | 'invalid-confidence'
  | 'invalid-severity'
  | 'invalid-verdict'
  | 'invalid-subject'
  | 'invalid-citation'
  | 'invalid-enum'
  | 'uncited-violation'
  | 'missing-precedent'
  | 'non-canonical-value'
  | 'hash-mismatch'
  | 'unresolved-locus'
  | 'blindness-breach'
  | 'strictness';

export interface ContractError {
  readonly code: ContractErrorCode;
  readonly message: string;
  /** RFC 6901-shaped JSON pointer into the offending document, e.g. `/scope/0`. */
  readonly at?: string;
  /** The binding schema clause when one exists, e.g. `gwtp/verdict.schema.json#/allOf/1`. */
  readonly clause?: string;
  readonly cause?: ContractError;
}

/** Scalar parsers: one value, one reason it failed. */
export type Parsed<T> = Result<T, ContractError>;

/** Document decoders: accumulate every field failure rather than short-circuiting. */
export type Decoded<T> = Result<T, readonly ContractError[]>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

export function contractError(
  code: ContractErrorCode,
  message: string,
  at?: string,
  clause?: string,
): ContractError {
  const e: { -readonly [K in keyof ContractError]?: ContractError[K] } = { code, message };
  if (at !== undefined) e.at = at;
  if (clause !== undefined) e.clause = clause;
  return e as ContractError;
}

/** Shorthand for the overwhelmingly common `err(contractError(...))`. */
export function fail(
  code: ContractErrorCode,
  message: string,
  at?: string,
  clause?: string,
): Err<ContractError> {
  return err(contractError(code, message, at, clause));
}

export function failMany(
  code: ContractErrorCode,
  message: string,
  at?: string,
  clause?: string,
): Err<readonly ContractError[]> {
  return err([contractError(code, message, at, clause)]);
}

export function mapResult<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

/**
 * All-or-nothing traverse that ACCUMULATES every error rather than short-circuiting,
 * so a single `gwtp validate` pass reports every problem in a file.
 */
export function collectResults<T>(results: readonly Decoded<T>[]): Decoded<readonly T[]> {
  const values: T[] = [];
  const errors: ContractError[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(...r.error);
  }
  return errors.length > 0 ? err(errors) : ok(values);
}

/** Lifts a scalar parse into the accumulating world. */
export function widen<T>(r: Parsed<T>): Decoded<T> {
  return r.ok ? r : err([r.error]);
}

export class ContractViolationError extends Error {
  readonly errors: readonly ContractError[];

  constructor(errors: readonly ContractError[]) {
    const head = errors[0];
    super(
      head === undefined
        ? 'contract violation'
        : `${head.code}${head.at === undefined ? '' : ` at ${head.at}`}: ${head.message}`,
    );
    this.name = 'ContractViolationError';
    this.errors = errors;
  }
}

/** For call sites that have already validated. Throws `ContractViolationError` otherwise. */
export function unwrap<T>(r: Result<T, ContractError | readonly ContractError[]>): T {
  if (r.ok) return r.value;
  throw new ContractViolationError(Array.isArray(r.error) ? r.error : [r.error as ContractError]);
}
