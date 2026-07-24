// THE ROADMAP v0 EXIT TEST.
//
// ROADMAP.md, v0 — The sighted repo: "**Exit test:** this repo runs it on itself; a staged
// INV-005 breach accumulates and files."
// seeds/SEED-02-ledger-engine.md, Acceptance: "A synthetic event stream crosses budget and files
// a correctly-bundled issue; a rejected proposal path writes an `affirmed` precedent and raises
// precision."
//
// This file asserts that sentence, end to end, against real git and the real constitution:
//
//   1. a THROWAWAY repository under $TMPDIR is seeded with a byte-for-byte copy of this repo's
//      `.program/` and a `src/core/` file that genuinely breaches INV-005;
//   2. the deterministic import-boundary judge (src/judge/deterministic/imports.ts) rules on
//      every commit through `sealEvidence`, producing real drift and aligned verdicts;
//   3. those verdicts are minted into ledger events whose committer times are spread so the
//      leaky integrator genuinely crosses INV-005's ratified budget of 3.0 — the arithmetic is
//      hand-computed in `V0_ARITHMETIC` and asserted here against a calculator, not against
//      whatever the code happened to produce;
//   4. the events are appended to `refs/program/ledger` in the throwaway repo, folded, the
//      firing detected, dispersion computed from real git authorship, the proposal classified,
//      rendered and delivered through a FAKE `DeliveryPort` that captures the bundle;
//   5. the rejected-proposal path produces an `affirmed` precedent and a precision raise as
//      PROPOSED diffs — which `git apply` accepts against the fixture's `.program/`, and which
//      nothing writes;
//   6. the whole thing runs a SECOND time and converges: no duplicate events, no second issue,
//      a byte-identical bundle, an unmoved ledger ref.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  THE REPOSITORY THIS TEST IS CHECKED INTO IS NEVER WRITTEN.
//
//  Every git write happens under $TMPDIR. `.program/` here is opened read-only and its bytes are
//  hashed before and after the run; `refs/program/ledger` is asserted absent from this
//  repository at the end. A governance test that governed its own repository by writing to it
//  would have failed the first invariant it claims to check.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// The pipeline lives in `scripts/demo-v0.ts` and is imported here, the same way
// `tests/check-inv001.test.ts` and `tests/check-inv003.test.ts` import their subjects from
// `scripts/`. One implementation, two callers: a demo a human runs and reads, and this.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertBlind,
  citationsWithinBundle,
  deliveryKeyParts,
  findDeliveryMarker,
  isViolation,
  isViolationEvent,
  parseAssertionId,
  parsePathGlob,
  parseRepoPath,
  sealEvidence,
  sha256RefHex,
  unwrap,
  verifyEventId,
  type Hunk,
  type SealedEvidence,
} from '../src/core/index.js';
import {
  FORGE_MODULE_PATTERNS,
  IMPORT_BOUNDARY_JUDGE,
  IMPORT_FORM_SEVERITY,
  findForgeImports,
  forgeModuleOf,
  judgeImportBoundary,
  postImageLines,
} from '../src/judge/deterministic/imports.js';
import {
  githubIssueDelivery,
  type GitHubIssuesClient,
} from '../src/adapters/github/issues.js';
import {
  BREACH_AUTHOR,
  CLEAN_AUTHOR,
  FIXTURE_IDENTITY_STRINGS,
  STAGED_COMMITS,
  TARGET_ASSERTION,
  V0_ARITHMETIC,
  capturingDelivery,
  parseUnifiedDiff,
  runV0Pipeline,
  stageInv005BreachRepo,
  type CapturingDeliveryPort,
  type V0Run,
} from '../scripts/demo-v0.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROGRAM_DIR = join(REPO_ROOT, '.program');

/** Real git subprocesses, a fold, and a dispersion resolution. Vitest's 5s default measures the machine. */
const E2E_TIMEOUT = 180_000;

// ---------------------------------------------------------------------------
// The one thing read from THIS repository, and the proof it stayed read-only
// ---------------------------------------------------------------------------

function fingerprintProgramDir(): string {
  const parts: string[] = [];
  for (const entry of readdirSync(PROGRAM_DIR).sort()) {
    parts.push(`${entry}:${createHash('sha256').update(readFileSync(join(PROGRAM_DIR, entry))).digest('hex')}`);
  }
  return parts.join('\n');
}

function hostGit(args: readonly string[]): string {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

const PROGRAM_BEFORE = fingerprintProgramDir();
const HOST_LOG_BEFORE = hostGit(['log', '--oneline']).trim();
const HOST_STATUS_BEFORE = hostGit(['status', '--porcelain', '--', '.program']).trim();
// The commit COUNT captured before the run, not a hard-coded number: the invariant is "the engine
// added nothing to its own repo", which is a delta from the baseline. A literal count would break
// the moment a commit lands OR under a shallow CI checkout (actions/checkout is depth-1, so
// rev-list --count is 1, not the history's true length).
const HOST_COUNT_BEFORE = hostGit(['rev-list', '--count', 'HEAD']).trim();

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

let repoDir = '';
let port: CapturingDeliveryPort;
let first: V0Run;
let second: V0Run;

beforeAll(async () => {
  const staged = stageInv005BreachRepo(PROGRAM_DIR);
  repoDir = staged.dir;
  port = capturingDelivery();
  first = await runV0Pipeline({ repoDir, port });
  second = await runV0Pipeline({ repoDir, port });
}, E2E_TIMEOUT);

afterAll(() => {
  if (repoDir !== '') rmSync(repoDir, { recursive: true, force: true });
});

function fixtureGit(args: readonly string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 0. The deterministic judge, in isolation
//    (a slice of SEED-03 — see the module header of src/judge/deterministic/imports.ts)
// ═══════════════════════════════════════════════════════════════════════════════════════════

const glob = (s: string) => unwrap(parsePathGlob(s));
const rp = (s: string) => unwrap(parseRepoPath(s));

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

/** A sealed bundle for the judge's unit tests. The seal is the real one — nothing bypasses it. */
function sealFixture(
  hunks: readonly Hunk[],
  klass: 'dependency' | 'boundary' = 'dependency',
): SealedEvidence {
  return unwrap(
    sealEvidence({
      assertion: {
        id: unwrap(parseAssertionId('INV-005')),
        statement: 'Engine core imports no forge-specific APIs; GitHub access lives in adapters/',
        class: klass,
        scope: [glob('src/core/**')],
      },
      charterExcerpt: 'fixture charter excerpt',
      hunks,
      ring: 'hunk' as const,
      precedent: null,
    }),
  );
}

describe('the deterministic import-boundary judge (a slice of SEED-03)', () => {
  it('recognises a forge module by scope, by exact name and by adapter directory — and nothing else', () => {
    expect(forgeModuleOf('@octokit/rest')?.id).toBe('octokit-scope');
    expect(forgeModuleOf('@actions/github')?.id).toBe('actions-toolkit');
    expect(forgeModuleOf('octokit')?.id).toBe('octokit');
    expect(forgeModuleOf('@gitbeaker/rest')?.id).toBe('gitbeaker-scope');
    expect(forgeModuleOf('../adapters/github/issues.js')?.id).toBe('adapters-directory');

    // Conservative in the other direction: none of these talks to a forge.
    expect(forgeModuleOf('node:crypto')).toBeNull();
    expect(forgeModuleOf('yaml')).toBeNull();
    expect(forgeModuleOf('github-slugger')).toBeNull();
    expect(forgeModuleOf('github-flavored-markdown')).toBeNull();
    expect(forgeModuleOf('gitlab-ci-local')).toBeNull();
    expect(forgeModuleOf('./adapter-notes.js')).toBeNull();
    expect(forgeModuleOf('../core/delivery.js')).toBeNull();
  });

  it('every pattern carries a stable id and a truthful reason — it is reviewed as law, not as code', () => {
    const ids = FORGE_MODULE_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of FORGE_MODULE_PATTERNS) {
      expect(p.why.length, `${p.id} has no rationale`).toBeGreaterThan(40);
      expect(p.value.length).toBeGreaterThan(0);
    }
  });

  it('maps import FORM onto ADR-0005 anchors, worst rung wins', () => {
    expect(IMPORT_FORM_SEVERITY).toEqual({
      'type-only': 'grazes',
      dynamic: 'bends',
      value: 'breach',
      're-export': 'entrenches',
    });

    const forms = hunk('src/core/x.ts', 1, [
      `+import type { Octokit } from '@octokit/rest';`,
      `+const gh = await import('@actions/github');`,
      `+import { RequestError } from '@octokit/request-error';`,
      `+export { Octokit } from 'octokit';`,
    ]);
    expect(findForgeImports([forms]).map((o) => [o.line, o.form, o.severity])).toEqual([
      [1, 'type-only', 'grazes'],
      [2, 'dynamic', 'bends'],
      [3, 'value', 'breach'],
      [4, 're-export', 'entrenches'],
    ]);
  });

  it('numbers the post-image, ignores removed lines, and only reports lines the diff ADDED', () => {
    const h = hunk('src/core/x.ts', 10, [
      ` import { createHash } from 'node:crypto';`,
      `-import { old } from './old.js';`,
      `+import { Octokit } from '@octokit/rest';`,
      ` export const x = 1;`,
    ]);
    expect(postImageLines(h).map((l) => [l.n, l.added])).toEqual([
      [10, false],
      [11, true],
      [12, false],
    ]);
    expect(findForgeImports([h]).map((o) => o.line)).toEqual([11]);

    // The same forge import riding along as CONTEXT is not something this diff did.
    const contextOnly = hunk('src/core/x.ts', 10, [
      ` import { Octokit } from '@octokit/rest';`,
      `+export const y = 2;`,
    ]);
    expect(findForgeImports([contextOnly])).toEqual([]);
  });

  it('reads a multi-line import statement, and cites the line that names the module', () => {
    const h = hunk('src/core/x.ts', 5, [
      `+import {`,
      `+  Octokit,`,
      `+} from '@octokit/rest';`,
    ]);
    expect(findForgeImports([h]).map((o) => [o.line, o.form])).toEqual([[7, 'value']]);
  });

  it('takes SealedEvidence and returns a Verdict — the one signature every rung implements', () => {
    const breach = judgeImportBoundary(
      sealFixture([hunk('src/core/x.ts', 1, [`+import { Octokit } from '@octokit/rest';`])]),
    );
    expect(breach.verdict).toBe('drift');
    if (!isViolation(breach)) throw new Error('narrowing');
    expect(breach.severity).toBe('breach');
    expect(breach.evidence.map((c) => c.source)).toEqual(['src/core/x.ts:1']);
    expect(breach.rationale).toContain('octokit-scope');
    // The rationale is a pure function of the diff: it is hashed into the event id (spec 02 §1).
    expect(
      judgeImportBoundary(
        sealFixture([hunk('src/core/x.ts', 1, [`+import { Octokit } from '@octokit/rest';`])]),
      ),
    ).toEqual(breach);

    const clean = judgeImportBoundary(
      sealFixture([hunk('src/core/x.ts', 1, [`+import { createHash } from 'node:crypto';`])]),
    );
    expect(clean.verdict).toBe('aligned');
    expect(clean.severity).toBeUndefined();
    expect(clean.rationale).toBeUndefined();
  });

  it('abstains rather than inventing a compliance — out of scope, or out of jurisdiction', () => {
    const outOfScope = judgeImportBoundary(
      sealFixture([hunk('docs/notes.md', 1, [`+import { Octokit } from '@octokit/rest';`])]),
    );
    expect(outOfScope.verdict).toBe('abstain');

    const wrongClass = judgeImportBoundary(
      sealFixture([hunk('src/core/x.ts', 1, [`+import { Octokit } from '@octokit/rest';`])], 'boundary'),
    );
    expect(wrongClass.verdict).toBe('abstain');
    expect(wrongClass.rationale).toContain('class: dependency');
  });

  it('reads `git show` output into hunks, including a new file and a `\\ No newline` marker', () => {
    const hunks = parseUnifiedDiff(
      [
        'diff --git a/src/core/forge.ts b/src/core/forge.ts',
        'new file mode 100644',
        'index 0000000..1111111',
        '--- /dev/null',
        '+++ b/src/core/forge.ts',
        '@@ -0,0 +1,2 @@',
        `+import { Octokit } from '@octokit/rest';`,
        '+export const clients = 1;',
        '\\ No newline at end of file',
      ].join('\n'),
    );
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.path).toBe('src/core/forge.ts');
    expect(hunks[0]?.newStart).toBe(1);
    expect(hunks[0]?.newLines).toBe(2);
    expect(findForgeImports(hunks).map((o) => o.line)).toEqual([1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. The staged breach and the verdicts it produces
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('the staged INV-005 breach', () => {
  it('lives in a throwaway repository under $TMPDIR, with a verbatim copy of the constitution', () => {
    expect(repoDir).not.toBe(REPO_ROOT);
    expect(repoDir.startsWith(REPO_ROOT)).toBe(false);
    for (const entry of readdirSync(PROGRAM_DIR).sort()) {
      expect(
        readFileSync(join(repoDir, '.program', entry), 'utf8'),
        `${entry} in the fixture differs from the real constitution`,
      ).toBe(readFileSync(join(PROGRAM_DIR, entry), 'utf8'));
    }
  });

  it('folds against INV-005 as RATIFIED — precision 0.9, budget 3.0, half_life 120d', () => {
    // Q-38's rule: assert the RELATION, and let the constitution supply the numbers. If a human
    // amends INV-005's knobs, this test must fail loudly rather than keep asserting stale ones.
    expect(first.assertion.id).toBe(TARGET_ASSERTION);
    expect(first.assertion.status).toBe('ratified');
    expect(first.assertion.class).toBe('dependency');
    expect(first.assertion.enforcement).toBe('deterministic');
    expect(first.assertion.precision as number).toBe(V0_ARITHMETIC.precision);
    expect(first.assertion.budget as number).toBe(V0_ARITHMETIC.budget);
    expect(first.assertion.half_life.source).toBe(V0_ARITHMETIC.halfLife);
    expect(first.knobs.precisionOverride, 'the exit test must fold on frozen precision_at').toBeNull();
  });

  it('produces the verdict each staged commit was designed to earn', () => {
    expect(first.judged.map((j) => [j.label, j.verdict.verdict])).toEqual(
      STAGED_COMMITS.map((c) => [c.label, c.expect]),
    );
  });

  it('rules every breach `breach` (0.75) and cites a line span inside a hunk it was shown', () => {
    const violations = first.judged.filter((j) => isViolation(j.verdict));
    expect(violations).toHaveLength(V0_ARITHMETIC.violations);

    for (const j of violations) {
      const v = j.verdict;
      if (!isViolation(v)) throw new Error('narrowing');
      expect(v.verdict).toBe('drift');
      expect(v.severity, `${j.label} is not on the breach rung`).toBe('breach');
      expect(v.evidence.length).toBeGreaterThan(0);
      for (const c of v.evidence) expect(c.path).toBe('src/core/forge.ts');

      // INV-004 made mechanical: every cited span lies inside a hunk the judge actually saw.
      const bundle = unwrap(
        sealEvidence({
          assertion: {
            id: first.assertion.id,
            statement: first.assertion.statement,
            class: first.assertion.class,
            scope: first.assertion.scope,
          },
          charterExcerpt: '',
          hunks: j.scoped,
          ring: 'hunk' as const,
          precedent: null,
        }),
      );
      expect(citationsWithinBundle(bundle, v.evidence), `${j.label} cites outside its bundle`).toBe(
        true,
      );
    }
  });

  it('abstains rather than claiming compliance when nothing is in scope', () => {
    const base = first.judged.find((j) => j.label === 'base');
    expect(base?.verdict.verdict).toBe('abstain');
    expect(base?.scoped).toEqual([]);
    // spec 02 §4: abstain never accumulates. An `aligned` here would have inflated the
    // compliance ratio the proposal ships as evidence quality.
    expect(first.abstentionCount).toBe(V0_ARITHMETIC.abstentions);
  });

  it('mints one content-addressed, hash-verified ledger event per verdict', () => {
    for (const j of first.judged) {
      expect(unwrap(verifyEventId(j.event))).toBe(true);
      expect(j.event.judge).toEqual(IMPORT_BOUNDARY_JUDGE);
      expect(j.event.assertion).toBe(TARGET_ASSERTION);
      expect(j.event.t).toBe(j.t);
      expect(j.event.subject.commit).toBe(j.sha);
      // ADR-0003 at the storage level: the persisted record has no author field, and no slot
      // for one. `EventSubject` is commit | pr | path, and nothing else.
      expect(Object.keys(j.event.subject)).toEqual(['commit']);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. The accumulator crosses budget — the arithmetic, checked against a calculator
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('the leaky integrator crosses INV-005’s budget (spec 02 §4)', () => {
  it('spreads the breaching events exactly 10 committer-days apart (ADR-0004)', () => {
    const violating = first.judged.filter((j) => isViolationEvent(j.event));
    const millis = violating.map((j) => Date.parse(j.t));
    for (let i = 1; i < millis.length; i += 1) {
      expect((millis[i] as number) - (millis[i - 1] as number)).toBe(
        V0_ARITHMETIC.stepDays * 86_400_000,
      );
    }
  });

  it('crosses 3.0 at the fifth event and not before — A₄ = 2.481077, A₅ = 3.016825', () => {
    // A ← A · 2^(−Δt/half_life) + precision_at · severity, with increment 0.9 × 0.75 = 0.675
    // and 2^(−10/120) = 0.943874312681694. See `V0_ARITHMETIC` for the full derivation.
    expect(first.meter.withoutTriggeringEvent).toBeCloseTo(V0_ARITHMETIC.meterBeforeFiring, 6);
    expect(first.meter.withoutTriggeringEvent).toBeLessThan(V0_ARITHMETIC.budget);
    expect(first.meter.atFiring).toBeCloseTo(V0_ARITHMETIC.meterAtFiring, 6);
    expect(first.meter.atFiring).toBeGreaterThanOrEqual(V0_ARITHMETIC.budget);
  });

  it('is genuinely decayed — the undecayed sum would have been 3.375', () => {
    // If the decay term ever silently stopped being applied, this is the assertion that notices:
    // five increments of 0.675 land on 3.375, and the meter must read strictly less than that.
    expect(V0_ARITHMETIC.violations * V0_ARITHMETIC.increment).toBeCloseTo(
      V0_ARITHMETIC.undecayedTotal,
      9,
    );
    expect(first.meter.atFiring).toBeLessThan(V0_ARITHMETIC.undecayedTotal);
    expect(V0_ARITHMETIC.undecayedTotal - first.meter.atFiring).toBeCloseTo(0.358175, 6);
  });

  it('counts compliances without paying the meter down — decay is the only forgiveness', () => {
    expect(first.violationCount).toBe(V0_ARITHMETIC.violations);
    expect(first.complianceCount).toBe(V0_ARITHMETIC.compliances);
    // Every contributing event still carries its FULL undecayed weight as `rawWeight`; only the
    // residual share has decayed. Three aligned events subtracted exactly nothing.
    for (const c of first.contributing) expect(c.rawWeight).toBeCloseTo(V0_ARITHMETIC.increment, 9);
  });

  it('fires exactly once — hysteresis, not reset (spec 02 §6)', () => {
    expect(first.fold.firings).toHaveLength(1);
    expect(first.firings).toHaveLength(1);
    expect(first.firing.key).toBe(TARGET_ASSERTION);
    expect(first.firing.triggeredBy).toBe(
      first.judged.filter((j) => isViolationEvent(j.event)).at(-1)?.event.event,
    );
    expect(first.contributing).toHaveLength(V0_ARITHMETIC.violations);
  });

  it('wrote the ledger to refs/program/ledger in the THROWAWAY repo, and nowhere else', () => {
    expect(fixtureGit(['rev-parse', 'refs/program/ledger']).trim()).toBe(first.ledgerTip);
    const tree = fixtureGit(['ls-tree', '-r', '--name-only', 'refs/program/ledger']).trim().split('\n');
    expect(tree.every((p) => p.startsWith('events/'))).toBe(true);
    expect(tree).toHaveLength(first.ledgerEventCount);
    // The ledger ref is its own commit chain, invisible to branch listings (spec 02 §1).
    expect(fixtureGit(['branch', '--list']).includes('program')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. Dispersion decides direction, and the bundle is correctly assembled
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('dispersion decides direction (spec 02 §5)', () => {
  it('classifies `refactor`, because ALL THREE reprogram conjuncts fail', () => {
    // spec 02 §5's table: "low author/path entropy, tight window" → the code is wrong.
    // `classifyFiring` is a conjunction, so name each conjunct rather than only the conclusion —
    // a test that asserted `refactor` alone would still pass if the classifier were inverted and
    // the fixture happened to be dispersed.
    expect(first.dispersion.distinctAuthors).toBe(1);
    expect(first.dispersion.authorEntropyNormalized).toBe(0);
    expect(first.dispersion.distinctPaths).toBe(1);
    expect(first.dispersion.pathEntropyNormalized).toBe(0);
    expect(first.dispersion.spanMs).toBe(40 * 86_400_000);
    expect(first.dispersion.spanMs).toBeLessThan(60 * 86_400_000);

    expect(first.kind).toBe('refactor');
    expect(first.assembled.policyStatus).toBe('provisional');
    // A refactor argues with the code, so it ships NO `.program/` patch (spec 02 §5).
    expect(first.amendment).toBeNull();
    expect(first.document.patches).toEqual([]);
  });

  it('reports the compliance ratio as evidence quality, never as a discount', () => {
    expect(first.dispersion.complianceRatio).toBeCloseTo(3 / 8, 9);
    expect(first.dispersion.eventCount).toBe(V0_ARITHMETIC.violations);
  });

  it('records the firing as an event carrying only the dispersion SNAPSHOT — four numbers', () => {
    const snapshot = first.assembled.event.dispersion_snapshot;
    expect(snapshot).toBeDefined();
    expect(Object.keys(snapshot ?? {}).sort()).toEqual([
      'author_entropy',
      'compliance_ratio',
      'path_entropy',
      'time_spread',
    ]);
    expect(snapshot?.author_entropy).toBe(0);
    expect(first.assembled.event.verdict).toBe('abstain');
    expect(unwrap(verifyEventId(first.assembled.event))).toBe(true);
  });
});

describe('the rendered bundle ships its evidence (spec 02 §5)', () => {
  it('names the assertion, its statement, its scope and its provenance', () => {
    expect(first.document.title).toContain(TARGET_ASSERTION);
    expect(first.document.body).toContain(first.assertion.statement);
    expect(first.document.body).toContain('`src/core/**`');
    expect(first.document.body).toContain('status: ratified');
    for (const p of first.assertion.provenance) expect(first.document.body).toContain(p);
  });

  it('lists every contributing event, with its raw weight and its residual share', () => {
    for (const c of first.contributing) {
      const short = sha256RefHex(c.event).slice(0, 12);
      expect(first.document.body, `contributing event ${short} is missing from the bundle`).toContain(
        short,
      );
      expect(first.document.body).toContain(c.t);
    }
    expect(first.document.body).toContain('| decay-weighted total at firing | **3.017** |');
    expect(first.document.body).toContain('| budget | 3.000 |');
  });

  it('publishes the dispersion statistics', () => {
    expect(first.document.body).toContain('## Dispersion (spec 02 §5)');
    expect(first.document.body).toContain('author entropy');
    expect(first.document.body).toContain('path entropy');
    expect(first.document.body).toContain('time spread');
    expect(first.document.body).toContain('compliance ratio');
    expect(first.document.body).toContain('37.5%');
    expect(first.document.body).toContain('40d 0h');
  });

  it('carries the replay command, so the firing is reproducible from the event set alone', () => {
    expect(first.document.body).toContain(
      'gwtp ledger replay --key INV-005 --half-life 120d --budget 3',
    );
    expect(first.document.body).toContain('knobs digest');
  });

  it('ships a replay command the CLI actually accepts and that reproduces the firing', () => {
    // spec 02 §5 wants "a command that reproduces the firing", not a string that looks like one.
    // Extract the emitted line, run it against the throwaway ledger, and require a clean exit — a
    // bundle carrying a flag the CLI rejects (the --assertion/--rearm bug) fails HERE, loudly.
    const line = first.document.body
      .split('\n')
      .map((l) => l.trim().replace(/^[`$\s]+|[`\s]+$/g, ''))
      .find((l) => l.startsWith('gwtp ledger replay'));
    expect(line, 'the bundle must carry a replay command line').toBeTruthy();

    const args = (line as string).split(/\s+/).slice(1); // drop the `gwtp` argv[0]
    const out = execFileSync('npx', ['tsx', 'src/cli/index.ts', ...args, '--repo', repoDir, '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const replay = JSON.parse(out);
    // Re-folding under the emitted knobs must reproduce the recorded firing: the target
    // accumulator is present in the comparison and still fired at least once.
    const target = (replay.comparison ?? []).find(
      (c: { key?: string }) => c.key === TARGET_ASSERTION,
    );
    expect(target, 'replay output must mention the fired accumulator').toBeTruthy();
    expect(target.recorded?.firings, 'the replay must reproduce the firing').toBeGreaterThanOrEqual(1);
  }, E2E_TIMEOUT);

  it('carries its own delivery marker, which is the assertion plus the firing event id', () => {
    const marker = findDeliveryMarker(first.document.body);
    expect(marker).toBe(first.document.key);
    const parts = deliveryKeyParts(first.document.key);
    expect(parts?.assertion).toBe(TARGET_ASSERTION);
    expect(parts?.eventHex).toBe(sha256RefHex(first.firing.triggeredBy));
  });

  it('NAMES NO AUTHOR — anywhere (INV-003, ADR-0003)', () => {
    // The load-bearing assertion of the whole exit test. The dispersion statistics were computed
    // from loci that really do carry a name and an email address; not one character of either
    // may survive into what gets filed.
    const surface = [
      first.document.title,
      first.document.body,
      first.document.key,
      first.document.labels.join(' '),
      ...first.document.patches.map((p) => `${p.path}\n${p.diff}`),
    ].join('\n');

    for (const identity of FIXTURE_IDENTITY_STRINGS) {
      expect(surface.includes(identity), `the bundle names \`${identity}\``).toBe(false);
    }
    expect(surface.includes(BREACH_AUTHOR.email)).toBe(false);
    expect(surface.includes(CLEAN_AUTHOR.name)).toBe(false);

    // …and the structural half: no sentencing VALUE and no forbidden field NAME anywhere in the
    // document object, checked by the same runtime walk `sealEvidence` uses.
    expect(() => {
      assertBlind(first.document);
    }).not.toThrow();
  });

  it('reaches the fake DeliveryPort as one created document', () => {
    expect(first.receipt.status).toBe('created');
    expect(first.receipt.channel).toBe('capture');
    expect(port.created).toHaveLength(1);
    expect(port.created[0]?.document.body).toBe(first.document.body);
  });

  it('files through the REAL GitHub issue adapter — the SAME bundle, idempotently (SEED-02 deliverable 3)', async () => {
    // The v0 acceptance is "open a GitHub issue via the adapter containing the full evidence
    // bundle". The pipeline delivers through a capture:// double, so this case takes the very
    // document that crossed budget and hands it to `githubIssueDelivery` — the shipping adapter —
    // over an in-memory fake HTTP client, and asserts what gets FILED is that bundle, that the
    // filed issue names no author, and that a second delivery of the same firing dedupes.
    const created: { title: string; body: string; labels: readonly string[] }[] = [];
    const stored: { number: number; body: string }[] = [];
    const client: GitHubIssuesClient = {
      async findByMarker(marker) {
        return stored
          .filter((i) => i.body.includes(marker))
          .map((i) => ({ number: i.number, url: '' }));
      },
      async create(input) {
        created.push(input);
        const number = stored.length + 1;
        stored.push({ number, body: input.body });
        return { number, url: '' };
      },
    };
    const gh = githubIssueDelivery({ repo: { owner: 'bamr87', name: 'git-with-the-program' }, client });

    const r1 = await gh.deliver(first.document);
    expect(r1.ok, JSON.stringify(r1)).toBe(true);
    expect(created).toHaveLength(1);

    // What GitHub would receive IS the pipeline's bundle: title, labels, and the evidence body
    // (the adapter appends the delivery marker only if absent — here the bundle already carries it).
    expect(created[0]?.title).toBe(first.document.title);
    expect(created[0]?.labels).toEqual(first.document.labels);
    expect(created[0]?.body).toContain(first.document.body);
    expect(created[0]?.body).toContain(TARGET_ASSERTION);
    expect(created[0]?.body).toContain('gwtp ledger replay --key INV-005');

    // The blindness guarantee survives the real adapter: no fixture identity reaches the issue.
    for (const identity of FIXTURE_IDENTITY_STRINGS) {
      expect(created[0]?.body.includes(identity), `filed issue names \`${identity}\``).toBe(false);
    }

    // Same firing again → the adapter finds its own marker and files nothing new (spec 02 §6).
    const r2 = await gh.deliver(first.document);
    expect(r2.ok).toBe(true);
    expect(created).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4. The rejected-proposal path: an affirmed precedent and a precision raise, as PROPOSALS
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('a rejected proposal writes an affirmed precedent and raises precision (spec 02 §6)', () => {
  it('produces a precedent with `ruling: affirmed` and a fresh PRE-id', () => {
    expect(first.rejection.precedent.ruling).toBe('affirmed');
    expect(first.rejection.precedent.id).toBe('PRE-001');
    expect(first.rejection.precedent.pattern.length).toBeGreaterThan(20);
    expect(first.rejection.precedent.evidence.length).toBeGreaterThan(0);
    expect(first.rejection.precedent.evidence[0]).toContain(
      sha256RefHex(first.firing.triggeredBy),
    );
  });

  it('raises precision by halving the distance to the ceiling: 0.9 → 0.95', () => {
    expect(first.rejection.raisedPrecision as number).toBe(0.95);
    expect(first.rejection.raisedPrecision as number).toBeGreaterThan(
      first.assertion.precision as number,
    );
    expect(first.rejection.raisedPrecision as number).toBeLessThanOrEqual(1);
  });

  it('emits BOTH changes as PROPOSED unified diffs against `.program/`, and writes neither', () => {
    const [precedents, invariants] = first.rejection.amendments;
    expect(first.rejection.amendments).toHaveLength(2);

    expect(precedents?.path).toBe('.program/precedents.yaml');
    expect(precedents?.diff).not.toBeNull();
    expect(precedents?.diff).toContain('+- id: PRE-001');
    expect(precedents?.diff).toContain('+  ruling: affirmed');

    expect(invariants?.path).toBe('.program/invariants.yaml');
    expect(invariants?.diff).not.toBeNull();
    expect(invariants?.diff).toContain('-  precision: 0.9');
    expect(invariants?.diff).toContain('+  precision: 0.95');
    // The diff touches ONE line of the constitution and says why.
    expect(invariants?.rationale).toContain('halve the distance to 1.0');
  });

  it('the diffs are real: `git apply` accepts them against the fixture’s `.program/`', () => {
    // A "proposed amendment" that does not apply is prose, not a proposal. This is the assertion
    // that keeps the diff generator honest — and it runs against the THROWAWAY copy, never here.
    const patchDir = join(repoDir, 'proposals');
    mkdirSync(patchDir, { recursive: true });
    const written: string[] = [];
    for (const [i, a] of first.rejection.amendments.entries()) {
      if (a.diff === null) continue;
      const file = join(patchDir, `PROPOSED-${i}-${a.path.replace(/[^A-Za-z0-9]+/g, '-')}.patch`);
      writeFileSync(file, a.diff, 'utf8');
      written.push(file);
    }
    expect(written).toHaveLength(2);

    for (const file of written) {
      expect(() => execFileSync('git', ['-C', repoDir, 'apply', '--check', file])).not.toThrow();
    }
    // …and together, since a human applies them as one amendment PR.
    expect(() =>
      execFileSync('git', ['-C', repoDir, 'apply', '--check', ...written]),
    ).not.toThrow();
  });

  it('leaves `.program/` in the FIXTURE untouched — the machine proposes, a human ratifies', () => {
    for (const entry of readdirSync(PROGRAM_DIR).sort()) {
      expect(readFileSync(join(repoDir, '.program', entry), 'utf8')).toBe(
        readFileSync(join(PROGRAM_DIR, entry), 'utf8'),
      );
    }
    expect(fixtureGit(['status', '--porcelain', '--', '.program']).trim()).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 5. Idempotency: run it all again and converge
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('the second run converges: no duplicate events, no second issue', () => {
  it('writes no new events — content addressing makes the repeat a no-op (spec 02 §1)', () => {
    expect(second.verdictAppend.written).toEqual([]);
    expect(second.verdictAppend.deduped).toHaveLength(first.judged.length);
    expect(second.firingAppend.written).toEqual([]);
    expect(second.firingAppend.deduped).toEqual([first.assembled.event.event]);
    expect(second.ledgerEventCount).toBe(first.ledgerEventCount);
  });

  it('does not move the ledger ref, so the repeat leaves no commit either', () => {
    expect(second.ledgerTip).toBe(first.ledgerTip);
    expect(fixtureGit(['rev-list', '--count', 'refs/program/ledger']).trim()).toBe('2');
  });

  it('re-derives the SAME firing, from the same events, at the same value', () => {
    expect(second.firings).toHaveLength(1);
    expect(second.firing.triggeredBy).toBe(first.firing.triggeredBy);
    expect(second.firing.at).toBe(first.firing.at);
    expect(second.meter.atFiring).toBe(first.meter.atFiring);
    expect(second.violationCount).toBe(first.violationCount);
    expect(second.complianceCount).toBe(first.complianceCount);
    // The firing event itself is now IN the ledger and folds as an abstention — which is exactly
    // why `abstain` is the verdict a firing carries: recording an outcome must not perturb the
    // observations it summarises (Q-46).
    expect(second.abstentionCount).toBe(first.abstentionCount + 1);
  });

  it('renders a BYTE-IDENTICAL bundle — nothing in the loop reads a clock', () => {
    expect(second.document.body).toBe(first.document.body);
    expect(second.document.title).toBe(first.document.title);
    expect(second.document.key).toBe(first.document.key);
    expect(second.assembled.event.event).toBe(first.assembled.event.event);
  });

  it('files no second issue: delivery was asked twice and created once', () => {
    expect(port.calls).toHaveLength(2);
    expect(port.created).toHaveLength(1);
    expect(second.receipt.status).toBe('existing');
    expect(second.receipt.key).toBe(first.receipt.key);
  });

  it('produces identical post-fire artifacts, because the rejected path is pure', () => {
    expect(second.rejection.precedent).toEqual(first.rejection.precedent);
    expect(second.rejection.raisedPrecision).toEqual(first.rejection.raisedPrecision);
    expect(second.rejection.amendments.map((a) => a.diff)).toEqual(
      first.rejection.amendments.map((a) => a.diff),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6. This repository was never written to
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('git-with-the-program itself is untouched (INV-001, and simple hygiene)', () => {
  it('`.program/` is byte-for-byte what it was before the run', () => {
    expect(fingerprintProgramDir()).toBe(PROGRAM_BEFORE);
    expect(hostGit(['status', '--porcelain', '--', '.program']).trim()).toBe(HOST_STATUS_BEFORE);
    expect(hostGit(['status', '--porcelain', '--', '.program']).trim()).toBe('');
  });

  it('gained no commits and no ledger ref — the engine never writes its own repo', () => {
    // Both compared to a baseline captured BEFORE the pipeline ran, so this measures the engine's
    // side effects on the host repo, not the repo's absolute size — it holds however many commits
    // this branch has and under any checkout depth.
    expect(hostGit(['log', '--oneline']).trim()).toBe(HOST_LOG_BEFORE);
    expect(hostGit(['rev-list', '--count', 'HEAD']).trim()).toBe(HOST_COUNT_BEFORE);
    expect(hostGit(['show-ref']).includes('refs/program/')).toBe(false);
  });

  it('the fixture ledger holds only the fixture’s events, all hash-verified', () => {
    const ids = new Set<string>();
    for (const j of first.judged) ids.add(j.event.event);
    ids.add(first.assembled.event.event);
    expect(ids.size).toBe(first.ledgerEventCount);
  });
});
