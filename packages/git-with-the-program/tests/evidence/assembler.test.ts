// Tests for: src/evidence/assembler.ts against docs/spec/03-judge.md §2-§3 and
// docs/adr/0003-judge-blindness.md. SEED-03 deliverable 2 acceptance:
//   - the assembler builds a SealedEvidence bundle (assertion view + charter excerpt +
//     scope-intersected hunks + context ring) via the injected seal;
//   - it is STRUCTURALLY blind: feeding author identity or accumulator state fails to COMPILE
//     (@ts-expect-error), and assertBlind(bundle) passes at runtime;
//   - an abstain escalation widens the context ring by exactly one step.
//
// This is a NON-blind test file (it lives under tests/, not src/judge or src/evidence), so it
// may freely import the barrel and deep-import the sentencing branch — that is exactly how it
// gets an ActorId / Surprise to PROVE they cannot enter a bundle.

import { describe, expect, it } from 'vitest';

import {
  BlindnessBreach,
  assertBlind,
  citationsWithinBundle,
  parseAssertionId,
  parseCitation,
  parseCommitSha,
  parseCommitterTime,
  parsePathGlob,
  parseRepoPath,
  sealEvidence,
  unwrap,
  widenContextRing,
  type AccumulatorState,
  type ActorId,
  type AssertionView,
  type ChangeRef,
  type ChangeSource,
  type ContextRing,
  type Hunk,
  type IsBlind,
  type Proof,
  type Surprise,
} from '../../src/core/index.js';
// Deep import of the sentencing branch is legal from a NON-blind test: this is the counter-test
// that keeps the blindness proofs from passing vacuously.
import { actorId, surprise } from '../../src/core/sentencing.js';
import {
  DEFAULT_CHARTER_CHARS,
  INITIAL_RING,
  assembleEvidence,
  escalateEvidence,
  excerptCharter,
  scopeLiteralPrefix,
  type AssembleRequest,
  type EvidenceSeal,
} from '../../src/evidence/assembler.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const glob = (s: string) => unwrap(parsePathGlob(s));
const rp = (s: string) => unwrap(parseRepoPath(s));

function hunk(path: string, newStart: number, lines: readonly string[]): Hunk {
  return {
    path: rp(path),
    oldStart: newStart,
    oldLines: 0,
    newStart,
    newLines: lines.filter((l) => !l.startsWith('-')).length,
    text: lines.join('\n'),
  };
}

const VIEW: AssertionView = {
  id: unwrap(parseAssertionId('INV-005')),
  statement: 'Engine core imports no forge-specific APIs; GitHub access lives in adapters/',
  class: 'dependency',
  scope: [glob('src/core/**')],
};

const REF: ChangeRef = {
  commit: unwrap(parseCommitSha('9f2c1d')),
  committerTime: unwrap(parseCommitterTime('2026-07-21T14:03:00Z')),
};

const CHARTER =
  'GWTP governs its own code with the same machinery it offers.\n\n' +
  'The engine core (src/core) must stay forge-agnostic: no GitHub, GitLab or Bitbucket SDK ' +
  'may be imported from it. Forge access lives behind ports in adapters/. This is why INV-005 ' +
  'exists — a core that reaches a forge API cannot degrade to a bare repository.\n\n' +
  'Unrelated closing paragraph about distillation and epochs that should not be excerpted.';

/** The real seal, injected — nothing bypasses the chokepoint. */
const seal: EvidenceSeal = sealEvidence;

/**
 * A change source whose hunk set GROWS with the ring — the narrow ring shows only the changed
 * import line, a wider ring adds the enclosing function body. It also offers one out-of-scope
 * hunk to prove the assembler re-scopes what a change source hands it.
 */
const NARROW = hunk('src/core/http.ts', 41, [
  `+import { Octokit } from '@octokit/rest';`,
  `+const client = new Octokit();`,
]);
const WIDER_CONTEXT = hunk('src/core/http.ts', 30, [
  ` export function makeClient() {`,
  `+  // widened context ring`,
  ` }`,
]);
const OUT_OF_SCOPE = hunk('docs/architecture.md', 5, [`+Some prose about the forge.`]);

const growingSource: ChangeSource = {
  hunksIntersecting: async (_scope, _ref, ring) =>
    ring === 'hunk' ? [NARROW, OUT_OF_SCOPE] : [NARROW, WIDER_CONTEXT, OUT_OF_SCOPE],
};

function request(overrides: Partial<AssembleRequest> = {}): AssembleRequest {
  return {
    assertion: VIEW,
    charter: CHARTER,
    change: growingSource,
    ref: REF,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Assembly (spec 03 §3)
// ---------------------------------------------------------------------------

describe('the evidence assembler builds what spec 03 §3 permits — and only that', () => {
  it('seals the assertion view, a charter excerpt and the scope-intersected hunks at the hunk ring', async () => {
    const sealed = unwrap(await assembleEvidence(request(), seal));

    expect(sealed.bundle.assertion).toEqual(VIEW);
    expect(sealed.bundle.ring).toBe('hunk');
    expect(sealed.bundle.precedent).toBeNull();
    expect(sealed.bundle.charterExcerpt.length).toBeGreaterThan(0);
    // The change source offered an out-of-scope docs hunk; the assembler re-scopes it away.
    expect(sealed.bundle.hunks.map((h) => h.path)).toEqual([rp('src/core/http.ts')]);
    expect(sealed.hunkHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('defaults to the narrowest ring and carries a null precedent unless one is supplied', async () => {
    expect(INITIAL_RING).toBe<ContextRing>('hunk');
    const sealed = unwrap(await assembleEvidence(request({ ring: undefined }), seal));
    expect(sealed.bundle.ring).toBe('hunk');
    expect(sealed.bundle.precedent).toBeNull();
  });

  it('produces citations that land inside the shown hunks (INV-004): in-bundle true, out-of-bundle false', async () => {
    const sealed = unwrap(await assembleEvidence(request(), seal));
    const inside = unwrap(parseCitation('src/core/http.ts:41'));
    const outside = unwrap(parseCitation('src/core/http.ts:900'));
    const wrongFile = unwrap(parseCitation('src/core/other.ts:41'));
    expect(citationsWithinBundle(sealed, [inside])).toBe(true);
    expect(citationsWithinBundle(sealed, [outside])).toBe(false);
    expect(citationsWithinBundle(sealed, [wrongFile])).toBe(false);
  });

  it('is deterministic — same inputs, byte-identical sealed content (the ledger content-hashes it)', async () => {
    const a = unwrap(await assembleEvidence(request(), seal));
    const b = unwrap(await assembleEvidence(request(), seal));
    expect(a.bundle).toEqual(b.bundle);
    expect(a.hunkHash).toBe(b.hunkHash);
  });
});

// ---------------------------------------------------------------------------
// Abstain escalation widens the ring by one step (spec 03 §3-§4)
// ---------------------------------------------------------------------------

describe('abstain escalation widens the context ring by exactly one step', () => {
  it('hunk → enclosing-symbol, and the wider ring shows more of the change', async () => {
    const first = unwrap(await assembleEvidence(request({ ring: 'hunk' }), seal));
    expect(first.bundle.hunks).toHaveLength(1);

    const esc = await escalateEvidence(request({ ring: 'hunk' }), seal);
    expect(esc).not.toBeNull();
    expect(esc?.ring).toBe(widenContextRing('hunk'));
    expect(esc?.ring).toBe<ContextRing>('enclosing-symbol');

    const widened = unwrap(esc!.sealed);
    expect(widened.bundle.ring).toBe('enclosing-symbol');
    // The wider ring pulled in the enclosing function body (still re-scoped to src/core/**).
    expect(widened.bundle.hunks).toHaveLength(2);
    expect(widened.bundle.hunks.map((h) => h.newStart).sort((x, y) => x - y)).toEqual([30, 41]);
  });

  it('walks the whole ladder and returns null at the widest ring (escalate UP, not out)', async () => {
    expect((await escalateEvidence(request({ ring: 'hunk' }), seal))?.ring).toBe('enclosing-symbol');
    expect((await escalateEvidence(request({ ring: 'enclosing-symbol' }), seal))?.ring).toBe('file');
    expect((await escalateEvidence(request({ ring: 'file' }), seal))?.ring).toBe('callers');
    // 'callers' is the widest ring; there is nowhere wider to go.
    expect(await escalateEvidence(request({ ring: 'callers' }), seal)).toBeNull();
    expect(widenContextRing('callers')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Structural blindness (INV-003, ADR-0003) — compile-time AND runtime
// ---------------------------------------------------------------------------

describe('the assembler is structurally blind (INV-003)', () => {
  it('assertBlind(bundle) passes on every assembled bundle', async () => {
    const sealed = unwrap(await assembleEvidence(request(), seal));
    expect(() => assertBlind(sealed.bundle)).not.toThrow();
    const widened = await escalateEvidence(request({ ring: 'file' }), seal);
    expect(() => assertBlind(unwrap(widened!.sealed).bundle)).not.toThrow();
  });

  it('the blindness proofs are NOT vacuous: judge-facing types are blind, sentencing types are not', () => {
    // Positive: these must be blind (mirrors src/core/evidence.ts __INV003_PROOFS).
    type _p1 = Proof<IsBlind<AssertionView>>;
    type _p2 = Proof<IsBlind<Hunk>>;
    const positives: [_p1, _p2] = [true, true];
    expect(positives).toEqual([true, true]);

    // Negative: an author identity is NOT blind. IsBlind<ActorId> is `false`, so Proof<false>
    // is a compile error — the @ts-expect-error is the assertion.
    // @ts-expect-error - an ActorId must NOT be blind, or the scanner is passing vacuously
    type _n1 = Proof<IsBlind<ActorId>>;
    // @ts-expect-error - accumulator state must NOT be blind
    type _n2 = Proof<IsBlind<AccumulatorState>>;
    // @ts-expect-error - the meter reading must NOT be blind
    type _n3 = Proof<IsBlind<Surprise>>;
  });

  it('the request type has no author or accumulator slot — feeding one fails to COMPILE', () => {
    const who: ActorId = actorId('jane@example.com');
    const meter: Surprise = surprise(2.7);

    // @ts-expect-error - the assembler request has no `author` slot; identity cannot be assembled in (ADR-0003)
    const withAuthor: AssembleRequest = { ...request(), author: who };
    // @ts-expect-error - nor an `accumulator` slot; the meter is invisible to the assembler (ADR-0003)
    const withMeter: AssembleRequest = { ...request(), accumulator: meter };
    expect(withAuthor).toBeDefined();
    expect(withMeter).toBeDefined();
  });

  it('the seal rejects a sentencing value in any bundle field — at COMPILE time', () => {
    // COMPILE-time assertions only: this function is NEVER invoked, so the runtime assertBlind
    // throw never fires — tsc validates each @ts-expect-error, vitest runs nothing. Calls go
    // through the real generic `sealEvidence`, so the deep `Blind<B>` value-arm is exercised.
    const _compileOnly = (): void => {
      const meter: Surprise = surprise(2.7);
      const who: ActorId = actorId('jane@example.com');
      // @ts-expect-error - a Surprise is not a string; the meter cannot occupy charterExcerpt (Blind<B>, INV-003)
      sealEvidence({ assertion: VIEW, charterExcerpt: meter, hunks: [], ring: 'hunk', precedent: null });
      // @ts-expect-error - an ActorId has no slot in a bundle; excess property + Blind<B> both reject it
      sealEvidence({ assertion: VIEW, charterExcerpt: '', hunks: [], ring: 'hunk', precedent: null, author: who });
    };
    expect(typeof _compileOnly).toBe('function');
  });

  it('the runtime backstop THROWS on a leak reconstituted as plain data (YAML / subprocess path)', () => {
    // A bundle-shaped object that arrived as `unknown` and smuggled in identity. The type layer
    // proved nothing here; assertBlind (which sealEvidence runs first) is the second line.
    const leakyByKey = {
      assertion: VIEW,
      charterExcerpt: '',
      hunks: [],
      ring: 'hunk',
      precedent: null,
      author: 'jane@example.com',
    };
    expect(() => assertBlind(leakyByKey)).toThrow(BlindnessBreach);

    const leakyByValue = {
      assertion: VIEW,
      charterExcerpt: '',
      hunks: [{ smuggled: actorId('jane@example.com') }],
      ring: 'hunk',
      precedent: null,
    };
    expect(() => assertBlind(leakyByValue)).toThrow(BlindnessBreach);
    // And sealEvidence, which runs assertBlind before it copies anything, refuses the same input.
    expect(() => sealEvidence(leakyByValue as never)).toThrow(BlindnessBreach);
  });
});

// ---------------------------------------------------------------------------
// Charter excerpting
// ---------------------------------------------------------------------------

describe('excerptCharter is deterministic and relevance-seeking', () => {
  it('returns the whole charter when it fits the budget', () => {
    const short = 'INV-005 short charter.';
    expect(excerptCharter(short, VIEW, DEFAULT_CHARTER_CHARS)).toBe(short);
  });

  it('prefers the paragraph naming the assertion or its scope over the head, and stays bounded', () => {
    const excerpt = excerptCharter(CHARTER, VIEW, 200);
    expect(excerpt.length).toBeLessThanOrEqual(200);
    // The relevant paragraph (mentioning INV-005 and src/core) is chosen, not the intro.
    expect(excerpt).toContain('INV-005');
    expect(excerpt).not.toContain('Unrelated closing paragraph');
  });

  it('is a pure function — same inputs, same excerpt', () => {
    expect(excerptCharter(CHARTER, VIEW, 120)).toBe(excerptCharter(CHARTER, VIEW, 120));
  });

  it('extracts the literal leading path of a scope glob', () => {
    expect(scopeLiteralPrefix(glob('src/core/**'))).toBe('src/core');
    expect(scopeLiteralPrefix(glob('src/judge/*.ts'))).toBe('src/judge');
    expect(scopeLiteralPrefix(glob('prompts/**'))).toBe('prompts');
  });
});
