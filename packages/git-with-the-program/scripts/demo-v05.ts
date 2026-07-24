#!/usr/bin/env node
// Implements: seeds/SEED-03-judge-harness.md Acceptance and docs/spec/03-judge.md §2-§7 — the
// v0.5 exit test ("the bench"), the SEED-03 judgment ladder proven end to end.
//
// THE WHOLE BENCH, IN ONE FILE, REUSING WHAT SEED-03 SHIPPED:
//
//   sealed evidence   ──▶  LLM invariant judge  ──▶  the output contract   ──▶  bar exam
//   (src/core          (src/judge/model/…,          (decodeVerdict:            (src/judge/bar_exam:
//    evidence.ts,       over a FAKE ModelClient      uncited / off-anchor /     replay the settled
//    sealEvidence)      PORT, never a network)       no-PRE-id all rejected)    cases; block seating)
//                                                                                     │
//                                              a passing run ──▶ PROPOSED manifest diff (INV-001)
//
// WHY THE BENCH LIVES IN scripts/ AND NOT ONLY IN THE TEST. `tests/exit-test-v05.test.ts` imports
// these pieces and asserts against them, exactly as `tests/exit-test-v0.test.ts` imports its
// pipeline from `scripts/demo-v0.ts`. One implementation, two callers: a demo a human runs and
// reads (`npx tsx scripts/demo-v05.ts`), and a re-runnable test that pins every claim it makes.
// The build agents shipped the assembler, the LLM judge, the bar exam and the regression judge;
// this file WIRES them, it does not reimplement them.
//
// NETWORK-FREE BY CONSTRUCTION (SEED-03 constraint 8). Every LLM path runs through a fake
// ModelClient that returns canned YAML — `orderedModel` (replies in sequence) and `routedModel`
// (content-addressed on the filled prompt). No `new Anthropic()`, no request ever leaves the
// process. The fixtures carry a per-case sentinel (`// bench:PRE-2xx`) that the harness renders
// into the system prompt, so the routed fake can hand each settled case the ruling it was authored
// to receive without inspecting anything a real judge would not also see.
//
// INV-003: this file is NOT under a blind directory (`scripts/**` is outside src/judge and
// src/evidence, the two dirs `scripts/check-inv003.ts` guards), so it may value-import
// `sealEvidence`. What it seals still goes through the real chokepoint — `assertBlind`, the
// five-key whitelist, the deep-freeze — so a bench bundle is blind for the same reason a live one
// is. INV-001: nothing here writes `.program/`; `proposeSeating` returns a diff a human applies.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import {
  decodePrecedentsFile,
  judgeSeatHash,
  parseAssertionId,
  parseJudgeId,
  parsePathGlob,
  parseRepoPath,
  sealEvidence,
  unwrap,
  type AssertionView,
  type Hunk,
  type Judge,
  type JudgeSeat,
  type Precedent,
  type SealedEvidence,
} from '../src/core/index.js';
import type { ModelClient, ModelRequest, ModelStopReason } from '../src/core/model.js';
import {
  modelInvariantJudge,
  promptFileHash,
} from '../src/judge/model/invariant_judge.js';
import {
  proposeSeating,
  runBarExam,
  toBarExamCase,
  type BarExamCase,
  type BarExamReport,
  type ExpectedRuling,
  type SeatingProposal,
} from '../src/judge/bar_exam.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT: string = resolve(HERE, '..');

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 0. Provider + prompt identity (spec 03 §6: a judge = model id + prompt-file hash)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** The seated model id (claude-api reference). Exact string, no date suffix; the bench never calls it. */
export const JUDGE_MODEL = 'claude-opus-4-8';

/** The SHIPPED invariant-judge prompt, read read-only. Its sha256 is half the judge's identity. */
export const SHIPPED_PROMPT: string = readFileSync(
  join(REPO_ROOT, 'prompts/invariant-judge.md'),
  'utf8',
);

/**
 * A DELIBERATELY DEGRADED prompt, kept in tests/fixtures/ (never prompts/, which would re-seat the
 * real judge). Different bytes → different prompt hash → a different judge identity (spec 03 §6).
 */
export const DEGRADED_PROMPT: string = readFileSync(
  join(REPO_ROOT, 'tests/fixtures/bench/degraded-invariant-judge.md'),
  'utf8',
);

/** The manifest a seating proposal is diffed against: no judge seated yet. */
export const MANIFEST_YAML = [
  'schema_version: 0.1.0',
  'watermark:',
  '  last_walked: null',
  '  last_epoch: e0',
  'judges: []',
  '',
].join('\n');

export function shippedSeat(): JudgeSeat {
  return {
    id: unwrap(parseJudgeId('invariant-judge')),
    model: JUDGE_MODEL,
    prompt: promptFileHash(SHIPPED_PROMPT),
  };
}

/** Same seat NAME, degraded prompt: a mutated prompt hash is a different judge (spec 03 §6). */
export function degradedSeat(): JudgeSeat {
  return {
    id: unwrap(parseJudgeId('invariant-judge')),
    model: JUDGE_MODEL,
    prompt: promptFileHash(DEGRADED_PROMPT),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. The assertion under judgment and the sealed-bundle helpers
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** The judge-facing projection (spec 03 §3): id, statement, class, scope — no knobs (Q-21). */
export const BENCH_ASSERTION: AssertionView = {
  id: unwrap(parseAssertionId('INV-005')),
  statement: 'Engine core imports no forge-specific APIs; GitHub access lives in adapters/',
  class: 'dependency',
  scope: [unwrap(parsePathGlob('src/core/**'))],
};

const BENCH_CHARTER =
  'The engine core (src/core) stays forge-agnostic: no GitHub, GitLab or Bitbucket SDK may be ' +
  'imported from it. Forge access lives behind ports in adapters/. This is why INV-005 exists — a ' +
  'core that reaches a forge API cannot degrade to a bare repository.';

/** One hunk; `newLines` counts post-image lines so a citation can be checked against them. */
export function benchHunk(path: string, newStart: number, lines: readonly string[]): Hunk {
  return {
    path: unwrap(parseRepoPath(path)),
    oldStart: newStart,
    oldLines: 0,
    newStart,
    newLines: lines.filter((l) => !l.startsWith('-')).length,
    text: lines.join('\n'),
  };
}

/** Seal a bench bundle through the REAL chokepoint — nothing bypasses sealEvidence(). */
export function sealBench(hunks: readonly Hunk[]): SealedEvidence {
  return unwrap(
    sealEvidence({
      assertion: BENCH_ASSERTION,
      charterExcerpt: BENCH_CHARTER,
      hunks,
      ring: 'hunk' as const,
      precedent: null,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. The fixture case-law corpus (killed + affirmed + coincidence), replayed by the bar exam
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * One bench case: a precedent (loaded from the fixture), the sealed diff to re-judge, the settled
 * ruling a faithful judge owes it, and the canned YAML two fake models return —
 *   `faithfulReply`  — a clean ruling that matches `expected`;
 *   `degradedReply`  — what a judge running the DEGRADED prompt emits: an UNCITED violation on the
 *                      two violation cases (which the harness refuses → re-prompt → abstain), and
 *                      the same clean `aligned` on the coincidence case (the easy compliance).
 * `marker` is a sentinel rendered into the system prompt so `routedModel` can serve the right case.
 */
export interface BenchCase {
  readonly precedent: Precedent;
  readonly marker: string;
  readonly evidence: SealedEvidence;
  readonly expected: ExpectedRuling;
  readonly faithfulReply: string;
  readonly degradedReply: string;
}

interface CaseSpec {
  readonly id: string;
  readonly marker: string;
  readonly hunk: Hunk;
  readonly expected: ExpectedRuling;
  readonly faithfulReply: string;
  readonly degradedReply: string;
}

const KILLED_FAITHFUL = [
  'assertion: INV-005',
  'verdict: drift',
  'severity: breach',
  'confidence: 0.85',
  'evidence:',
  '  - src/core/http.ts:11',
  'precedent: null',
  'rationale: >',
  '  Octokit is value-imported into src/core, bypassing the adapter port — the killed pattern returns.',
].join('\n');

const KILLED_UNCITED = [
  'assertion: INV-005',
  'verdict: drift',
  'severity: breach',
  'confidence: 0.6',
  'precedent: null',
  'rationale: >',
  '  A forge dependency slipped into core.',
].join('\n');

const AFFIRMED_FAITHFUL = [
  'assertion: INV-005',
  'verdict: drift',
  'severity: grazes',
  'confidence: 0.7',
  'evidence:',
  '  - src/core/types.ts:6',
  'precedent: null',
  'rationale: >',
  '  A type-only forge import grazes the boundary; the vocabulary crosses even if no runtime dep does.',
].join('\n');

const AFFIRMED_UNCITED = [
  'assertion: INV-005',
  'verdict: drift',
  'severity: grazes',
  'confidence: 0.55',
  'precedent: null',
  'rationale: >',
  '  A forge type slipped into core.',
].join('\n');

/** Terse aligned (spec 03 §4): verdict + confidence only. */
export const ALIGNED_YAML = ['assertion: INV-005', 'verdict: aligned', 'confidence: 0.9'].join('\n');

const CASE_SPECS: readonly CaseSpec[] = [
  {
    id: 'PRE-201', // killed → the banned pattern reintroduced → drift/breach
    marker: 'bench:PRE-201',
    hunk: benchHunk('src/core/http.ts', 10, [
      '+// bench:PRE-201',
      "+import { Octokit } from '@octokit/rest';",
    ]),
    expected: { verdict: 'drift', severity: 'breach' },
    faithfulReply: KILLED_FAITHFUL,
    degradedReply: KILLED_UNCITED,
  },
  {
    id: 'PRE-202', // affirmed → contested and upheld → still a violation, on the grazes rung
    marker: 'bench:PRE-202',
    hunk: benchHunk('src/core/types.ts', 5, [
      '+// bench:PRE-202',
      "+import type { Octokit } from '@octokit/rest';",
    ]),
    expected: { verdict: 'drift', severity: 'grazes' },
    faithfulReply: AFFIRMED_FAITHFUL,
    degradedReply: AFFIRMED_UNCITED,
  },
  {
    id: 'PRE-203', // coincidence → a lookalike, a different mechanism → NOT a violation
    marker: 'bench:PRE-203',
    hunk: benchHunk('src/core/slug.ts', 1, [
      '+// bench:PRE-203',
      "+import slugger from 'github-slugger';",
    ]),
    expected: { verdict: 'aligned' },
    faithfulReply: ALIGNED_YAML,
    degradedReply: ALIGNED_YAML,
  },
];

/**
 * Load the fixture precedents (tests/fixtures/bench/precedents.yaml) through the real decoder and
 * pair each with its bench case. Sourced from the fixture file — NOT `.program/` — so the corpus is
 * genuinely replayed, not hard-coded (spec 03 §6).
 */
export function loadBenchCases(): readonly BenchCase[] {
  const yaml = readFileSync(join(REPO_ROOT, 'tests/fixtures/bench/precedents.yaml'), 'utf8');
  const precedents = unwrap(decodePrecedentsFile(parseYaml(yaml)));
  const byId = new Map<string, Precedent>(precedents.map((p) => [String(p.id), p]));
  return CASE_SPECS.map((spec) => {
    const precedent = byId.get(spec.id);
    if (precedent === undefined) {
      throw new Error(`fixture precedents.yaml is missing ${spec.id}`);
    }
    return {
      precedent,
      marker: spec.marker,
      evidence: sealBench([spec.hunk]),
      expected: spec.expected,
      faithfulReply: spec.faithfulReply,
      degradedReply: spec.degradedReply,
    };
  });
}

export function benchCaseById(id: string, cases: readonly BenchCase[] = loadBenchCases()): BenchCase {
  const found = cases.find((c) => String(c.precedent.id) === id);
  if (found === undefined) throw new Error(`no bench case for ${id}`);
  return found;
}

/** The bar-exam corpus: each fixture precedent lifted to a settled case (spec 03 §6). */
export function benchCorpus(cases: readonly BenchCase[] = loadBenchCases()): readonly BarExamCase[] {
  return cases.map((c) =>
    toBarExamCase({ precedent: c.precedent, evidence: c.evidence, expected: c.expected }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. Fake ModelClients (the ONLY way the bench reaches an LLM — canned YAML, no network)
// ═══════════════════════════════════════════════════════════════════════════════════════════

export interface CannedReply {
  readonly text?: string;
  readonly stopReason?: ModelStopReason;
  readonly modelId?: string;
}

export interface FakeModel {
  readonly client: ModelClient;
  /** Every request the harness sent — so "asked twice, once as a correction" is observable. */
  readonly calls: ModelRequest[];
}

/** Hands back canned replies in order (and records each request). Re-uses the last reply if asked again. */
export function orderedModel(replies: readonly CannedReply[], modelId: string = JUDGE_MODEL): FakeModel {
  const calls: ModelRequest[] = [];
  let i = 0;
  const client: ModelClient = {
    modelId,
    async complete(req) {
      calls.push(req);
      const r: CannedReply = replies[Math.min(i, replies.length - 1)] ?? {};
      i += 1;
      return { text: r.text ?? '', stopReason: r.stopReason ?? 'complete', modelId: r.modelId ?? modelId };
    },
  };
  return { client, calls };
}

/**
 * Content-addressed: routes on the FILLED system prompt, which carries each case's sentinel. Blind
 * — it reads only what the judge itself was shown (the rendered hunks), never authorship or a meter.
 */
export function routedModel(route: (system: string) => CannedReply, modelId: string = JUDGE_MODEL): FakeModel {
  const calls: ModelRequest[] = [];
  const client: ModelClient = {
    modelId,
    async complete(req) {
      calls.push(req);
      const r = route(req.system);
      return { text: r.text ?? '', stopReason: r.stopReason ?? 'complete', modelId: r.modelId ?? modelId };
    },
  };
  return { client, calls };
}

function benchRouter(cases: readonly BenchCase[], pick: (c: BenchCase) => string): (system: string) => CannedReply {
  return (system) => {
    for (const c of cases) {
      if (system.includes(c.marker)) return { text: pick(c) };
    }
    // A routing miss becomes an unparseable reply → re-prompt → abstain, never a silent pass.
    return { text: '' };
  };
}

/** Returns the settled ruling for every case — a faithful magistrate. */
export function faithfulBenchModel(cases: readonly BenchCase[] = loadBenchCases()): FakeModel {
  return routedModel(benchRouter(cases, (c) => c.faithfulReply));
}

/** Rules `aligned` on everything — the wrong-rulings degradation (misses both violations). */
export function degradedRulingsBenchModel(): FakeModel {
  return routedModel(() => ({ text: ALIGNED_YAML }));
}

/** Emits UNCITED violations on the two violation cases — the degraded-prompt degradation. */
export function degradedPromptBenchModel(cases: readonly BenchCase[] = loadBenchCases()): FakeModel {
  return routedModel(benchRouter(cases, (c) => c.degradedReply));
}

export function benchJudge(client: ModelClient, promptTemplate: string): Judge {
  return modelInvariantJudge({ client, promptTemplate });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4. Direct-contract fixtures (points 2 & 4: the same sealed case, three canned replies)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** The killed case's sealed bundle — a single drift-worthy hunk with a citable line (11). */
export function pointEvidence(): SealedEvidence {
  return benchCaseById('PRE-201').evidence;
}

/** Canned YAML for the direct re-prompt/abstain demonstrations, all against `pointEvidence()`. */
export const benchYaml = {
  /** A clean, cited drift — accepted as-is. */
  citedDrift: KILLED_FAITHFUL,
  /** A drift with NO evidence field — rejected (uncited-violation), re-prompted, then abstained. */
  uncitedDrift: KILLED_UNCITED,
  /** A drift whose severity is off the four anchors — rejected (invalid-severity). */
  offAnchorSeverity: KILLED_FAITHFUL.replace('severity: breach', 'severity: catastrophic'),
  aligned: ALIGNED_YAML,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 5. The whole bench, run once (the demo main + the test's headline)
// ═══════════════════════════════════════════════════════════════════════════════════════════

export interface BenchOutcome {
  readonly corpus: readonly BarExamCase[];
  /** The shipped prompt + a faithful model: PASSES, and seats. */
  readonly faithful: BarExamReport;
  /** The shipped prompt + a wrong-rulings model: FAILS. */
  readonly degradedRulings: BarExamReport;
  /** The degraded prompt + an uncited-violation model: FAILS (abstains on the violations). */
  readonly degradedPrompt: BarExamReport;
  /** The PROPOSED manifest diff a passing bar exam authorizes (never a `.program/` write). */
  readonly seating: SeatingProposal;
}

export async function runBench(cases: readonly BenchCase[] = loadBenchCases()): Promise<BenchOutcome> {
  const corpus = benchCorpus(cases);

  const faithful = await runBarExam(
    shippedSeat(),
    benchJudge(faithfulBenchModel(cases).client, SHIPPED_PROMPT),
    corpus,
  );
  const degradedRulings = await runBarExam(
    shippedSeat(),
    benchJudge(degradedRulingsBenchModel().client, SHIPPED_PROMPT),
    corpus,
  );
  const degradedPrompt = await runBarExam(
    degradedSeat(),
    benchJudge(degradedPromptBenchModel(cases).client, DEGRADED_PROMPT),
    corpus,
  );

  // Only the faithful, passing run may be spent on a seating proposal (spec 03 §6).
  const seating = proposeSeating(MANIFEST_YAML, shippedSeat(), faithful);

  return { corpus, faithful, degradedRulings, degradedPrompt, seating };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6. Entry point
// ═══════════════════════════════════════════════════════════════════════════════════════════

const USAGE = `demo-v05 — the SEED-03 bar exam ("the bench"), run once and printed

Replays a fixture case-law corpus (killed + affirmed + coincidence) against a FAKE model judge:
the faithful judge passes and yields a PROPOSED manifest diff; a wrong-rulings judge and a
degraded-prompt judge both fail and are blocked from seating. No network, no .program/ write.

Usage:
  npx tsx scripts/demo-v05.ts [--diff] [--help]

  --diff   print the proposed manifest seating diff in full
`;

function reportLine(label: string, r: BarExamReport): string {
  return `  ${label.padEnd(22)} ${r.passed}/${r.total} matched, seating ${r.seatingAllowed ? 'ALLOWED' : 'BLOCKED'}`;
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  const out: string[] = [];
  const bench = await runBench();

  out.push('the bench — SEED-03 bar exam over the fixture case law');
  out.push('');
  out.push(`  corpus                 ${bench.corpus.length} settled cases (${bench.corpus.map((c) => c.id).join(', ')})`);
  out.push(`  shipped seat hash      ${bench.faithful.seatHash}`);
  out.push(`  degraded seat hash     ${unwrap(judgeSeatHash(degradedSeat()))}`);
  out.push('');
  out.push('bar exam');
  out.push(reportLine('faithful (shipped)', bench.faithful));
  out.push(reportLine('degraded rulings', bench.degradedRulings));
  out.push(reportLine('degraded prompt', bench.degradedPrompt));
  out.push('');
  out.push('seating (a passing bar exam → a PROPOSED diff; a human ratifies, INV-001)');
  out.push(`  proposed for           ${bench.seating.seat.id} @ ${bench.seating.seat.model}`);
  out.push(`  seat hash              ${bench.seating.seatHash}`);
  if (argv.includes('--diff')) {
    out.push('');
    out.push('─'.repeat(78));
    out.push(bench.seating.diff);
    out.push('─'.repeat(78));
  }
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return entry.endsWith('demo-v05.ts') || entry.endsWith('demo-v05.js');
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      process.stderr.write(`demo-v05: ${(e as Error).message}\n`);
      process.exitCode = 1;
    });
}
