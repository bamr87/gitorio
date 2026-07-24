// Implements tests for: docs/adr/0003-judge-blindness.md, docs/spec/03-judge.md §2-3, and
// INV-003 ("No code path passes author identity or accumulator state to any judge").
//
// SEED-03's acceptance check is "attempting to feed author or accumulator data to the
// assembler fails to compile / raises". Both limbs are exercised here:
//   - the COMPILE limb, via expectTypeOf over IsBlind<T> (a false proof breaks the build);
//   - the RUNTIME limb, via assertBlind / sealEvidence throwing BlindnessBreach.
//
// The COUNTER-tests matter as much as the proofs: if IsBlind<AccumulatorState> were `true`,
// the scanner would be passing vacuously and every proof below would be worthless.

import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AccumulatorState, ContributingEvent, Firing } from '../../src/core/accumulator.js';
import {
  BlindnessBreach,
  FORBIDDEN_KEYS,
  assertBlind,
  type ForbiddenKey,
  type IsBlind,
} from '../../src/core/blindness.js';
import type { BlindCommit, ChangeRef, ContextRing, Hunk } from '../../src/core/change.js';
import type { DispersionStats } from '../../src/core/dispersion.js';
import type { LedgerEvent } from '../../src/core/event.js';
import type { Precedent, PrecedentView } from '../../src/core/precedent.js';
import type { Proposal } from '../../src/core/proposal.js';
import type { Verdict } from '../../src/core/verdict.js';
import {
  SEALED_BUNDLE_KEYS,
  sealEvidence,
  type AssertionView,
  type EvidenceBundleInput,
} from '../../src/core/evidence.js';
import { parseAssertionId } from '../../src/core/ids.js';
import { parsePathGlob, parseRepoPath, type PathGlob } from '../../src/core/paths.js';
import { unwrap } from '../../src/core/result.js';
import {
  actorId,
  surprise,
  type ActorId,
  type SightedCommit,
  type Surprise,
} from '../../src/core/sentencing.js';

// ---------------------------------------------------------------------------
// Layer 1 + 2, compile time: the type-level proofs
// ---------------------------------------------------------------------------

describe('INV-003 layer 1-2 (compile time): judge-facing types are provably blind', () => {
  it('every type reachable from an evidence bundle is blind', () => {
    expectTypeOf<IsBlind<AssertionView>>().toEqualTypeOf<true>();
    expectTypeOf<IsBlind<PrecedentView>>().toEqualTypeOf<true>();
    expectTypeOf<IsBlind<Hunk>>().toEqualTypeOf<true>();
    expectTypeOf<IsBlind<ChangeRef>>().toEqualTypeOf<true>();
    expectTypeOf<IsBlind<ContextRing>>().toEqualTypeOf<true>();
    expectTypeOf<IsBlind<BlindCommit>>().toEqualTypeOf<true>();
    expectTypeOf<IsBlind<EvidenceBundleInput>>().toEqualTypeOf<true>();
    expectTypeOf<IsBlind<Verdict>>().toEqualTypeOf<true>();
  });

  it('settled case law stays visible — the regression judge is required to read it', () => {
    // spec 03 §7. Case law YES; running case history NO (see the counter-tests below).
    expectTypeOf<IsBlind<Precedent>>().toEqualTypeOf<true>();
  });

  it('COUNTER-TEST: sentencing-only scalars are not blind', () => {
    expectTypeOf<IsBlind<ActorId>>().toEqualTypeOf<false>();
    expectTypeOf<IsBlind<Surprise>>().toEqualTypeOf<false>();
  });

  it('COUNTER-TEST: accumulator state and everything carrying it is not blind', () => {
    expectTypeOf<IsBlind<AccumulatorState>>().toEqualTypeOf<false>();
    expectTypeOf<IsBlind<ContributingEvent>>().toEqualTypeOf<false>();
    expectTypeOf<IsBlind<Firing>>().toEqualTypeOf<false>();
    expectTypeOf<IsBlind<Proposal>>().toEqualTypeOf<false>();
    expectTypeOf<IsBlind<DispersionStats>>().toEqualTypeOf<false>();
  });

  it('COUNTER-TEST: running case history is not blind (prompts/invariant-judge.md)', () => {
    expectTypeOf<IsBlind<LedgerEvent>>().toEqualTypeOf<false>();
  });

  it('COUNTER-TEST: the author-bearing commit view is not blind', () => {
    expectTypeOf<IsBlind<SightedCommit>>().toEqualTypeOf<false>();
  });

  it('COUNTER-TEST: a leak nested inside a bundle is caught at depth', () => {
    expectTypeOf<IsBlind<{ hunks: readonly { path: string; committer: ActorId }[] }>>().toEqualTypeOf<false>();
    expectTypeOf<IsBlind<{ a: { b: { c: { meter: Surprise } } } }>>().toEqualTypeOf<false>();
  });

  it('COUNTER-TEST: a forbidden field NAME is caught even when it holds a bare string', () => {
    expectTypeOf<IsBlind<{ author: string }>>().toEqualTypeOf<false>();
    expectTypeOf<IsBlind<{ accumulated: number }>>().toEqualTypeOf<false>();
    expectTypeOf<IsBlind<{ nested: { dispersion_snapshot: { x: number } } }>>().toEqualTypeOf<false>();
  });

  it('COUNTER-TEST: a callable is caught, since it can close over sentencing state', () => {
    expectTypeOf<IsBlind<{ peek: () => number }>>().toEqualTypeOf<false>();
  });

  it('ActorId is NOT a string and Surprise is NOT a number — no slot to smuggle them into', () => {
    // These are the assignments a branded-string design would have allowed. They are type
    // errors here, which is why every string/number field in a bundle is safe by default.
    expectTypeOf<ActorId>().not.toMatchTypeOf<string>();
    expectTypeOf<Surprise>().not.toMatchTypeOf<number>();
    expectTypeOf<ActorId>().not.toMatchTypeOf<Surprise>();
    expectTypeOf<Surprise>().not.toMatchTypeOf<ActorId>();
  });

  it('a SightedCommit is not structurally assignable to a BlindCommit', () => {
    expectTypeOf<SightedCommit>().not.toMatchTypeOf<BlindCommit>();
  });
});

// ---------------------------------------------------------------------------
// Layer 3, runtime: the backstop for data that arrived as `unknown`
// ---------------------------------------------------------------------------

describe('INV-003 layer 3 (runtime): assertBlind is the backstop for `unknown` data', () => {
  it('passes clean plain data', () => {
    expect(() => assertBlind({ a: 1, b: ['x'], c: { d: null } })).not.toThrow();
    expect(() => assertBlind(null)).not.toThrow();
    expect(() => assertBlind('a string')).not.toThrow();
  });

  it('throws on a sentencing value, wherever it hides', () => {
    expect(() => assertBlind(actorId('amr'))).toThrow(BlindnessBreach);
    expect(() => assertBlind(surprise(2.7))).toThrow(BlindnessBreach);
    expect(() => assertBlind({ deep: { deeper: [{ x: actorId('amr') }] } })).toThrow(
      BlindnessBreach,
    );
  });

  it('reports a JSON pointer to the leak', () => {
    try {
      assertBlind({ hunks: [{ path: 'a.ts', who: actorId('amr') }] });
      expect.unreachable('expected a BlindnessBreach');
    } catch (e) {
      expect(e).toBeInstanceOf(BlindnessBreach);
      expect((e as BlindnessBreach).at).toBe('/hunks/0/who');
    }
  });

  it('throws on every forbidden field name', () => {
    for (const key of FORBIDDEN_KEYS) {
      expect(() => assertBlind({ [key]: 'anything' })).toThrow(BlindnessBreach);
    }
  });

  it('throws on a callable', () => {
    expect(() => assertBlind({ peek: () => 2.7 })).toThrow(BlindnessBreach);
  });

  it('keeps the runtime key list and the ForbiddenKey type in lockstep', () => {
    const typed: readonly ForbiddenKey[] = FORBIDDEN_KEYS;
    expect(new Set(typed).size).toBe(FORBIDDEN_KEYS.length);
    expect(FORBIDDEN_KEYS).toContain('author');
    expect(FORBIDDEN_KEYS).toContain('accumulator');
    expect(FORBIDDEN_KEYS).toContain('dispersion_snapshot');
  });

  it('terminates on a cyclic structure instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(() => assertBlind(cyclic)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The chokepoint
// ---------------------------------------------------------------------------

const glob = (s: string): PathGlob => unwrap(parsePathGlob(s));

const CLEAN_BUNDLE: EvidenceBundleInput = {
  assertion: {
    id: unwrap(parseAssertionId('INV-005')),
    statement: 'Engine core imports no forge-specific APIs; GitHub access lives in adapters/',
    class: 'dependency',
    scope: [glob('src/core/**')],
  },
  charterExcerpt: 'The engine core stays forge-agnostic.',
  hunks: [
    {
      path: unwrap(parseRepoPath('src/core/http.ts')),
      oldStart: 41,
      oldLines: 0,
      newStart: 41,
      newLines: 18,
      text: "+import { Octokit } from '@octokit/rest';",
    },
  ],
  ring: 'hunk',
  precedent: null,
};

describe('sealEvidence is the chokepoint (spec 03 §2: "enforced structurally")', () => {
  it('seals a clean bundle and carries the hunk hash for the verdict cache key', () => {
    const sealed = unwrap(sealEvidence(CLEAN_BUNDLE));
    expect(sealed.hunkHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(sealed.bundle.assertion.statement).toContain('no forge-specific APIs');
  });

  it('the sealed bundle carries only the five known keys — no knobs reach the judge', () => {
    const sealed = unwrap(sealEvidence(CLEAN_BUNDLE));
    expect(Object.keys(sealed.bundle).sort()).toEqual([...SEALED_BUNDLE_KEYS].sort());
    const view = sealed.bundle.assertion as unknown as Record<string, unknown>;
    for (const knob of ['precision', 'budget', 'half_life', 'status', 'provenance']) {
      expect(view[knob]).toBeUndefined();
    }
  });

  it('DROPS excess runtime properties rather than forwarding them', () => {
    // Structural typing lets a subtype through the compiler; the whitelist copy stops it here.
    const smuggled = { ...CLEAN_BUNDLE, meterReading: 2.7, whodunnit: 'amr' };
    const sealed = unwrap(sealEvidence(smuggled));
    expect((sealed.bundle as unknown as Record<string, unknown>)['meterReading']).toBeUndefined();
    expect((sealed.bundle as unknown as Record<string, unknown>)['whodunnit']).toBeUndefined();
  });

  it('RAISES when authorship arrives through an `any`-typed hole', () => {
    const leaking = {
      ...CLEAN_BUNDLE,
      hunks: [{ ...CLEAN_BUNDLE.hunks[0]!, committer: actorId('amr') }],
    } as unknown as EvidenceBundleInput;
    expect(() => sealEvidence(leaking)).toThrow(BlindnessBreach);
  });

  it('RAISES when accumulator state arrives through an `any`-typed hole', () => {
    const leaking = {
      ...CLEAN_BUNDLE,
      charterExcerpt: 'x',
      accumulated: 2.7,
    } as unknown as EvidenceBundleInput;
    expect(() => sealEvidence(leaking)).toThrow(BlindnessBreach);
  });

  it('deep-freezes the sealed bundle', () => {
    const sealed = unwrap(sealEvidence(CLEAN_BUNDLE));
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.bundle)).toBe(true);
  });

  it('the same content seals to the same hunk hash regardless of hunk order', () => {
    const twoHunks: EvidenceBundleInput = {
      ...CLEAN_BUNDLE,
      hunks: [
        CLEAN_BUNDLE.hunks[0]!,
        { ...CLEAN_BUNDLE.hunks[0]!, path: unwrap(parseRepoPath('src/core/a.ts')) },
      ],
    };
    const reversed: EvidenceBundleInput = { ...twoHunks, hunks: [...twoHunks.hunks].reverse() };
    expect(unwrap(sealEvidence(twoHunks)).hunkHash).toBe(unwrap(sealEvidence(reversed)).hunkHash);
  });
});

// The following, uncommented, must NOT compile. Kept as documentation of the compile-time
// limb, since a test file that fails to compile would fail the whole suite.
//
//   sealEvidence({ ...CLEAN_BUNDLE, author: actorId('amr') });
//     -> Type 'ActorId' is not assignable to type 'BlindnessViolation<"INV-003: forbidden
//        field name in the verdict branch">'
//
//   sealEvidence({ ...CLEAN_BUNDLE, meter: surprise(2.7) });
//     -> Type 'Surprise' is not assignable to type 'BlindnessViolation<"INV-003: a
//        sentencing-only value reached the verdict branch">'
//
//   const b: BlindCommit = sightedCommit;
//     -> Types of property 'author' are incompatible: 'ActorId' is not assignable to 'undefined'
//
//   const excerpt: string = actorId('amr');
//     -> Type 'ActorId' is not assignable to type 'string'
