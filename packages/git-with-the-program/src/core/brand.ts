// Implements: docs/adr/0006-reference-stack.md ("Schemas in schemas/ are the contract either way").
// The nominal-typing kit and shared type utilities for the whole contract layer.
// No spec concept of its own: this is the mechanism that lets a JSON Schema
// constraint survive the crossing from `unknown` into the engine.

declare const BRAND: unique symbol;

/**
 * Composable nominal brand.
 *
 * Brands stack by intersection because the branded property is a *record of tags*
 * rather than a colliding string literal: `Brand<Brand<string,'Sha256Ref'>,'EventId'>`
 * is assignable to `Sha256Ref`, while a bare `Sha256Ref` is not assignable to `EventId`.
 * The naive `T & { __brand: B }` collapses to `never` when two brands intersect.
 *
 * A branded primitive is still assignable to its base primitive. That is deliberate for
 * ids and knobs (they are not secrets) and deliberately NOT used for author identity or
 * accumulated surprise — see src/core/sentencing.ts for the opaque variety.
 */
export type Brand<T, B extends string> = T & {
  readonly [BRAND]: { readonly [K in B]: true };
};

/** JSON Schema `minItems: 1`, as a type-level fact. */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export function isNonEmpty<T>(xs: readonly T[]): xs is NonEmptyReadonlyArray<T> {
  return xs.length > 0;
}

/**
 * JSON Schema `anyOf: [{required:[a]},{required:[b]},{required:[c]}]` as a type.
 *
 * Used for `event.subject` (commit | pr | path), which permits COMBINATIONS — spec 02 §2's
 * own example record carries both `commit` and `pr`. A three-arm discriminated union would
 * have forbidden that; this does not.
 */
export type AtLeastOne<T, K extends keyof T = keyof T> = Omit<T, K> &
  { [P in K]-?: Required<Pick<T, P>> & Partial<Pick<T, Exclude<K, P>>> }[K];

export type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/**
 * Runtime companion to INV-002 (ledger events are never mutated). Applied by `sealEvent`
 * and `sealEvidence` so a value cannot be mutated even through an `any`-typed alias.
 *
 * Cycles are handled by a visited set, NOT by an `Object.isFrozen` early exit: a short-circuit on
 * "already frozen" would return a SHALLOW-frozen object with its whole subtree still mutable (the
 * audit's brand.ts:49 probe), which is exactly the hole INV-002 must not have. Every reachable
 * object is frozen exactly once; the `seen` set is what keeps a cyclic structure from recursing
 * forever, so freezing an already-frozen node is safe rather than a reason to stop.
 */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    Object.freeze(v);
    for (const key of Object.getOwnPropertyNames(v)) {
      walk((v as Record<string, unknown>)[key]);
    }
  };
  walk(value);
  return value;
}
