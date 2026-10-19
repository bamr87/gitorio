#!/usr/bin/env node
// Implements: ROADMAP.md v1.5 — "the historian" — and seeds/SEED-04-distillation-miner.md's
// Acceptance: "Run against a real mid-size OSS repo fixture: fact base builds; >= 2 plausible epochs
// found; candidates all carry provenance; ratification PR renders; rejecting a candidate then
// re-running does not re-propose it; backfilled accumulators show pre-decayed values matching hand
// computation." (docs/spec/04-distillation.md §1–§8.)
//
// THE WHOLE COLD-START WALK, END TO END, IN ONE FILE — the loop run in reverse (spec 04 §0):
//
//   build fixture ─▶ distillWalk ─▶ fact base + epochs ─▶ synthesize (FAKE ModelClient) ─▶ candidates
//   (build-fixture)  (src/distill)   (§1/§2)               (§3/§4, through the core ModelClient port)
//                                                                     │
//        backfill ◀── seat fixture INV-001 ◀── ratify (top ~12) ◀── candidates (status: inferred)
//     (§7/§8 replay)   (deterministic judge)   (§6 PROPOSAL, never .program/)
//
// WHY THE PIPELINE LIVES IN scripts/ AND NOT IN THE TEST. `tests/exit-test-v15.test.ts` imports the
// reusable pieces from here and asserts against them, exactly as `tests/exit-test-v0.test.ts` imports
// from `scripts/demo-v0.ts` and `tests/exit-test-v05.test.ts` from `scripts/demo-v05.ts`. One
// implementation, two callers: a demo a human runs and reads (`npx tsx scripts/demo-v15.ts`), and a
// re-runnable exit test that pins every claim it makes. It WIRES the modules the parallel agents
// shipped (src/distill/**) and the synthetic fixture the Wire agent produced
// (tests/fixtures/distill/build-fixture.ts) — it reimplements NONE of them.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  EVERY GIT WRITE HAPPENS IN A THROWAWAY REPOSITORY UNDER $TMPDIR. Nothing here writes the repo it
//  is checked into: no commit, no ref, and above all no `refs/program/ledger` in
//  git-with-the-program itself. The distillation walk is READ-ONLY git (spec 04 §2); the ledger the
//  backfill appends to is a throwaway `refs/program/ledger-*` in the throwaway fixture.
//
//  INV-001: nothing in this file writes `.program/` in either repository. The ratification proposal
//  is a `.program/invariants.yaml` PATCH plus a file under `proposals/`; the watermark advance is a
//  `.program/manifest.yaml` PATCH. A human applies them, under their own name, in a reviewed PR —
//  that is the whole of the invariant, enforced here by the ABSENCE of any `.program/` write path.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// INV-005 / constraint 3: this file imports src/core, src/ledger, src/judge/deterministic, src/distill
// and the shared fixture — no `@anthropic-ai/sdk`, no provider SDK. Pass-two synthesis reaches a model
// ONLY through the core-side `ModelClient` port, and the port injected here is a FAKE returning canned
// candidates, so no network is reachable.
//
// INV-003: the synthesis prompt is a pure function of the author-free `EpochSynthesisInput` views
// (the author-file matrix stays dispersion-side), so no author identity reaches the model. The
// backfill judge is handed only `SealedEvidence`, already stripped of author identity.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import {
  type CandidateAssertion,
  type CommitSha,
  type CommitterTime,
  type Hunk,
  type Precedent,
  type RatifiedAssertion,
  committerTimeFromEpochMillis,
  decodeInvariantsFile,
  isEnforceable,
  parseCommitSha,
  parseEpochId,
  parseRepoPath,
  unwrap,
} from '../src/core/index.js';
import type { ModelClient, ModelRequest, ModelResponse } from '../src/core/model.js';
import { createGitExec, type GitExec } from '../src/ledger/git.js';
import { GitRefEventStore } from '../src/ledger/index.js';
import { IMPORT_BOUNDARY_JUDGE, judgeImportBoundary } from '../src/judge/deterministic/imports.js';
import {
  type BackfillCommit,
  type BackfillLedgerResult,
  type BackfillStrength,
  type DistilledWalk,
  type RatificationProposal,
  type RegularityKey,
  type SeatedBackfillJudge,
  type SynthesisResult,
  backfillLedger,
  backfillTierOf,
  buildRatificationProposal,
  buildTombstoneCorpus,
  distillWalk,
  epochSynthesisInputs,
  knobsForAssertions,
  measureBackfillStrength,
  rejectCandidate,
  serializeFactBase,
  synthesize,
} from '../src/distill/index.js';
import { buildDistillFixture, type DistillFixture } from '../tests/fixtures/distill/build-fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT: string = resolve(HERE, '..');

/** A plausible repo URL for provenance links in a rendered ratification proposal. */
export const DEMO_REPO_URL = 'https://github.com/bamr87/git-with-the-program';

/** Walk the whole history; a resume would pass the watermark's `last_walked` as `from`. */
export const WHOLE_RANGE = { from: null, to: 'HEAD' } as const;

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. Pass two through a FAKE ModelClient (the core port, INV-005) — canned candidates
// ═══════════════════════════════════════════════════════════════════════════════════════════

export const FAKE_SYNTHESIS_MODEL_ID = 'fake-distill-synthesizer';

export interface CountingModel extends ModelClient {
  calls: number;
}

/**
 * A `ModelClient` that returns the SAME canned reply on every call — one call per epoch (spec 04
 * §3). No network: the whole point of the exit test is that pass two runs THROUGH the core-side port
 * with a fake behind it (INV-005). Returning a constant reply is what lets the merge agent see the
 * same law surface in every epoch and combine its provenance (spec 04 §3).
 */
export function cannedSynthesisModel(replyText: string): CountingModel {
  const client: CountingModel = {
    modelId: FAKE_SYNTHESIS_MODEL_ID,
    calls: 0,
    complete(_req: ModelRequest): Promise<ModelResponse> {
      client.calls += 1;
      return Promise.resolve({ text: replyText, stopReason: 'complete', modelId: client.modelId });
    },
  };
  return client;
}

/**
 * The canned pass-two reply, crafted against the fixture's OWN observations so every provenance ref
 * is authentic (spec 01 §4 rule 1). Three candidates on purpose:
 *   A — the proven `core/**` boundary (the firmest law, spec 04 §2), WITH provenance.
 *   B — `app/**` owns the third-party dep the manifest upheaval introduced, WITH provenance.
 *   C — a DELIBERATELY provenance-free candidate, so the walk demonstrates that an uncited
 *       regularity is rejected BEFORE it can be proposed (spec 01 §4 rule 1).
 * The statements are >= 8 chars and the scopes are valid globs, so only C's missing provenance
 * causes a drop.
 */
export function cannedCandidatesReply(fx: DistillFixture): string {
  return JSON.stringify({
    candidates: [
      {
        statement: 'core/** imports no third-party modules; the boundary held violation-free across history',
        class: 'dependency',
        scope: ['core/**'],
        enforcement: 'deterministic',
        kind: 'statute',
        provenance: ['negative-space:core-external-purity', `commit ${fx.head}`],
      },
      {
        statement: 'app/** owns all third-party dependencies; core declares ports only',
        class: 'dependency',
        scope: ['app/**'],
        enforcement: 'judgment',
        kind: 'statute',
        provenance: ['manifest:package.json left-pad', `commit ${fx.upheavalSha}`],
      },
      {
        // No `provenance` field: an unreviewable, therefore unratifiable, regularity (spec 01 §4).
        statement: 'the monolith era named its packages after single letters',
        class: 'convention',
        scope: ['oldpkg/**'],
        kind: 'trajectory',
      },
    ],
  });
}

/** The regularity key a re-run tombstone-matches on — the statement of candidate A above. */
export const CORE_BOUNDARY_STATEMENT =
  'core/** imports no third-party modules; the boundary held violation-free across history';

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. The read-only distillation walk (spec 04 §1–§2)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** Build the synthetic fixture under `dir` and run the whole read-only walk over it. */
export async function runDistillWalk(git: GitExec): Promise<DistilledWalk> {
  const walked = await distillWalk(git, WHOLE_RANGE);
  if (!walked.ok) throw new Error(`distillWalk: ${walked.error.detail}`);
  return walked.value;
}

/** The fact base serialized to its canonical, byte-stable form (determinism, spec 04 §2/§8). */
export function factBaseBytes(walk: DistilledWalk): string {
  return unwrap(serializeFactBase(walk.factBase));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. Synthesis + ratification (spec 04 §3–§6)
// ═══════════════════════════════════════════════════════════════════════════════════════════

export interface SynthesisRun {
  readonly result: SynthesisResult;
  readonly candidates: readonly CandidateAssertion[];
  readonly model: CountingModel;
}

/**
 * Run pass two over the walk's epochs through the fake port, optionally filtering by a tombstone
 * corpus (spec 04 §6). Returns both the raw result and the bare `CandidateAssertion[]` a ratification
 * proposal consumes.
 */
export async function runSynthesis(
  walk: DistilledWalk,
  replyText: string,
  tombstonePrecedents: readonly Precedent[] = [],
  priorRejections: readonly RegularityKey[] = [],
): Promise<SynthesisRun> {
  const model = cannedSynthesisModel(replyText);
  const epochs = epochSynthesisInputs(walk.factBase, walk.segmentation);
  const outcome = await synthesize(model, {
    epochs,
    tombstones: buildTombstoneCorpus(tombstonePrecedents, priorRejections),
  });
  if (!outcome.ok) {
    throw new Error(`synthesize: model-call cap ${outcome.error.cap} < ${outcome.error.requested} epochs`);
  }
  return { result: outcome.value, candidates: outcome.value.candidates.map((c) => c.assertion), model };
}

/** Build the ratification PROPOSAL from candidates against the fixture's own invariants text. */
export function buildProposal(
  candidates: readonly CandidateAssertion[],
  invariantsYaml: string,
  opts: { readonly precedents?: readonly Precedent[]; readonly priorRejections?: readonly RegularityKey[] } = {},
): RatificationProposal {
  return unwrap(
    buildRatificationProposal({
      candidates,
      invariantsYaml,
      repoUrl: DEMO_REPO_URL,
      ...(opts.precedents !== undefined ? { precedents: opts.precedents } : {}),
      ...(opts.priorRejections !== undefined ? { priorRejections: opts.priorRejections } : {}),
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4. Backfill — priming the ledger, pre-decayed on committer time (spec 04 §7–§8)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * THE ARITHMETIC, HAND-COMPUTED, so the exit test asserts against a number a reviewer checks with a
 * calculator rather than against whatever the code produced.
 *
 * The fixture's own ratified INV-001 (`class: dependency`, `scope: [core/**]`, `precision: 1.0`,
 * `half_life: 90d`) is seated as the deterministic import-boundary judge. An eight-month-old breach
 * — a re-export of a forge SDK into `core/`, which the judge rules `entrenches` (severity 1.0) —
 * arrives carrying its COMMITTER time (ADR-0004), so the leaky integrator ages it on arrival:
 *
 *   increment        = precision_at · severity = 1.0 × 1.0 = 1.0            (fresh, pre-decayed)
 *   Δt               = 8 months = 8 × 30d = 240 committer-days   (mo = 30d, OPEN-QUESTIONS Q-01)
 *   surviving factor = 2^(−Δt / half_life) = 2^(−240/90) = 2^(−2.6̄) ≈ 0.157490
 *   decayed          = 1.0 × 0.157490 ≈ 0.157490                            (~15% strength, spec 04 §7)
 *
 * The eight-month-old breach survives to ~15.7% of a fresh one: history is absorbed WITHOUT firing on
 * stale news, but a currently-underway drift starts the accumulator warm instead of blind.
 */
export const V15_BACKFILL = {
  precision: 1.0,
  severity: 1.0, // re-export of a forge module → `entrenches` (IMPORT_FORM_SEVERITY)
  increment: 1.0,
  halfLifeDays: 90,
  ageDays: 240, // 8 months × 30d
  survivingFraction: 2 ** (-240 / 90), // ≈ 0.157490
  breachMs: Date.parse('2025-11-01T00:00:00Z'),
  asOfMs: Date.parse('2025-11-01T00:00:00Z') + 240 * 86_400_000,
} as const;

export const BREACH_COMMITTER_TIME: CommitterTime = unwrap(committerTimeFromEpochMillis(V15_BACKFILL.breachMs));
export const BACKFILL_AS_OF: CommitterTime = unwrap(committerTimeFromEpochMillis(V15_BACKFILL.asOfMs));

/** A clearly-synthetic sha for the injected breach; not a fixture commit (it exercises the decay path). */
export const INJECTED_BREACH_SHA: CommitSha = unwrap(parseCommitSha('de5709de5709de5709de5709de5709de5709de57'));

/** A re-export of a forge SDK into `core/` — the judge rules this `entrenches` (severity 1.0). */
export function forgeReExportHunk(path = 'core/forge.ts'): Hunk {
  return {
    path: unwrap(parseRepoPath(path)),
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: 1,
    text: `+export { Octokit } from '@octokit/rest';`,
  };
}

/**
 * Seat the fixture's OWN ratified `core/**` dependency invariant as the deterministic import-boundary
 * judge (spec 02 §7: deterministic class runs on every commit). Only a `RatifiedAssertion` may be
 * replayed — `inferred` is not enforced (spec 01 §4.2) — so this narrows and fails loudly otherwise.
 */
export function seatFixtureBoundaryJudge(invariantsYaml: string, id = 'INV-001'): SeatedBackfillJudge {
  const all = unwrap(decodeInvariantsFile(parseYaml(invariantsYaml)));
  const a = all.find((x) => x.id === id);
  if (a === undefined || !isEnforceable(a)) {
    throw new Error(`fixture invariant ${id} is not a ratified, enforceable assertion`);
  }
  const assertion: RatifiedAssertion = a;
  return {
    assertion,
    tier: backfillTierOf(assertion.enforcement),
    ref: IMPORT_BOUNDARY_JUDGE,
    judge: judgeImportBoundary,
  };
}

export interface BackfillRun {
  readonly ledger: BackfillLedgerResult;
  readonly strengths: readonly BackfillStrength[];
  readonly seat: SeatedBackfillJudge;
}

/**
 * Replay a single eight-month-old breach through the seated fixture invariant into a THROWAWAY
 * ledger, propose the watermark advance from the fixture's manifest (spec 04 §8), and measure the
 * pre-decayed value the fold lands on as of `BACKFILL_AS_OF`. Nothing under `.program/` is written.
 */
export async function runBackfill(
  store: GitRefEventStore,
  invariantsYaml: string,
  manifestYaml: string,
): Promise<BackfillRun> {
  const seat = seatFixtureBoundaryJudge(invariantsYaml);
  const breach: BackfillCommit = {
    sha: INJECTED_BREACH_SHA,
    committerTime: BREACH_COMMITTER_TIME,
    isMerge: false,
    hunks: [forgeReExportHunk()],
  };

  const run = await backfillLedger({
    commits: [breach],
    judges: [seat],
    store,
    manifestYaml,
    lastEpoch: unwrap(parseEpochId('e1')),
  });
  if (!run.ok) {
    throw new Error(`backfill: judged-merge cap ${run.error.cap} exceeded at ${run.error.stoppedAt}`);
  }

  const events = await store.list();
  const strengths = unwrap(
    measureBackfillStrength(events, knobsForAssertions([seat.assertion]), BACKFILL_AS_OF),
  );
  return { ledger: run.value, strengths, seat };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 5. Entry point — run the whole walk once against a throwaway fixture and print it
// ═══════════════════════════════════════════════════════════════════════════════════════════

const USAGE = `demo-v15 — the ROADMAP v1.5 exit test ("the historian"), run once and printed

Builds a SYNTHETIC-by-construction fixture repo under $TMPDIR (never this one), runs the cold-start
distillation walk over it — fact base, epochs, synthesis through a FAKE ModelClient, ratification
proposal, ledger backfill — and prints what the walk inferred. Writes nothing under .program/.

Usage:
  npx tsx scripts/demo-v15.ts [--keep] [--help]

  --keep   leave the fixture repository on disk and print its path
`;

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  const keep = argv.includes('--keep');

  const dir = mkdtempSync(join(tmpdir(), 'gwtp-demo-v15-'));
  const fx = buildDistillFixture(dir);
  const invariantsYaml = readFileSync(join(dir, '.program', 'invariants.yaml'), 'utf8');
  const manifestYaml = readFileSync(join(dir, '.program', 'manifest.yaml'), 'utf8');

  try {
    const git = createGitExec({ cwd: dir });
    const walk = await runDistillWalk(git);
    const synth = await runSynthesis(walk, cannedCandidatesReply(fx));
    const proposal = buildProposal(synth.candidates, invariantsYaml);

    const store = new GitRefEventStore({ cwd: dir, ref: 'refs/program/ledger-demo-v15', now: () => new Date(0) });
    const backfill = await runBackfill(store, invariantsYaml, manifestYaml);
    const boundaryStrength = backfill.strengths.find((s) => s.key === backfill.seat.assertion.id);

    const out: string[] = [];
    out.push(`fixture repository      ${dir}`);
    out.push(`fact base bytes         ${factBaseBytes(walk).length} (canonical, byte-stable)`);
    out.push(`epochs found            ${walk.segmentation.epochs.length} (detector ${walk.segmentation.detector})`);
    for (const e of walk.segmentation.epochs) {
      const signals = e.openedBy === null ? 'seed' : e.openedBy.triggers.map((t) => `${t.signal} z=${t.z.toFixed(2)}`).join(', ');
      out.push(`  ${e.id}${e.isFinal ? ' (final)' : '       '}  commits ${e.commitCount}  opened by: ${signals}`);
    }
    out.push('');
    out.push(`model calls             ${synth.model.calls} (one per epoch, FAKE port — no network)`);
    out.push(`candidates synthesized  ${synth.result.candidates.length} (all status: inferred)`);
    for (const c of synth.result.candidates) {
      out.push(`  ${c.assertion.id}  seed ${c.assertion.precision_seed ?? c.assertion.precision}  ${c.assertion.statement}`);
    }
    out.push(`dropped                 ${synth.result.dropped.map((d) => d.reason).join(', ') || '(none)'}`);
    out.push('');
    out.push(`ratification proposal    ${proposal.proposed.length} proposed / ${proposal.deferred.length} deferred (cap 12)`);
    out.push(`  patches               ${proposal.patches.map((p) => p.path).join(', ')} — a PATCH, never a write`);
    out.push('');
    out.push('backfill (spec 04 §7) — pre-decayed on committer time');
    if (boundaryStrength !== undefined) {
      out.push(
        `  ${boundaryStrength.key}   fresh ${boundaryStrength.preDecayed.toFixed(6)} → ` +
          `8-month-decayed ${boundaryStrength.decayed.toFixed(6)} (~15%, expected ${V15_BACKFILL.survivingFraction.toFixed(6)})`,
      );
    }
    out.push(`  watermark advance     ${backfill.ledger.watermark?.path ?? '(none)'} — PROPOSED, never written`);
    out.push('');
    process.stdout.write(`${out.join('\n')}\n`);
    if (keep) process.stdout.write(`fixture kept at ${dir}\n`);
    return 0;
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true });
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return entry.endsWith('demo-v15.ts') || entry.endsWith('demo-v15.js');
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      process.stderr.write(`demo-v15: ${(e as Error).message}\n`);
      process.exitCode = 1;
    });
}
