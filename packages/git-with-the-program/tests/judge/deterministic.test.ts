// Tests: SEED-03 deliverable 1 — the deterministic judges (src/judge/deterministic/**).
// docs/spec/03-judge.md §1 (the cheapest rung, zero variance), §4 (the output contract), §2
// (blindness), ADR-0005 (anchored severity, mandatory citations), INV-004.
//
// Every SealedEvidence here is minted by the REAL sealEvidence() — nothing bypasses the seal, so
// these tests exercise the same blindness chokepoint the engine does. The judges are imported
// through the family barrel (src/judge/deterministic/index.ts), which also proves the barrel's
// re-exports resolve.

import { describe, expect, it } from 'vitest';

import {
  citationsWithinBundle,
  formatCitation,
  isViolation,
  parseAssertionId,
  parsePathGlob,
  parseRepoPath,
  sealEvidence,
  unwrap,
  type AssertionClass,
  type Hunk,
  type NonEmptyReadonlyArray,
  type PathGlob,
  type SealedEvidence,
} from '../../src/core/index.js';
import {
  DETERMINISTIC_JUDGES,
  FORBIDDEN_WRITE_SUBTREES,
  PATH_BOUNDARY_JUDGE,
  PATH_BOUNDARY_JUDGE_ID,
  SCHEMA_CONFORMANCE_JUDGE,
  SCHEMA_CONFORMANCE_JUDGE_ID,
  SCHEMA_GOVERNED_ARTIFACTS,
  findProtectedWrites,
  findSchemaOffences,
  governedArtifactOf,
  isCompleteArtifactHunk,
  judgePathBoundary,
  judgeSchemaConformance,
  protectedSubtreeOf,
  validateArtifactHunk,
} from '../../src/judge/deterministic/index.js';

// ---------------------------------------------------------------------------
// Fixtures — real seals, controllable hunk geometry
// ---------------------------------------------------------------------------

const glob = (s: string): PathGlob => unwrap(parsePathGlob(s));
const rp = (s: string) => unwrap(parseRepoPath(s));
const aid = (s: string) => unwrap(parseAssertionId(s));

interface HunkMeta {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
}

/** A unified-diff hunk with controllable geometry. `+`/`-`/` ` markers as in a real patch. */
function hunk(path: string, meta: HunkMeta, lines: readonly string[]): Hunk {
  return {
    path: rp(path),
    oldStart: meta.oldStart,
    oldLines: meta.oldLines,
    newStart: meta.newStart,
    // post-image line count = context + added (everything not removed)
    newLines: lines.filter((l) => !l.startsWith('-')).length,
    text: lines.join('\n'),
  };
}

/** A newly created file: `@@ -0,0 +1,N @@`. */
function newFile(path: string, addedLines: readonly string[]): Hunk {
  return hunk(path, { oldStart: 0, oldLines: 0, newStart: 1 }, addedLines);
}

interface SealArgs {
  readonly klass: AssertionClass;
  readonly scope: NonEmptyReadonlyArray<PathGlob>;
  readonly hunks: readonly Hunk[];
  readonly id?: string;
  readonly statement?: string;
}

/** The seal is the real one — nothing bypasses sealEvidence's blindness chokepoint. */
function seal(args: SealArgs): SealedEvidence {
  return unwrap(
    sealEvidence({
      assertion: {
        id: aid(args.id ?? 'INV-001'),
        statement: args.statement ?? 'fixture boundary statement, long enough',
        class: args.klass,
        scope: args.scope,
      },
      charterExcerpt: 'fixture charter excerpt',
      hunks: args.hunks,
      ring: 'hunk',
      precedent: null,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  The path-boundary judge (INV-001-style)
// ═══════════════════════════════════════════════════════════════════════════

describe('the deterministic path-boundary judge', () => {
  it('identifies the protected program store, and nothing else', () => {
    expect(protectedSubtreeOf(rp('.program/manifest.yaml'))?.id).toBe('program-store');
    expect(protectedSubtreeOf(rp('.program/accumulators/INV-001.yaml'))?.id).toBe('program-store');
    expect(protectedSubtreeOf(rp('src/core/foo.ts'))).toBeNull();
    expect(protectedSubtreeOf(rp('program/notes.md'))).toBeNull(); // not `.program/`
  });

  it('every protected subtree carries a stable id and a truthful reason — reviewed as law', () => {
    const ids = FORBIDDEN_WRITE_SUBTREES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of FORBIDDEN_WRITE_SUBTREES) {
      expect(s.why.length, `${s.id} has no rationale`).toBeGreaterThan(40);
    }
  });

  it("records a deterministic seat with no prompt (identity is the procedure's name)", () => {
    expect(PATH_BOUNDARY_JUDGE.kind).toBe('deterministic');
    expect(PATH_BOUNDARY_JUDGE.id).toBe(PATH_BOUNDARY_JUDGE_ID);
    expect(PATH_BOUNDARY_JUDGE.prompt).toBeUndefined();
  });

  it('rules a write into the protected subtree as drift, cited inside the shown hunks', () => {
    const h = hunk('.program/manifest.yaml', { oldStart: 10, oldLines: 1, newStart: 10 }, [
      ' judges:',
      '+  - id: rogue',
      '+    model: sneaky',
    ]);
    const sealed = seal({ klass: 'boundary', scope: [glob('.program/**')], hunks: [h] });
    const v = judgePathBoundary(sealed);

    expect(v.verdict).toBe('drift');
    expect(isViolation(v)).toBe(true);
    if (!isViolation(v)) throw new Error('unreachable');
    // A modification of an existing protected file plainly writes into it: breach (ADR-0005).
    expect(v.severity).toBe('breach');
    expect(v.evidence).toHaveLength(1);
    // The citation lies inside a hunk the judge was actually shown (INV-004 enforced by harness).
    expect(citationsWithinBundle(sealed, [...v.evidence])).toBe(true);
    expect(formatCitation(v.evidence[0])).toBe('.program/manifest.yaml:11-12');
    expect(v.rationale.length).toBeGreaterThan(0);
  });

  it('rules a NEW protected file as the worst rung — entrenches', () => {
    const sealed = seal({
      klass: 'boundary',
      scope: [glob('.program/**')],
      hunks: [newFile('.program/rogue.yaml', ['+id: INV-099', '+statement: sneaky new law'])],
    });
    const v = judgePathBoundary(sealed);
    expect(v.verdict).toBe('drift');
    if (!isViolation(v)) throw new Error('unreachable');
    expect(v.severity).toBe('entrenches');
    expect(citationsWithinBundle(sealed, [...v.evidence])).toBe(true);
  });

  it('abstains on an uncitable offence rather than emitting path:0 (INV-004)', () => {
    // A pure deletion of a protected file: `@@ -1,3 +0,0 @@`. The post-image has no line to cite.
    const del = hunk('.program/charter.md', { oldStart: 1, oldLines: 3, newStart: 0 }, [
      '-first',
      '-second',
      '-third',
    ]);
    // The offence is real (the change touched the protected store) but has no citable span.
    const offences = findProtectedWrites([del]);
    expect(offences).toHaveLength(1);
    expect(offences[0]?.addedSpan).toBeNull();

    const sealed = seal({ klass: 'boundary', scope: [glob('.program/**')], hunks: [del] });
    const v = judgePathBoundary(sealed);
    expect(v.verdict).toBe('abstain');
    expect('evidence' in v).toBe(false);
    expect('severity' in v).toBe(false);
    // No fabricated path:0 anywhere in the ruling.
    expect(JSON.stringify(v)).not.toContain(':0');
  });

  it('abstains when handed the wrong assertion class', () => {
    const h = newFile('.program/rogue.yaml', ['+id: INV-099']);
    const v = judgePathBoundary(seal({ klass: 'dependency', scope: [glob('.program/**')], hunks: [h] }));
    expect(v.verdict).toBe('abstain');
    expect(v.rationale).toContain('class');
  });

  it('rules in-scope-but-clean as aligned, and terse', () => {
    // A boundary assertion whose scope is broader than the protected subtree; the change touches
    // a governed-but-not-forbidden path, so there is no write into protected ground.
    const clean = hunk('src/core/foo.ts', { oldStart: 1, oldLines: 1, newStart: 1 }, [
      ' export const x = 1;',
      '+export const y = 2;',
    ]);
    const v = judgePathBoundary(seal({ klass: 'boundary', scope: [glob('src/**')], hunks: [clean] }));
    expect(v.verdict).toBe('aligned');
    // "Aligned verdicts stay terse: verdict + confidence only" (spec 03 §4).
    expect('severity' in v).toBe(false);
    expect('evidence' in v).toBe(false);
    expect('rationale' in v).toBe(false);
  });

  it('abstains when nothing in the change intersects the scope', () => {
    const off = hunk('src/core/foo.ts', { oldStart: 1, oldLines: 1, newStart: 1 }, ['+const y = 2;']);
    const v = judgePathBoundary(seal({ klass: 'boundary', scope: [glob('.program/**')], hunks: [off] }));
    expect(v.verdict).toBe('abstain');
    expect(v.rationale).toContain('nothing to rule on');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  The schema-conformance judge (INV-006-style)
// ═══════════════════════════════════════════════════════════════════════════

const CONVENTION_SCOPE: NonEmptyReadonlyArray<PathGlob> = [glob('.program/**'), glob('schemas/**')];

/** A fully valid `.program/invariants.yaml` post-image (one assertion). */
const VALID_INVARIANTS: readonly string[] = [
  '+- id: INV-777',
  '+  statement: a sufficiently long statement',
  '+  class: convention',
  '+  scope:',
  '+    - "src/**"',
  '+  enforcement: deterministic',
  '+  precision: 0.5',
  '+  budget: 2.0',
  '+  half_life: 90d',
  '+  status: ratified',
  '+  provenance:',
  '+    - design-thread-2026-07',
];

function sealConvention(hunks: readonly Hunk[], klass: AssertionClass = 'convention'): SealedEvidence {
  return seal({
    klass,
    scope: CONVENTION_SCOPE,
    hunks,
    id: 'INV-006',
    statement: 'All program and ledger artifacts validate against schemas/ in CI',
  });
}

describe('the deterministic schema-conformance judge', () => {
  it('governs exactly the schema-backed program artifacts, each bound to its schema + decoder', () => {
    expect(governedArtifactOf(rp('.program/invariants.yaml'))?.schema).toBe('gwtp/assertion.schema.json');
    expect(governedArtifactOf(rp('.program/precedents.yaml'))?.schema).toBe('gwtp/precedent.schema.json');
    expect(governedArtifactOf(rp('.program/manifest.yaml'))).toBeNull(); // no schema (Q-08)
    expect(governedArtifactOf(rp('src/core/foo.ts'))).toBeNull();
    for (const a of SCHEMA_GOVERNED_ARTIFACTS) {
      expect(a.decode, `${a.id} lacks a decoder`).not.toBeNull();
      expect(a.why.length).toBeGreaterThan(40);
    }
  });

  it('records a deterministic seat with no prompt', () => {
    expect(SCHEMA_CONFORMANCE_JUDGE.kind).toBe('deterministic');
    expect(SCHEMA_CONFORMANCE_JUDGE.id).toBe(SCHEMA_CONFORMANCE_JUDGE_ID);
    expect(SCHEMA_CONFORMANCE_JUDGE.prompt).toBeUndefined();
  });

  it('rules a malformed (unparseable) new artifact as drift, cited to the file', () => {
    // Unterminated flow sequence: not well-formed YAML.
    const h = newFile('.program/invariants.yaml', ['+foo: [1, 2', '+bar: baz']);
    const offences = findSchemaOffences([h]);
    expect(offences[0]?.kind).toBe('unparseable-yaml');

    const sealed = sealConvention([h]);
    const v = judgeSchemaConformance(sealed);
    expect(v.verdict).toBe('drift');
    if (!isViolation(v)) throw new Error('unreachable');
    expect(v.severity).toBe('breach');
    expect(citationsWithinBundle(sealed, [...v.evidence])).toBe(true);
    expect(v.evidence[0].path).toBe('.program/invariants.yaml');
  });

  it('rules a well-formed but schema-INVALID new artifact as drift', () => {
    // Parses fine, but `id: NOPE` is not an assertion id and the required knobs are missing.
    const h = newFile('.program/invariants.yaml', ['+- id: NOPE', '+  statement: too short here']);
    const offences = findSchemaOffences([h]);
    expect(offences[0]?.kind).toBe('schema-invalid');
    expect(offences[0]?.detail).toContain('gwtp/assertion.schema.json');

    const v = judgeSchemaConformance(sealConvention([h]));
    expect(v.verdict).toBe('drift');
    if (!isViolation(v)) throw new Error('unreachable');
    expect(v.severity).toBe('breach');
  });

  it('rules a well-formed, valid new artifact as aligned, and terse', () => {
    const h = newFile('.program/invariants.yaml', VALID_INVARIANTS);
    expect(validateArtifactHunk(h, unwrap0(governedArtifactOf(rp('.program/invariants.yaml'))))).toBeNull();

    const v = judgeSchemaConformance(sealConvention([h]));
    expect(v.verdict).toBe('aligned');
    expect('severity' in v).toBe(false);
    expect('evidence' in v).toBe(false);
    expect('rationale' in v).toBe(false);
  });

  it('abstains on a PARTIAL edit to a governed artifact — a slice cannot be validated', () => {
    const partial = hunk('.program/invariants.yaml', { oldStart: 10, oldLines: 1, newStart: 10 }, [
      ' status: ratified',
      '+  precision: 0.9',
    ]);
    expect(isCompleteArtifactHunk(partial)).toBe(false);

    const v = judgeSchemaConformance(sealConvention([partial]));
    expect(v.verdict).toBe('abstain');
    expect(v.rationale).toContain('COMPLETE');
  });

  it('abstains when a new in-scope file is not a schema-governed artifact', () => {
    // .program/manifest.yaml is in scope but has no schema/decoder (Q-08): nothing to validate.
    const v = judgeSchemaConformance(sealConvention([newFile('.program/manifest.yaml', ['+seats: []'])]));
    expect(v.verdict).toBe('abstain');
  });

  it('abstains when handed the wrong assertion class', () => {
    const v = judgeSchemaConformance(sealConvention([newFile('.program/invariants.yaml', VALID_INVARIANTS)], 'boundary'));
    expect(v.verdict).toBe('abstain');
    expect(v.rationale).toContain('class');
  });

  it('abstains when nothing in the change intersects the scope', () => {
    const off = newFile('src/core/foo.ts', ['+export const y = 2;']);
    const v = judgeSchemaConformance(sealConvention([off]));
    expect(v.verdict).toBe('abstain');
    expect(v.rationale).toContain('nothing to rule on');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  The bench, uniformly
// ═══════════════════════════════════════════════════════════════════════════

describe('the deterministic bench', () => {
  it('exposes three distinct judges, each a SealedEvidence -> Verdict', () => {
    expect(DETERMINISTIC_JUDGES).toHaveLength(3);
    const ids = DETERMINISTIC_JUDGES.map((j) => j.ref.id);
    expect(new Set(ids).size).toBe(3);
    for (const j of DETERMINISTIC_JUDGES) {
      expect(j.ref.kind).toBe('deterministic');
      expect(typeof j.judge).toBe('function');
    }
  });

  it('each judge abstains (never fabricates aligned) when handed an out-of-jurisdiction class', () => {
    // An `interface`-class assertion belongs to no deterministic judge here.
    const sealed = seal({ klass: 'interface', scope: [glob('.program/**')], hunks: [newFile('.program/x.yaml', ['+a: b'])] });
    for (const j of DETERMINISTIC_JUDGES) {
      // eslint-disable-next-line no-await-in-loop
      const v = j.judge(sealed);
      // Deterministic judges are synchronous, but the port is Verdict | Promise<Verdict>.
      expect(v).not.toBeInstanceOf(Promise);
      if (v instanceof Promise) throw new Error('deterministic judge returned a promise');
      expect(v.verdict).toBe('abstain');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Blindness (ADR-0003 / INV-003): the judge input exposes no author/accumulator field
// ═══════════════════════════════════════════════════════════════════════════

describe('blindness is structural (compile-time)', () => {
  it('SealedEvidence has no channel for author identity or accumulator state', () => {
    const sealed = seal({ klass: 'boundary', scope: [glob('.program/**')], hunks: [newFile('.program/x.yaml', ['+a: b'])] });

    // @ts-expect-error — SealedEvidence exposes no author field (ADR-0003 / INV-003).
    void sealed.author;
    // @ts-expect-error — the sealed bundle exposes no accumulator field.
    void sealed.bundle.accumulator;
    // @ts-expect-error — the sealed bundle exposes no prior-verdict / history channel.
    void sealed.bundle.priorVerdicts;
    // @ts-expect-error — the AssertionView carries no precision knob (one step from the meter; Q-21).
    void sealed.bundle.assertion.precision;

    // Runtime confirmation that the sealed bundle carries only the five permitted keys.
    expect(Object.keys(sealed.bundle).sort()).toEqual(
      ['assertion', 'charterExcerpt', 'hunks', 'precedent', 'ring'].sort(),
    );
  });

  it('sealEvidence — the assembler — refuses author identity, at compile time AND run time', () => {
    // The @ts-expect-error proves the COMPILE-time rejection (Blind<B> maps `author` to an
    // uninhabitable type); assertBlind is the runtime second line for data arriving as `unknown`.
    expect(() =>
      sealEvidence({
        assertion: {
          id: aid('INV-001'),
          statement: 'fixture boundary statement, long enough',
          class: 'boundary',
          scope: [glob('.program/**')],
        },
        charterExcerpt: '',
        hunks: [],
        ring: 'hunk',
        precedent: null,
        // @ts-expect-error — Blind<B> rewrites the forbidden `author` key into an uninhabitable type.
        author: 'someone',
      }),
    ).toThrow(/author/);
  });
});

/** unwrap a nullable governed-artifact lookup for a test that knows it exists. */
function unwrap0<T>(v: T | null): T {
  if (v === null) throw new Error('expected a governed artifact');
  return v;
}
