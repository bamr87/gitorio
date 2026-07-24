#!/usr/bin/env node
// Implements: ROADMAP.md v0 — "The sighted repo … **Exit test:** this repo runs it on itself; a
// staged INV-005 breach accumulates and files" — and seeds/SEED-02-ledger-engine.md's acceptance
// clause "a synthetic event stream crosses budget and files a correctly-bundled issue; a rejected
// proposal path writes an `affirmed` precedent and raises precision".
//
// THE WHOLE LOOP, END TO END, IN ONE FILE:
//
//   stage a breach  ──▶  deterministic judge  ──▶  ledger events  ──▶  fold (leaky integrator)
//        (git)           (src/judge/…/imports)      (src/core)         (src/ledger/fold)
//                                                                             │
//                        delivery  ◀──  render  ◀──  classify  ◀── dispersion ◀ firing
//                     (DeliveryPort)   (adapters)   (src/core)   (src/ledger/sighted)
//                                                                             │
//                                        rejected ──▶ affirmed precedent + precision raise
//                                                     (PROPOSED diffs; INV-001 forbids the write)
//
// WHY THE PIPELINE LIVES IN scripts/ AND NOT IN THE TEST. `tests/exit-test-v0.test.ts` imports
// `runV0Pipeline` from here and asserts against its result, exactly as `tests/check-inv001.test.ts`
// and `tests/check-inv003.test.ts` import their subjects from `scripts/`. One implementation, two
// callers: a demo a human can run and read (`npx tsx scripts/demo-v0.ts`), and a re-runnable test
// that pins every claim it makes.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  EVERY GIT WRITE HAPPENS IN A THROWAWAY REPOSITORY UNDER $TMPDIR.
//
//  Nothing here writes to the repository it is checked into: no commit, no ref, and above all no
//  `refs/program/ledger` in git-with-the-program itself. The ledger is surveillance, and a demo
//  that surveilled its own project would be writing history nobody asked for. The ONE thing read
//  from the real repository is `.program/` — copied, byte for byte, into the fixture — because
//  the point of the exit test is that the accumulator crosses INV-005's REAL budget under
//  INV-005's REAL knobs, not knobs invented for a demo.
//
//  INV-001: nothing in this file writes `.program/` in either repository. The rejected-proposal
//  path returns unified diffs and stops. A human applies them, under their own name, in a
//  reviewed PR — that is the whole of the invariant, and it is enforced here by the ABSENCE of
//  any write path, not by a rule this file promises to follow.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// INV-003: this file is not under a blind directory, so it may hold a `SentencingWarrant` — and
// it holds exactly one, minted through `atFiringTime` at the single moment ADR-0003 permits, used
// to render the proposal and to report the meter as plain numbers, and never stored.
// `scripts/check-inv003.ts` draws the line at `src/judge/**` and `src/evidence/**`; see
// docs/spec/OPEN-QUESTIONS.md Q-39 and Q-40.
//
// INV-005: `src/ledger` and `src/core` import nothing forge-specific; the adapter import below is
// legal precisely because this file is neither.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import {
  type CommitSha,
  type CommitterTime,
  type ContributingEvent,
  type DeliveryDocument,
  type DeliveryPort,
  type DeliveryReceipt,
  type EventId,
  type Firing,
  type FoldKnobs,
  type Hunk,
  type InvariantAssertion,
  type LedgerEvent,
  type NonEmptyReadonlyArray,
  type Precision,
  type ProposalKind,
  type ProvenanceRef,
  type RepoPath,
  type Verdict,
  decodeInvariantsFile,
  deliveryFailure,
  deliveryReceipt,
  eventBodyFromVerdict,
  findDeliveryMarker,
  hashBlob,
  isInvariantAssertion,
  isNonEmpty,
  isViolation,
  normalizeCommitterTime,
  ok,
  parseCommitSha,
  parseCommitterTime,
  parseRationaleRef,
  parseRepoPath,
  scopedHunks,
  sealEvent,
  sealEvidence,
  sha256RefHex,
  unwrap,
} from '../src/core/index.js';
// The single declassification import in this file. `atFiringTime` (src/ledger/firing.ts) is the
// only warrant mint; `revealSurprise` is the only unwrap, and it takes the warrant as an argument.
import { revealSurprise } from '../src/core/sentencing.js';
import type { SentencingWarrant } from '../src/core/sentencing.js';
import {
  type AppendOutcome,
  type AssembledFiring,
  type KeyedFoldResult,
  type RejectionArtifacts,
  GitRefEventStore,
  LEDGER_REF,
  assembleFiring,
  atFiringTime,
  foldEventsPerKey,
  foldKnobs,
  gitCliRunner,
  gitSightedCommitPort,
  onProposalRejected,
  orphanedCount,
  requireLoci,
  resolveEvidenceLoci,
} from '../src/ledger/index.js';
import type { AmendmentPatch } from '../src/adapters/github/amendment.js';
import { buildAmendment } from '../src/adapters/github/amendment.js';
import { renderProposal } from '../src/adapters/github/render.js';
import {
  IMPORT_BOUNDARY_JUDGE,
  judgeImportBoundary,
} from '../src/judge/deterministic/imports.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT: string = resolve(HERE, '..');

/** The assertion the v0 exit test stages a breach of. Ratified in commit f9e61ec (PR #1). */
export const TARGET_ASSERTION = 'INV-005';

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. The staged breach: a throwaway repository under $TMPDIR
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Two hands, deliberately. The breaching commits are ONE author on ONE file, which is the
 * `refactor` signature spec 02 §5 assigns to "the code is wrong" — a *staged* breach is by
 * definition one person's doing, and a classifier that called it a referendum would be wrong.
 * The compliant commits carry a second identity so the "no author identity in the bundle"
 * assertion has two names to fail on rather than one.
 */
export const BREACH_AUTHOR = { name: 'Staged Breacher', email: 'breacher@fixture.invalid' } as const;
export const CLEAN_AUTHOR = { name: 'Tidy Hand', email: 'tidy@fixture.invalid' } as const;

/** Every identity string that must not survive into a rendered proposal (ADR-0003). */
export const FIXTURE_IDENTITY_STRINGS: readonly string[] = [
  BREACH_AUTHOR.name,
  BREACH_AUTHOR.email,
  CLEAN_AUTHOR.name,
  CLEAN_AUTHOR.email,
  'breacher',
  'Tidy',
  'fixture.invalid',
];

export interface StagedCommit {
  readonly label: string;
  /** ISO-8601 with an offset, handed to git as GIT_COMMITTER_DATE (ADR-0004). */
  readonly date: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly expect: 'drift' | 'aligned' | 'abstain';
  readonly files: Readonly<Record<string, string>>;
  readonly message: string;
}

const CLEAN_CORE_V1 = `// A forge-agnostic engine module. Nothing here names a forge.
import { createHash } from 'node:crypto';

export function fingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
`;

const CLEAN_CORE_V2 = `${CLEAN_CORE_V1}
export function shortFingerprint(text: string): string {
  return fingerprint(text).slice(0, 12);
}
`;

const CLEAN_CORE_V3 = `${CLEAN_CORE_V2}
export function sameFingerprint(a: string, b: string): boolean {
  return fingerprint(a) === fingerprint(b);
}
`;

/**
 * The staged INV-005 breach, grown one forge import at a time. Every offence is a STATIC VALUE
 * import, which `IMPORT_FORM_SEVERITY` puts on ADR-0005's `breach` rung (0.75) — so the
 * arithmetic in `V0_ARITHMETIC` has one increment to reason about, not five different ones.
 */
const FORGE_IMPORTS: readonly string[] = [
  `import { Octokit } from '@octokit/rest';`,
  `import { RequestError } from '@octokit/request-error';`,
  `import * as gh from '@actions/github';`,
  `import actionsCore from '@actions/core';`,
  `import { githubIssueDelivery } from '../adapters/github/issues.js';`,
];

function forgeFile(n: number): string {
  const head = '// STAGED INV-005 BREACH (fixture) — forge SDKs imported straight into engine core.\n';
  return `${head}${FORGE_IMPORTS.slice(0, n).join('\n')}\n\nexport const clients = ${n};\n`;
}

/**
 * Nine commits. Committer times are FIXED CONSTANTS — no clock is read anywhere in this file —
 * so the fold, the firing, the rendered bundle and every event id are reproducible byte for byte
 * on any machine, at any time. That is what makes the exit test a test rather than a demo.
 *
 * The five breaching commits sit exactly 10 days apart (2026-01-10 → 2026-02-19), which is what
 * `V0_ARITHMETIC` is computed against. The compliant commits interleave and do not perturb it:
 * an `aligned` event increments the compliance counter and does nothing else — it does not pay
 * the meter down and does not advance the accumulator's reference instant (spec 02 §4, Q-43).
 */
export const STAGED_COMMITS: readonly StagedCommit[] = [
  {
    label: 'base',
    date: '2026-01-01T00:00:00+00:00',
    author: CLEAN_AUTHOR,
    expect: 'abstain',
    message: 'base: the constitution and a readme',
    files: { 'README.md': '# staged INV-005 breach fixture\n' },
  },
  {
    label: 'A1',
    date: '2026-01-05T00:00:00+00:00',
    author: CLEAN_AUTHOR,
    expect: 'aligned',
    message: 'core: add a forge-agnostic fingerprint helper',
    files: { 'src/core/boundary.ts': CLEAN_CORE_V1 },
  },
  {
    label: 'B1',
    date: '2026-01-10T00:00:00+00:00',
    author: BREACH_AUTHOR,
    expect: 'drift',
    message: 'core: reach for the GitHub SDK directly (INV-005 breach 1/5)',
    files: { 'src/core/forge.ts': forgeFile(1) },
  },
  {
    label: 'A2',
    date: '2026-01-15T00:00:00+00:00',
    author: CLEAN_AUTHOR,
    expect: 'aligned',
    message: 'core: abbreviate fingerprints',
    files: { 'src/core/boundary.ts': CLEAN_CORE_V2 },
  },
  {
    label: 'B2',
    date: '2026-01-20T00:00:00+00:00',
    author: BREACH_AUTHOR,
    expect: 'drift',
    message: 'core: import the SDK error type too (INV-005 breach 2/5)',
    files: { 'src/core/forge.ts': forgeFile(2) },
  },
  {
    label: 'A3',
    date: '2026-01-25T00:00:00+00:00',
    author: CLEAN_AUTHOR,
    expect: 'aligned',
    message: 'core: compare fingerprints',
    files: { 'src/core/boundary.ts': CLEAN_CORE_V3 },
  },
  {
    label: 'B3',
    date: '2026-01-30T00:00:00+00:00',
    author: BREACH_AUTHOR,
    expect: 'drift',
    message: 'core: pull in the Actions toolkit (INV-005 breach 3/5)',
    files: { 'src/core/forge.ts': forgeFile(3) },
  },
  {
    label: 'B4',
    date: '2026-02-09T00:00:00+00:00',
    author: BREACH_AUTHOR,
    expect: 'drift',
    message: 'core: and @actions/core (INV-005 breach 4/5)',
    files: { 'src/core/forge.ts': forgeFile(4) },
  },
  {
    label: 'B5',
    date: '2026-02-19T00:00:00+00:00',
    author: BREACH_AUTHOR,
    expect: 'drift',
    message: 'core: import the adapter from core (INV-005 breach 5/5)',
    files: { 'src/core/forge.ts': forgeFile(5) },
  },
];

/**
 * THE ARITHMETIC, HAND-COMPUTED, so the exit test asserts against numbers a reviewer can check
 * with a calculator rather than against whatever the code happens to produce.
 *
 * INV-005 as ratified in `.program/invariants.yaml`: `precision: 0.9`, `budget: 3.0`,
 * `half_life: 120d`. The judge rules every staged breach a static value import, which
 * `IMPORT_FORM_SEVERITY` puts on ADR-0005's `breach` rung → `severity: 0.75`.
 *
 *   increment  = precision_at · severity = 0.9 × 0.75 = 0.675          (spec 02 §4)
 *   Δt         = 10 days between consecutive breaching commits         (committer time, ADR-0004)
 *   decay step = 2^(−10/120) = 2^(−1/12) = 0.943874312681693…
 *
 *   A ← A · 2^(−Δt / half_life) + precision_at · severity
 *
 *   A₁ =                                        0.675 = 0.675000
 *   A₂ = 0.675000 × 0.9438743 + 0.675                 = 1.312115
 *   A₃ = 1.312115 × 0.9438743 + 0.675                 = 1.913472
 *   A₄ = 1.913472 × 0.9438743 + 0.675                 = 2.481077   < 3.0 — armed, silent
 *   A₅ = 2.481077 × 0.9438743 + 0.675                 = 3.016825   ≥ 3.0 — FIRES
 *
 * Note what the decay is doing. Five undecayed increments would be 5 × 0.675 = 3.375; the meter
 * reads 3.016825. Forgiveness has already eaten 0.358175 of the evidence by the time the unit
 * spikes, and the budget is cleared by 0.016825 — narrowly, on purpose: a fixture that cleared
 * the bar by a mile would not notice if the decay term silently stopped being applied. Spread
 * the same five breaches 20 days apart instead of 10 and A₅ = 2.714625 — no firing, and the
 * repository is being forgiven faster than it offends.
 */
export const V0_ARITHMETIC = {
  precision: 0.9,
  severity: 0.75,
  increment: 0.675,
  budget: 3.0,
  halfLife: '120d',
  stepDays: 10,
  decayStep: 2 ** (-10 / 120),
  /** A₁…A₅, to six decimals. */
  meter: [0.675, 1.312115, 1.913472, 2.481077, 3.016825] as const,
  meterBeforeFiring: 2.481077,
  meterAtFiring: 3.016825,
  undecayedTotal: 3.375,
  violations: 5,
  compliances: 3,
  abstentions: 1,
} as const;

// ---------------------------------------------------------------------------
// git — read-write, and only ever inside the throwaway repository
// ---------------------------------------------------------------------------

function git(
  dir: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): string {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
  });
}

export interface StagedRepo {
  readonly dir: string;
  /** Oldest first, aligned with `STAGED_COMMITS`. */
  readonly shas: readonly string[];
}

/**
 * Builds the fixture repository under $TMPDIR. `.program/` is copied VERBATIM from the real
 * repository — read only, never written — so the exit test runs against the constitution as
 * ratified rather than against a convenient replica of it.
 */
export function stageInv005BreachRepo(programSource = join(REPO_ROOT, '.program')): StagedRepo {
  const dir = mkdtempSync(join(tmpdir(), 'gwtp-exit-v0-'));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', CLEAN_AUTHOR.name]);
  git(dir, ['config', 'user.email', CLEAN_AUTHOR.email]);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);

  mkdirSync(join(dir, '.program'), { recursive: true });
  for (const entry of readdirSync(programSource).sort()) {
    copyFileSync(join(programSource, entry), join(dir, '.program', entry));
  }

  const shas: string[] = [];
  for (const c of STAGED_COMMITS) {
    for (const [path, content] of Object.entries(c.files)) {
      const abs = join(dir, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', c.message], {
      GIT_AUTHOR_NAME: c.author.name,
      GIT_AUTHOR_EMAIL: c.author.email,
      GIT_AUTHOR_DATE: c.date,
      GIT_COMMITTER_NAME: c.author.name,
      GIT_COMMITTER_EMAIL: c.author.email,
      GIT_COMMITTER_DATE: c.date,
    });
    shas.push(git(dir, ['rev-parse', 'HEAD']).trim());
  }

  return { dir, shas };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. The evidence assembler stand-in (SEED-03 owns the real one, in src/evidence/**)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * A minimal unified-diff reader: `git show` output → `Hunk[]`.
 *
 * This is the ONE piece of the loop SEED-03 has not landed — spec 03 §3's assembler, which
 * produces "the diff hunks intersecting the assertion's scope, with an expanding context ring".
 * It is deliberately HERE and not under `src/**`: writing a permanent assembler inside a task
 * whose subject is SEED-02 would be landing SEED-03 by the back door. What it produces still goes
 * through `sealEvidence`, so the blindness chokepoint is real even though the assembler is a
 * stand-in — the judge cannot tell the difference, which is the point of the seal.
 */
export function parseUnifiedDiff(diff: string): readonly Hunk[] {
  const hunks: Hunk[] = [];
  let path: RepoPath | null = null;
  let open:
    | { oldStart: number; oldLines: number; newStart: number; newLines: number; body: string[] }
    | null = null;

  const flush = (): void => {
    if (open === null) return;
    if (path !== null) {
      hunks.push({
        path,
        oldStart: open.oldStart,
        oldLines: open.oldLines,
        newStart: open.newStart,
        newLines: open.newLines,
        text: open.body.join('\n'),
      });
    }
    open = null;
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      path = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      flush();
      const target = line.slice(4).trim();
      if (target === '/dev/null') {
        path = null;
        continue;
      }
      const parsed = parseRepoPath(target.replace(/^b\//, ''));
      path = parsed.ok ? parsed.value : null;
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header !== null) {
      flush();
      open = {
        oldStart: Number.parseInt(header[1] as string, 10),
        oldLines: header[2] === undefined ? 1 : Number.parseInt(header[2], 10),
        newStart: Number.parseInt(header[3] as string, 10),
        newLines: header[4] === undefined ? 1 : Number.parseInt(header[4], 10),
        body: [],
      };
      continue;
    }
    if (open === null) continue;
    if (
      line === '' ||
      line.startsWith(' ') ||
      line.startsWith('+') ||
      line.startsWith('-') ||
      line.startsWith('\\')
    ) {
      open.body.push(line);
    }
  }
  flush();
  return hunks;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. The capturing delivery port
// ═══════════════════════════════════════════════════════════════════════════════════════════

export interface CapturedDelivery {
  readonly document: DeliveryDocument;
  readonly at: number;
}

export interface CapturingDeliveryPort extends DeliveryPort {
  /** Every document this port CREATED. A repeat firing for the same event never lands here. */
  readonly created: readonly CapturedDelivery[];
  /** Every `deliver` call, created or not — so "asked twice, filed once" is observable. */
  readonly calls: readonly DeliveryDocument[];
}

/**
 * A `DeliveryPort` that files nothing and remembers everything.
 *
 * Idempotency is implemented the way `src/adapters/github/bare.ts` implements it, for the same
 * reason: content addressing makes the LEDGER idempotent (spec 02 §1), but nothing makes a
 * channel idempotent, so the delivery path carries its own key and looks before it writes. A
 * repeat is `existing`, which is a SUCCESS — it is what idempotency looks like from outside.
 *
 * It also refuses a document that does not carry its own delivery marker, because without the
 * marker the idempotency is a claim rather than a mechanism (src/core/delivery.ts).
 */
export function capturingDelivery(channel = 'capture'): CapturingDeliveryPort {
  const created: CapturedDelivery[] = [];
  const calls: DeliveryDocument[] = [];
  const byKey = new Map<string, DeliveryDocument>();

  return {
    channel,
    created,
    calls,
    deliver(doc) {
      calls.push(doc);
      if (findDeliveryMarker(doc.body) !== doc.key) {
        return Promise.resolve(
          deliveryFailure(
            'rejected',
            `the document for ${doc.key} does not carry its own delivery marker`,
            false,
          ),
        );
      }
      if (byKey.has(doc.key)) {
        return Promise.resolve(
          ok(deliveryReceipt(doc.key, 'existing', channel, `capture://${doc.key}`, doc.key)),
        );
      }
      byKey.set(doc.key, doc);
      created.push({ document: doc, at: created.length });
      return Promise.resolve(
        ok(deliveryReceipt(doc.key, 'created', channel, `capture://${doc.key}`, doc.key)),
      );
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4. The pipeline
// ═══════════════════════════════════════════════════════════════════════════════════════════

export interface JudgedCommit {
  readonly label: string;
  readonly sha: CommitSha;
  readonly t: CommitterTime;
  readonly verdict: Verdict;
  readonly hunks: readonly Hunk[];
  readonly scoped: readonly Hunk[];
  /** Sealed and content-addressed. Abstentions are minted too; they never accumulate. */
  readonly event: LedgerEvent;
}

/** Plain numbers only: everything a `Surprise` had to say, said once, under one warrant. */
export interface MeterReport {
  readonly atFiring: number;
  readonly withoutTriggeringEvent: number;
  readonly budget: number;
  readonly residualByEvent: ReadonlyMap<EventId, number>;
}

export interface DispersionReport {
  readonly authorEntropyNormalized: number;
  readonly distinctAuthors: number;
  readonly pathEntropyNormalized: number;
  readonly distinctPaths: number;
  readonly spanMs: number;
  readonly complianceRatio: number | null;
  readonly eventCount: number;
}

export interface V0Run {
  readonly repoDir: string;
  readonly assertion: InvariantAssertion;
  readonly knobs: FoldKnobs;
  readonly judged: readonly JudgedCommit[];
  readonly verdictAppend: AppendOutcome;
  readonly firingAppend: AppendOutcome;
  readonly ledgerEventCount: number;
  readonly ledgerTip: string | null;
  readonly fold: KeyedFoldResult;
  readonly firings: readonly Firing[];
  readonly firing: Firing;
  readonly contributing: readonly ContributingEvent[];
  readonly violationCount: number;
  readonly complianceCount: number;
  readonly abstentionCount: number;
  readonly assembled: AssembledFiring;
  readonly kind: ProposalKind;
  readonly amendment: AmendmentPatch | null;
  readonly document: DeliveryDocument;
  readonly receipt: DeliveryReceipt;
  readonly meter: MeterReport;
  readonly dispersion: DispersionReport;
  readonly rejection: RejectionArtifacts;
  readonly orphanedLoci: number;
}

export interface V0PipelineOptions {
  readonly repoDir: string;
  readonly port: CapturingDeliveryPort;
  readonly ledgerRef?: string;
}

function committerTimeOf(dir: string, sha: string): CommitterTime {
  const raw = git(dir, ['show', '-s', '--format=%cI', sha]).trim();
  return unwrap(normalizeCommitterTime(unwrap(parseCommitterTime(raw))));
}

function diffOf(dir: string, sha: string): readonly Hunk[] {
  return parseUnifiedDiff(
    git(dir, [
      '-c',
      'core.quotePath=false',
      'show',
      '--format=',
      '--no-renames',
      '--no-color',
      '-U3',
      sha,
    ]),
  );
}

/**
 * The whole v0 loop against an already-staged repository.
 *
 * SAFE TO CALL TWICE on the same repository, which is half of what the exit test is for: every
 * write it performs is either content-addressed (the ledger) or keyed by the firing (the
 * delivery), so a second call converges on the first instead of duplicating it. Nothing here
 * reads a clock, so the second run produces byte-identical output.
 */
export async function runV0Pipeline(options: V0PipelineOptions): Promise<V0Run> {
  const dir = options.repoDir;
  const ref = options.ledgerRef ?? LEDGER_REF;

  // ── the constitution, read from the fixture's own copy of `.program/` ─────────────────────
  const invariantsYaml = readFileSync(join(dir, '.program', 'invariants.yaml'), 'utf8');
  const precedentsYaml = readFileSync(join(dir, '.program', 'precedents.yaml'), 'utf8');
  const charter = readFileSync(join(dir, '.program', 'charter.md'), 'utf8');
  const assertions = unwrap(decodeInvariantsFile(parseYaml(invariantsYaml)));
  const target = assertions.find((a) => a.id === TARGET_ASSERTION);
  if (target === undefined || !isInvariantAssertion(target)) {
    throw new Error(`${TARGET_ASSERTION} is not an invariant in the fixture's .program/`);
  }
  const assertion: InvariantAssertion = target;
  const precision: Precision = assertion.precision;
  const knobs = foldKnobs(assertion);

  // ── judge every commit, oldest first: one assertion, one diff, one invocation (spec 03 §1) ─
  const shas = git(dir, ['rev-list', '--reverse', 'HEAD'])
    .trim()
    .split('\n')
    .filter((s) => s !== '');
  const judged: JudgedCommit[] = [];

  for (const [i, sha] of shas.entries()) {
    const commit = unwrap(parseCommitSha(sha));
    const t = committerTimeOf(dir, sha);
    const hunks = diffOf(dir, sha);
    const scoped = scopedHunks(assertion.scope, hunks);

    // THE CHOKEPOINT (src/core/evidence.ts). `sealEvidence` is the only minter of the judge's
    // input, and it audits the bundle for author identity and accumulator state — at compile
    // time via `Blind<T>` and at run time via `assertBlind` — before the judge sees anything.
    const sealed = unwrap(
      sealEvidence({
        assertion: {
          id: assertion.id,
          statement: assertion.statement,
          class: assertion.class,
          scope: assertion.scope,
        },
        charterExcerpt: charter.slice(0, 600),
        hunks: scoped,
        ring: 'hunk' as const,
        precedent: null,
      }),
    );

    const verdict = judgeImportBoundary(sealed);

    const body = isViolation(verdict)
      ? eventBodyFromVerdict({
          subject: { commit },
          judge: IMPORT_BOUNDARY_JUDGE,
          t,
          verdict,
          precision_at: precision,
          // "Blob ref; full text retained out of the hot path" (spec 02 §2). The rationale is a
          // pure function of the diff, so the ref — and therefore the event id — is stable.
          rationale: unwrap(parseRationaleRef(hashBlob(verdict.rationale))),
        })
      : eventBodyFromVerdict({ subject: { commit }, judge: IMPORT_BOUNDARY_JUDGE, t, verdict });

    judged.push({
      label: STAGED_COMMITS[i]?.label ?? sha.slice(0, 12),
      sha: commit,
      t,
      verdict,
      hunks,
      scoped,
      event: unwrap(sealEvent(body)),
    });
  }

  // ── append to refs/program/ledger IN THE THROWAWAY REPOSITORY ─────────────────────────────
  // `now` is pinned so the ledger commit itself is reproducible; the events do not need it,
  // because their ids are hashes of their bodies, not of when they were written.
  const store = new GitRefEventStore({ cwd: dir, ref, now: () => new Date(0) });
  const events = judged.map((j) => j.event);
  if (!isNonEmpty(events)) throw new Error('the fixture produced no verdicts to append');
  const verdictAppend = await store.append(events);

  // ── fold, under INV-005's REAL knobs, read from the fixture's `.program/` ─────────────────
  const ledgerEvents = await store.list();
  const knobsFor = (key: string): FoldKnobs | null => {
    const a = assertions.find((x) => x.id === key);
    return a === undefined ? null : foldKnobs(a);
  };
  const fold = unwrap(foldEventsPerKey(ledgerEvents, knobsFor));
  const firings = fold.firings.filter((f) => f.key === assertion.id);
  const firing = firings[0];
  if (firing === undefined) {
    throw new Error(
      `${assertion.id} did not fire: the accumulator never reached budget ${assertion.budget}`,
    );
  }
  const state = fold.states.get(assertion.id);
  if (state === undefined) throw new Error(`no accumulator state for ${assertion.id}`);

  // The counterfactual that shows the arithmetic: the same fold with the TRIGGERING event
  // removed must sit below budget, or the crossing was not this event's doing.
  const withoutTrigger = unwrap(
    foldEventsPerKey(
      ledgerEvents.filter((e) => e.event !== firing.triggeredBy),
      knobsFor,
    ),
  );
  const priorState = withoutTrigger.states.get(assertion.id);

  // ── firing time: the ONE moment ADR-0003 permits authorship to be read ────────────────────
  const contributing = firing.contributing;
  const contributingEvents = ledgerEvents.filter((e) =>
    contributing.some((c) => c.event === e.event),
  );
  const trigger = contributingEvents.find((e) => e.event === firing.triggeredBy);
  if (trigger === undefined) throw new Error('the firing names an event that is not in the ledger');

  const resolution = await resolveEvidenceLoci(
    contributingEvents,
    gitSightedCommitPort(gitCliRunner(dir)),
  );
  const loci = unwrap(requireLoci(resolution));
  const orphaned = orphanedCount(resolution);

  const atFiring = atFiringTime((warrant: SentencingWarrant) => {
    const assembled = unwrap(
      assembleFiring(
        {
          firing,
          trigger,
          loci,
          complianceCount: state.complianceCount,
          violationCount: state.violationCount,
          knobs,
          ...(orphaned > 0
            ? {
                evidenceNotes: [
                  `${orphaned} of ${contributing.length} contributing commits were rebased away and are folded as orphaned (ADR-0004).`,
                ],
              }
            : {}),
        },
        warrant,
      ),
    );

    // `reprogram` is the branch that argues with the law, so it ships a `.program/` PATCH.
    // The fixture is a staged single-handed breach and classifies `refactor`; the branch is
    // built anyway, so the demo is the whole hinge rather than half of it.
    const amendment: AmendmentPatch | null =
      assembled.proposal.kind === 'reprogram'
        ? unwrap(
            buildAmendment({
              assertion,
              currentText: invariantsYaml,
              triggeredBy: firing.triggeredBy,
              firedAt: firing.at,
            }),
          )
        : null;

    const document = unwrap(renderProposal({ proposal: assembled.proposal, assertion, amendment }, warrant));

    const meter: MeterReport = {
      atFiring: revealSurprise(firing.value, warrant),
      withoutTriggeringEvent:
        priorState === undefined ? 0 : revealSurprise(priorState.value, warrant),
      budget: assertion.budget,
      residualByEvent: new Map(
        contributing.map((c) => [c.event, revealSurprise(c.residualWeight, warrant)]),
      ),
    };

    return { assembled, amendment, document, meter };
  });

  const receipt = await options.port.deliver(atFiring.document);
  if (!receipt.ok) {
    throw new Error(`delivery failed: [${receipt.error.code}] ${receipt.error.message}`);
  }

  // The firing is an observation too (spec 02 §6: "outcomes are events too"), so it goes back on
  // the ledger — content-addressed, therefore a no-op on the second run.
  const firingAppend = await store.append([atFiring.assembled.event]);

  // ── the rejected-proposal path (spec 02 §6). PURE: it returns diffs and writes nothing. ────
  const provenance: NonEmptyReadonlyArray<ProvenanceRef> = [
    `ledger-event:${sha256RefHex(firing.triggeredBy)}`,
    'roadmap:v0-exit-test',
  ];
  const rejection = unwrap(
    onProposalRejected({
      proposal: atFiring.assembled.proposal,
      assertion,
      invariantsYaml,
      precedentsYaml,
      existingPrecedentIds: [],
      pattern:
        'Forge SDK imports (@octokit/*, @actions/*) and adapter imports added directly to engine core instead of behind a port',
      rationale:
        'The dispersion evidence was heard and the law was upheld: one hand, one seam, a 40-day ' +
        'window. INV-005 is not the thing at fault — the imports are. Core declares the port; ' +
        'the adapter implements it.',
      evidence: provenance,
    }),
  );

  const d = atFiring.assembled.proposal.evidence.dispersion;

  return {
    repoDir: dir,
    assertion,
    knobs,
    judged,
    verdictAppend,
    firingAppend,
    ledgerEventCount: (await store.list()).length,
    ledgerTip: await store.tip(),
    fold,
    firings,
    firing,
    contributing,
    violationCount: state.violationCount,
    complianceCount: state.complianceCount,
    abstentionCount: state.abstentionCount,
    assembled: atFiring.assembled,
    kind: atFiring.assembled.proposal.kind,
    amendment: atFiring.amendment,
    document: atFiring.document,
    receipt: receipt.value,
    meter: atFiring.meter,
    dispersion: {
      authorEntropyNormalized: d.authorEntropy.normalized,
      distinctAuthors: d.authorEntropy.distinct,
      pathEntropyNormalized: d.pathEntropy.normalized,
      distinctPaths: d.pathEntropy.distinct,
      spanMs: d.timeSpread.spanMs,
      complianceRatio: d.complianceRatio,
      eventCount: d.eventCount,
    },
    rejection,
    orphanedLoci: orphaned,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 5. Entry point
// ═══════════════════════════════════════════════════════════════════════════════════════════

const USAGE = `demo-v0 — the ROADMAP v0 exit test, run once and printed

Stages an INV-005 breach in a THROWAWAY repository under $TMPDIR (never in this one), runs the
deterministic import-boundary judge over it, folds the resulting ledger, and prints the proposal
the firing produces.

Usage:
  npx tsx scripts/demo-v0.ts [--bundle] [--keep] [--help]

  --bundle   print the whole rendered evidence bundle, not just the summary
  --keep     leave the fixture repository on disk and print its path
`;

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  const showBundle = argv.includes('--bundle');

  const staged = stageInv005BreachRepo();
  const port = capturingDelivery();
  const first = await runV0Pipeline({ repoDir: staged.dir, port });
  const second = await runV0Pipeline({ repoDir: staged.dir, port });

  const out: string[] = [];
  out.push(`fixture repository      ${staged.dir}`);
  out.push(`assertion               ${first.assertion.id} (${first.assertion.status})`);
  out.push(
    `knobs                   precision ${first.assertion.precision}, budget ` +
      `${first.assertion.budget}, half_life ${first.assertion.half_life.source}`,
  );
  out.push('');
  out.push('verdicts');
  for (const j of first.judged) {
    const severity = isViolation(j.verdict) ? ` (${j.verdict.severity})` : '';
    out.push(`  ${j.label.padEnd(5)} ${j.t}  ${j.verdict.verdict}${severity}`);
  }
  out.push('');
  out.push(`ledger events           ${first.ledgerEventCount} at ${first.ledgerTip ?? '<none>'}`);
  out.push(
    `census                  ${first.violationCount} violation(s), ` +
      `${first.complianceCount} compliance(s), ${first.abstentionCount} abstention(s)`,
  );
  out.push(
    `meter                   ${first.meter.withoutTriggeringEvent.toFixed(6)} before the ` +
      `triggering event → ${first.meter.atFiring.toFixed(6)} at firing (budget ${first.meter.budget})`,
  );
  out.push(`firings                 ${first.firings.length}`);
  out.push(
    `dispersion              author ${first.dispersion.authorEntropyNormalized.toFixed(3)} over ` +
      `${first.dispersion.distinctAuthors} hand(s); path ` +
      `${first.dispersion.pathEntropyNormalized.toFixed(3)} over ${first.dispersion.distinctPaths} ` +
      `path(s); span ${(first.dispersion.spanMs / 86_400_000).toFixed(1)}d`,
  );
  out.push(`classification          ${first.kind}`);
  out.push(`delivered               ${first.receipt.status} → ${first.receipt.locator}`);
  out.push('');
  out.push('second run (idempotency)');
  out.push(`  events written        ${second.verdictAppend.written.length}`);
  out.push(`  events deduped        ${second.verdictAppend.deduped.length}`);
  out.push(`  ledger tip moved      ${String(second.ledgerTip !== first.ledgerTip)}`);
  out.push(`  documents created     ${port.created.length} (deliver called ${port.calls.length}×)`);
  out.push(`  bundle byte-identical ${String(second.document.body === first.document.body)}`);
  out.push('');
  out.push('rejected-proposal path (spec 02 §6) — PROPOSED, never written');
  out.push(`  precedent             ${first.rejection.precedent.id} ruling=${first.rejection.precedent.ruling}`);
  out.push(
    `  precision             ${first.assertion.precision} → ${String(first.rejection.raisedPrecision)}`,
  );
  for (const a of first.rejection.amendments) {
    out.push(`  amendment             ${a.path} — ${a.diff === null ? 'no change' : 'diff'}`);
  }
  out.push('');
  if (showBundle) {
    out.push('─'.repeat(78));
    out.push(first.document.title);
    out.push('─'.repeat(78));
    out.push(first.document.body);
  } else {
    out.push('Run with --bundle to print the whole evidence bundle.');
  }
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return entry.endsWith('demo-v0.ts') || entry.endsWith('demo-v0.js');
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      process.stderr.write(`demo-v0: ${(e as Error).message}\n`);
      process.exitCode = 1;
    });
}
