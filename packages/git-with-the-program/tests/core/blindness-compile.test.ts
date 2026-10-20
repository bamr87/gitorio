// Implements the COMPILE-TIME limb of SEED-03's acceptance check: "attempting to feed author
// or accumulator data to the assembler fails to compile". docs/adr/0003-judge-blindness.md,
// docs/spec/03-judge.md §2, INV-003.
//
// HOW THIS FILE WORKS, AND WHY IT IS A TEST RATHER THAN A COMMENT
//
// Every leak below is marked `@ts-expect-error`. Under `strict`, TypeScript fails the build
// when a `@ts-expect-error` directive sits on a line that DOES compile. So:
//
//   - blindness intact  -> the line errors  -> the directive is used  -> `npm run typecheck` passes
//   - blindness broken  -> the line compiles -> the directive is unused -> TYPECHECK FAILS
//
// The invariant is therefore enforced by the compiler on every build, not by a reviewer. The
// leaks are inside a function that is never called, so nothing here runs.

import { describe, expect, it } from 'vitest';

// ── The BARREL route (INV-003, the leak the type system cannot see) ───────────────────────
//
// `Blind<T>` stops a `Surprise` from entering an evidence bundle. It cannot stop a plain
// `number` that a declassifier already unwrapped — by then the value is just a number, and
// every numeric field will take it. So the three declassifiers are withheld from the barrel,
// and the four `@ts-expect-error`s below are the compile-time proof that they still are. Each
// one is `error TS2305: has no exported member` today; the day any of them starts resolving,
// its directive goes unused and `npm run typecheck` fails.
//
// The runtime twin is tests/core/barrel-surface.test.ts (the export surface as data); the
// static twin over src/judge/** and src/evidence/** is scripts/check-inv003.ts.

// @ts-expect-error INV-003: the barrel does not re-export the meter declassifier
import { toAccumulatorSnapshot as _toAccumulatorSnapshot } from '../../src/core/index.js';
// @ts-expect-error INV-003: the barrel does not re-export the untainted increment term
import { rawSurprise as _rawSurprise } from '../../src/core/index.js';
// @ts-expect-error INV-003: the barrel does not re-export the dispersion declassifier
import { computeDispersion as _computeDispersion } from '../../src/core/index.js';
// @ts-expect-error INV-003: the barrel does not re-export the dispersion-snapshot declassifier
import { toDispersionSnapshot as _toDispersionSnapshot } from '../../src/core/index.js';
// @ts-expect-error INV-003: the barrel does not re-export the warrant issuer
import { withSentencingWarrant as _withSentencingWarrant } from '../../src/core/index.js';

import {
  rawSurprise,
  toAccumulatorSnapshot,
  type AccumulatorState,
} from '../../src/core/accumulator.js';
import type { BlindCommit, Hunk } from '../../src/core/change.js';
import {
  computeDispersion,
  toDispersionSnapshot,
  type DispersionInput,
  type DispersionStats,
} from '../../src/core/dispersion.js';
import type { LedgerEvent } from '../../src/core/event.js';
import { sealEvidence, type EvidenceBundleInput } from '../../src/core/evidence.js';
import { parseAssertionId } from '../../src/core/ids.js';
import { parsePathGlob } from '../../src/core/paths.js';
import { unwrap } from '../../src/core/result.js';
import { actorId, surprise, type ActorId, type SightedCommit } from '../../src/core/sentencing.js';

const CLEAN: EvidenceBundleInput = {
  assertion: {
    id: unwrap(parseAssertionId('INV-005')),
    statement: 'Engine core imports no forge-specific APIs; GitHub access lives in adapters/',
    class: 'dependency',
    scope: [unwrap(parsePathGlob('src/core/**'))],
  },
  charterExcerpt: 'The engine core stays forge-agnostic.',
  hunks: [],
  ring: 'hunk',
  precedent: null,
};

/** Never invoked. Its only job is to be type-checked. */
function leaksThatMustNotCompile(sighted: SightedCommit): void {
  // --- ADR-0003 clause 1: the judge never sees the author ---------------------------------

  // Type 'ActorId' is not assignable to type
  // 'ActorId & BlindnessViolation<"INV-003: forbidden field name in the verdict branch">'
  // @ts-expect-error INV-003: author identity may not reach a judge
  sealEvidence({ ...CLEAN, author: actorId('amr') });

  // Caught by the VALUE arm even under an innocuous key name — this is the case a
  // branded-string design would have let straight through.
  // @ts-expect-error INV-003: author identity may not reach a judge
  sealEvidence({ ...CLEAN, reviewer: actorId('amr') });

  // Nested one level down, inside the hunk list.
  // @ts-expect-error INV-003: author identity may not reach a judge, at any depth
  sealEvidence({ ...CLEAN, hunks: [] as (Hunk & { committer: ActorId })[] });

  // Caught by the KEY arm even when the value is a bare string.
  // @ts-expect-error INV-003: forbidden field name in the verdict branch
  sealEvidence({ ...CLEAN, author_email: 'amr@example.com' });

  // --- ADR-0003 clause 2: the judge never sees the accumulator ----------------------------

  // @ts-expect-error INV-003: accumulated surprise may not reach a judge
  sealEvidence({ ...CLEAN, meter: surprise(2.7) });

  // @ts-expect-error INV-003: forbidden field name in the verdict branch
  sealEvidence({ ...CLEAN, accumulated: 2.7 });

  // @ts-expect-error INV-003: accumulator state may not reach a judge
  sealEvidence({ ...CLEAN, state: null as unknown as AccumulatorState });

  // @ts-expect-error INV-003: dispersion is sentencing data
  sealEvidence({ ...CLEAN, stats: null as unknown as DispersionStats });

  // prompts/invariant-judge.md: "no history of prior rulings".
  // @ts-expect-error INV-003: running case history may not reach a judge
  sealEvidence({ ...CLEAN, priors: [] as readonly LedgerEvent[] });

  // A callable can close over sentencing state no structural walk can see.
  // @ts-expect-error INV-003: no callables in an evidence bundle
  sealEvidence({ ...CLEAN, peek: () => 2.7 });

  // --- The opacity that removes the smuggling routes in the first place -------------------

  // ActorId is NOT a string, so no string field anywhere can hold it.
  // @ts-expect-error INV-003: ActorId is opaque, not a branded string
  const excerpt: string = actorId('amr');

  // Surprise is NOT a number, so no numeric field anywhere can hold it.
  // @ts-expect-error INV-003: Surprise is opaque, not a branded number
  const reading: number = surprise(2.7);

  // The two sentencing types are mutually non-assignable.
  // @ts-expect-error INV-003: an actor is not a meter reading
  const confused: ActorId = surprise(1);

  // A SightedCommit cannot stand in for a BlindCommit: the `author?: never` poison pill
  // defeats structural typing, which would otherwise accept the wider object.
  // @ts-expect-error INV-003: the sighted commit view may not cross the boundary
  const blind: BlindCommit = sighted;

  void [excerpt, reading, confused, blind];
}

/**
 * The second lock. Even holding a deep import of the declassifiers — which a test file may
 * have and `src/judge/**` may not — a caller cannot untaint anything without a
 * `SentencingWarrant`, and `withSentencingWarrant` is the only issuer.
 *
 * Never invoked; the arity errors below are the assertion.
 */
function declassifiersRequireAWarrant(
  state: AccumulatorState,
  event: LedgerEvent,
  stats: DispersionStats,
  input: DispersionInput,
): void {
  // @ts-expect-error INV-003: serializing the meter requires a warrant
  toAccumulatorSnapshot(state);
  // @ts-expect-error INV-003: the untainted increment term requires a warrant
  rawSurprise(event, null);
  // @ts-expect-error INV-003: declassifying identity into aggregates requires a warrant
  computeDispersion(input);
  // @ts-expect-error INV-003: flattening dispersion into four plain numbers requires a warrant
  toDispersionSnapshot(stats);
}

describe('INV-003 compile-time enforcement', () => {
  it('is enforced by tsc, not by this assertion', () => {
    // If any leak above began to compile, its `@ts-expect-error` would be unused and
    // `npm run typecheck` would fail before this suite ever ran.
    expect(typeof leaksThatMustNotCompile).toBe('function');
    expect(typeof declassifiersRequireAWarrant).toBe('function');
  });

  it('the barrel imports at the top of this file really are the only route being tested', () => {
    // Counter-assertion: the five `@ts-expect-error`ed barrel imports above prove the names
    // are absent, which would also be true of five misspelled names. These deep imports prove
    // the names EXIST — so the directives are testing withholding, not typos.
    expect(typeof toAccumulatorSnapshot).toBe('function');
    expect(typeof rawSurprise).toBe('function');
    expect(typeof computeDispersion).toBe('function');
    expect(typeof toDispersionSnapshot).toBe('function');
  });
});
