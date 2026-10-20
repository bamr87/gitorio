// Tests for: src/judge/regression.ts — SEED-03 deliverable 7, the regression judge (spec 03 §7).
// Acceptance: a same-mechanism match confirmed with a PRE-id → regression; a confirm without a
// PRE-id is rejected; a superficial lookalike → aligned/abstain and yields a coincidence-tombstone
// diff.
//
// The confirming magistrate is INJECTED as a fake `RegressionConfirmer` returning canned ruling
// records (the seal-then-LLM path a real confirmer runs). One case wires a typed fake `Judge`
// through `confirmerFromJudge` + the real `sealEvidence`, to exercise the injected-judge seam. No
// network, no model.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  decodeVerdict,
  parseAssertionId,
  parseCitation,
  parsePathGlob,
  parsePrecedentId,
  parseRepoPath,
  precedentView,
  sealEvidence,
  unwrap,
  type Hunk,
  type Judge,
  type PrecedentView,
  type ProvenanceRef,
  type SealedEvidence,
  type Verdict,
} from '../../src/core/index.js';
import {
  citationsWithinHunks,
  confirmerFromJudge,
  interpretConfirmation,
  jaccard,
  proposeCoincidence,
  retrieveCandidates,
  runRegression,
  tokenize,
  wholeFileReplaceDiff,
  type RegressionConfirmer,
  type RegressionSealer,
} from '../../src/judge/regression.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rp = (s: string) => unwrap(parseRepoPath(s));
const glob = (s: string) => unwrap(parsePathGlob(s));
const pre = (s: string) => unwrap(parsePrecedentId(s));
const cite = (s: string) => unwrap(parseCitation(s));

const A5 = unwrap(parseAssertionId('INV-005'));

/** The killed pattern from spec 03 §4's worked example: an HTTP client imported inside core. */
const KILLED: PrecedentView = precedentView({
  id: pre('PRE-001'),
  pattern: 'reqwest HTTP client imported inside core bypassing the adapter boundary',
  ruling: 'killed',
  rationale: 'core must reach a forge only through an adapter port',
  evidence: ['pr#12', 'commit abc123'], // dropped by precedentView — never reaches the judge
});

const AFFIRMED: PrecedentView = precedentView({
  id: pre('PRE-050'),
  pattern: 'reqwest client inside core',
  ruling: 'affirmed',
  rationale: 'upheld under contest',
  evidence: ['pr#40'],
});

function hunk(path: string, newStart: number, lines: readonly string[]): Hunk {
  return {
    path: rp(path),
    oldStart: 0,
    oldLines: 0,
    newStart,
    newLines: lines.filter((l) => !l.startsWith('-')).length,
    text: lines.join('\n'),
  };
}

/** A change that reintroduces the killed mechanism, at lines a citation can point inside. */
const REINTRODUCING: readonly Hunk[] = [
  hunk('src/core/http.rs', 41, [
    '+use reqwest::Client;',
    '+pub fn fetch(url: &str) -> reqwest::Result<String> {',
    '+    let client = reqwest::Client::new();',
    '+    // an HTTP client living inside core, bypassing the adapter boundary',
    '+    client.get(url).send()?.text()',
    '+}',
  ]),
];

/** A change that merely shares vocabulary — the word "boundary" — with a different mechanism. */
const LOOKALIKE_DIFF: readonly Hunk[] = [
  hunk('docs/notes.md', 10, ['+A note about the module boundary and import discipline.']),
];

/** A confirmer that returns whatever raw ruling record it is handed, ignoring its inputs. */
function cannedConfirmer(record: unknown): RegressionConfirmer {
  return { confirm: async () => record };
}

const EXISTING_PRECEDENTS_YAML = `- id: PRE-001
  pattern: reqwest HTTP client imported inside core bypassing the adapter boundary
  ruling: killed
  rationale: core must reach a forge only through an adapter port
  evidence:
    - pr#12
`;

const COINCIDENCE_EVIDENCE: readonly [ProvenanceRef, ...ProvenanceRef[]] = [
  'pr#77 (human overturned the match)',
];

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Retrieval (spec 03 §7 steps 1-2)
// ---------------------------------------------------------------------------

describe('retrieval ranks the killed corpus against the diff', () => {
  it('tokenizes and scores by Jaccard overlap', () => {
    expect(tokenize('reqwest inside core').has('reqwest')).toBe(true);
    expect(tokenize('a x 1 core').has('a')).toBe(false); // length-1 tokens dropped
    expect(jaccard(tokenize('reqwest core'), tokenize('reqwest core'))).toBe(1);
    expect(jaccard(tokenize('reqwest'), tokenize('serde'))).toBe(0);
  });

  it('surfaces a killed precedent whose pattern overlaps the diff, with its matched hunks', () => {
    const candidates = retrieveCandidates([KILLED], REINTRODUCING);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.precedent.id).toBe('PRE-001');
    expect(candidates[0]?.score).toBeGreaterThan(0);
    expect(candidates[0]?.matchedHunks).toEqual(REINTRODUCING);
  });

  it('returns nothing when the diff shares no vocabulary with any pattern', () => {
    const inert = [hunk('src/core/y.rs', 1, ['+let total = 1;'])];
    expect(retrieveCandidates([KILLED], inert)).toEqual([]);
  });

  it('ignores non-killed precedents — an affirmed law is not a regression pattern', () => {
    expect(retrieveCandidates([AFFIRMED], REINTRODUCING)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Confirmation + PRE-id enforcement (spec 03 §7 step 3, INV-004)
// ---------------------------------------------------------------------------

describe('a same-mechanism match confirmed with a PRE-id → regression', () => {
  const goodRuling = {
    assertion: 'INV-005',
    verdict: 'regression',
    severity: 'breach',
    evidence: ['src/core/http.rs:41-46'],
    precedent: 'PRE-001',
    rationale: 'the exact killed mechanism returns: an HTTP client constructed inside core',
  };

  it('interpretConfirmation accepts it', () => {
    const c = interpretConfirmation(KILLED, REINTRODUCING, goodRuling);
    expect(c.kind).toBe('regression');
    if (c.kind !== 'regression') throw new Error('narrowing');
    expect(c.verdict.precedent).toBe('PRE-001');
    expect(c.verdict.severity).toBe('breach');
  });

  it('runRegression retrieves, confirms and returns the regression', async () => {
    const result = await runRegression(
      { hunks: REINTRODUCING, precedents: [KILLED] },
      { confirmer: cannedConfirmer(goodRuling) },
    );
    expect(result.outcome.kind).toBe('regression');
    if (result.outcome.kind !== 'regression') throw new Error('narrowing');
    expect(result.outcome.verdict.precedent).toBe('PRE-001');
    expect(result.candidates[0]?.precedent.id).toBe('PRE-001');
  });

  it('works through an injected typed Judge + the real sealEvidence (confirmerFromJudge)', async () => {
    const sealer: RegressionSealer = {
      seal: (precedent, hunks) =>
        sealEvidence({
          assertion: {
            id: A5,
            statement: 'Engine core imports no forge-specific APIs',
            class: 'dependency',
            scope: [glob('src/core/**')],
          },
          charterExcerpt: 'core reaches a forge only through an adapter port',
          hunks,
          ring: 'hunk' as const,
          precedent,
        }),
    };
    // A blind typed magistrate: it sees only the sealed bundle and rules a regression citing the
    // precedent it was actually shown, with a span inside the shown hunks.
    const judge: Judge = (sealed: SealedEvidence): Verdict => {
      const pv = sealed.bundle.precedent;
      if (pv === null) throw new Error('the confirming bundle must carry the candidate precedent');
      return unwrap(
        decodeVerdict({
          assertion: 'INV-005',
          verdict: 'regression',
          severity: 'breach',
          evidence: ['src/core/http.rs:41-46'],
          precedent: pv.id,
          rationale: 'same mechanism, cited from the shown hunks',
        }),
      );
    };
    const confirmer = confirmerFromJudge(judge, sealer);

    const result = await runRegression(
      { hunks: REINTRODUCING, precedents: [KILLED] },
      { confirmer },
    );
    expect(result.outcome.kind).toBe('regression');
    if (result.outcome.kind !== 'regression') throw new Error('narrowing');
    expect(result.outcome.verdict.precedent).toBe('PRE-001');
  });
});

describe('a confirm without a PRE-id is rejected (case law works by citation)', () => {
  it('interpretConfirmation rejects a regression carrying no precedent', () => {
    const ruling = {
      assertion: 'INV-005',
      verdict: 'regression',
      severity: 'breach',
      evidence: ['src/core/http.rs:41'],
      rationale: 'looks like the killed pattern',
      // precedent deliberately omitted
    };
    const c = interpretConfirmation(KILLED, REINTRODUCING, ruling);
    expect(c.kind).toBe('rejected');
    if (c.kind !== 'rejected') throw new Error('narrowing');
    expect(c.errors.some((e) => e.code === 'missing-precedent')).toBe(true);
  });

  it('runRegression surfaces the rejection rather than emitting a regression', async () => {
    const ruling = {
      assertion: 'INV-005',
      verdict: 'regression',
      severity: 'breach',
      evidence: ['src/core/http.rs:41'],
      rationale: 'no precedent cited',
    };
    const result = await runRegression(
      { hunks: REINTRODUCING, precedents: [KILLED] },
      { confirmer: cannedConfirmer(ruling) },
    );
    expect(result.outcome.kind).toBe('rejected');
  });

  it('rejects a regression citing the WRONG precedent', () => {
    const ruling = {
      assertion: 'INV-005',
      verdict: 'regression',
      severity: 'breach',
      evidence: ['src/core/http.rs:41'],
      precedent: 'PRE-999',
      rationale: 'cites a precedent that was not the one retrieved',
    };
    const c = interpretConfirmation(KILLED, REINTRODUCING, ruling);
    expect(c.kind).toBe('rejected');
    if (c.kind !== 'rejected') throw new Error('narrowing');
    expect(c.errors.some((e) => e.code === 'missing-precedent')).toBe(true);
  });

  it('rejects a regression citing lines outside the shown hunks — hallucinated evidence', () => {
    const ruling = {
      assertion: 'INV-005',
      verdict: 'regression',
      severity: 'breach',
      evidence: ['src/core/http.rs:900-905'], // far outside the 41-46 hunk
      precedent: 'PRE-001',
      rationale: 'cites lines it was never shown',
    };
    const c = interpretConfirmation(KILLED, REINTRODUCING, ruling);
    expect(c.kind).toBe('rejected');
    if (c.kind !== 'rejected') throw new Error('narrowing');
    expect(c.errors.some((e) => e.code === 'invalid-citation')).toBe(true);
  });

  it('citationsWithinHunks is the mechanical gate', () => {
    expect(citationsWithinHunks(REINTRODUCING, [cite('src/core/http.rs:44')])).toBe(true);
    expect(citationsWithinHunks(REINTRODUCING, [cite('src/core/http.rs:5')])).toBe(false);
    expect(citationsWithinHunks(REINTRODUCING, [cite('src/core/other.rs:44')])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lookalike → coincidence tombstone (spec 03 §7, spec 04 §6)
// ---------------------------------------------------------------------------

describe('a superficial lookalike → aligned/abstain and a coincidence tombstone', () => {
  it('runRegression classifies the lookalike and proposes a .program/precedents.yaml diff', async () => {
    const result = await runRegression(
      { hunks: LOOKALIKE_DIFF, precedents: [KILLED] },
      {
        confirmer: cannedConfirmer({ assertion: 'INV-005', verdict: 'aligned', confidence: 0.9 }),
        retrieval: { minScore: 0 }, // surface the thin token overlap ("boundary")
        coincidence: {
          nextId: pre('PRE-002'),
          evidence: COINCIDENCE_EVIDENCE,
          existingPrecedentsYaml: EXISTING_PRECEDENTS_YAML,
        },
      },
    );
    expect(result.outcome.kind).toBe('lookalike');
    if (result.outcome.kind !== 'lookalike') throw new Error('narrowing');
    expect(result.outcome.verdict.verdict).toBe('aligned');

    const tombstone = result.outcome.tombstone;
    expect(tombstone).not.toBeNull();
    expect(tombstone?.precedent.ruling).toBe('coincidence');
    expect(tombstone?.precedent.id).toBe('PRE-002');
    expect(tombstone?.path).toBe('.program/precedents.yaml');
    expect(tombstone?.diff).toContain('+  ruling: coincidence');
    expect(tombstone?.diff).toContain('+- id: PRE-002');
    expect(tombstone?.diff).toContain('PRE-001'); // the tombstone's pattern references the match
  });

  it('proposeCoincidence renders a tombstone (spec 04 §6) as a standalone artifact', () => {
    const proposed = unwrap(
      proposeCoincidence({
        candidate: KILLED,
        verdict: { assertion: A5, verdict: 'abstain' },
        context: {
          nextId: pre('PRE-002'),
          evidence: COINCIDENCE_EVIDENCE,
          existingPrecedentsYaml: EXISTING_PRECEDENTS_YAML,
        },
      }),
    );
    expect(proposed.precedent.ruling).toBe('coincidence');
    expect(proposed.precedent.pattern).toContain('Lookalike of PRE-001');
    expect(proposed.precedent.evidence).toEqual(COINCIDENCE_EVIDENCE);
    expect(proposed.rationale).toContain('coincidence');
  });

  it('the tombstone diff is REAL: `git apply --check` accepts it in a throwaway repo', () => {
    const proposed = unwrap(
      proposeCoincidence({
        candidate: KILLED,
        verdict: { assertion: A5, verdict: 'aligned' },
        context: {
          nextId: pre('PRE-002'),
          evidence: COINCIDENCE_EVIDENCE,
          existingPrecedentsYaml: EXISTING_PRECEDENTS_YAML,
        },
      }),
    );

    const dir = mkdtempSync(join(tmpdir(), 'gwtp-regression-'));
    tempDirs.push(dir);
    execFileSync('git', ['-C', dir, 'init', '-q']);
    mkdirSync(join(dir, '.program'), { recursive: true });
    writeFileSync(join(dir, '.program', 'precedents.yaml'), EXISTING_PRECEDENTS_YAML, 'utf8');
    const patch = join(dir, 'tombstone.patch');
    writeFileSync(patch, proposed.diff, 'utf8');

    expect(() => execFileSync('git', ['-C', dir, 'apply', '--check', patch])).not.toThrow();
  });

  it('carries no tombstone when the caller supplies no sighted context', async () => {
    const result = await runRegression(
      { hunks: LOOKALIKE_DIFF, precedents: [KILLED] },
      {
        confirmer: cannedConfirmer({ assertion: 'INV-005', verdict: 'abstain' }),
        retrieval: { minScore: 0 },
      },
    );
    expect(result.outcome.kind).toBe('lookalike');
    if (result.outcome.kind !== 'lookalike') throw new Error('narrowing');
    expect(result.outcome.tombstone).toBeNull();
  });
});

describe('wholeFileReplaceDiff and the no-candidate path', () => {
  it('emits a valid unified-diff header with exact line counts', () => {
    const diff = wholeFileReplaceDiff('.program/precedents.yaml', '[]\n', 'a\nb\n');
    expect(diff).toContain('--- a/.program/precedents.yaml');
    expect(diff).toContain('+++ b/.program/precedents.yaml');
    expect(diff).toContain('@@ -1,1 +1,2 @@');
    expect(diff).toContain('-[]');
    expect(diff).toContain('+a');
    expect(diff).toContain('+b');
  });

  it('confirms nothing when retrieval finds no candidate — the confirmer is never called', async () => {
    let called = false;
    const result = await runRegression(
      { hunks: REINTRODUCING, precedents: [] },
      {
        confirmer: {
          confirm: async () => {
            called = true;
            return {};
          },
        },
      },
    );
    expect(result.outcome.kind).toBe('no-candidate');
    expect(called).toBe(false);
  });
});
