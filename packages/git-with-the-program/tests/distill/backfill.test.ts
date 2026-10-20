// SEED-04 deliverable 6 — priming the ledger (docs/spec/04-distillation.md §7, §8).
//
// Asserts the seed's acceptance for backfill:
//   1. an eight-month-old breach against a 90-day half-life lands at ~15% strength — the exact
//      number computed against a calculator (2^(-8·30/90) ≈ 0.157490), because decay runs on
//      COMMITTER time so backfilled events arrive pre-decayed (spec 04 §7, ADR-0004);
//   2. deterministic-class assertions backfill FULLY (every commit); the judged-merge cost cap
//      STOPS the run and reports it when exceeded, without spending the call over the cap;
//   3. the watermark advance is a PROPOSED `.program/manifest.yaml` change, not a write.
//
// EVERY GIT WRITE HAPPENS IN A THROWAWAY REPOSITORY UNDER $TMPDIR. The ledger is appended to a
// throwaway `refs/program/ledger-*` there; the repository this test is checked into is only read,
// and its `.program/` is asserted clean at the end.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AccumulatorKey,
  type CommitSha,
  type CommitterTime,
  type Hunk,
  type Judge,
  type JudgeRef,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type RatifiedAssertion,
  type SealedEvidence,
  type Verdict,
  committerTimeFromEpochMillis,
  decodeInvariantsFile,
  decodeManifest,
  isEnforceable,
  isViolationEvent,
  parseCommitSha,
  parseConfidence,
  parseEpochId,
  parseJudgeId,
  parseRepoPath,
  unwrap,
} from '../../src/core/index.js';
import { GitRefEventStore } from '../../src/ledger/index.js';
import {
  IMPORT_BOUNDARY_JUDGE,
  judgeImportBoundary,
} from '../../src/judge/deterministic/imports.js';
import {
  type BackfillCommit,
  type SeatedBackfillJudge,
  MANIFEST_PATH,
  backfillLedger,
  backfillTierOf,
  knobsForAssertions,
  measureBackfillStrength,
  proposeWatermarkAdvance,
  replayEpoch,
} from '../../src/distill/backfill.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CERTAIN = unwrap(parseConfidence(1));

function hostGit(args: readonly string[]): string {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

const PROGRAM_STATUS_BEFORE = hostGit(['status', '--porcelain', '--', '.program']).trim();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function ratifiedAssertion(yaml: string): RatifiedAssertion {
  const all = unwrap(decodeInvariantsFile(parseYaml(yaml)));
  const a = all[0];
  if (a === undefined || !isEnforceable(a)) throw new Error('fixture is not a ratified invariant');
  return a;
}

/** A deterministic-class dependency assertion, precision 1.0, half_life 90d (the 15% fixture). */
const DEP_ASSERTION = ratifiedAssertion(
  [
    '- id: INV-050',
    '  statement: Engine core imports no forge-specific APIs; adapters own them',
    '  class: dependency',
    '  scope: ["src/core/**"]',
    '  enforcement: deterministic',
    '  precision: 1.0',
    '  budget: 3.0',
    '  half_life: 90d',
    '  status: ratified',
    '  provenance: [design-thread-2026-07]',
  ].join('\n'),
);

/** A judgment-class assertion — replays at merge granularity, priced against the cost cap. */
const JUDGMENT_ASSERTION = ratifiedAssertion(
  [
    '- id: INV-051',
    '  statement: Public interfaces stay backward compatible within an epoch',
    '  class: interface',
    '  scope: ["src/core/**"]',
    '  enforcement: judgment',
    '  precision: 0.8',
    '  budget: 5.0',
    '  half_life: 120d',
    '  status: ratified',
    '  provenance: [design-thread-2026-07]',
  ].join('\n'),
);

const MANIFEST_FIXTURE = [
  'schema_version: 0.1.0',
  'watermark:',
  '  last_walked: null        # no history yet — this program was authored, not distilled',
  '  last_epoch: e0',
  'judges: []',
  '',
].join('\n');

let shaCounter = 0;
function nextSha(): CommitSha {
  shaCounter += 1;
  return unwrap(parseCommitSha(shaCounter.toString(16).padStart(8, '0')));
}

const T0 = unwrap(committerTimeFromEpochMillis(Date.parse('2026-01-01T00:00:00Z')));

function commit(opts: {
  readonly isMerge: boolean;
  readonly hunks?: readonly Hunk[];
  readonly at?: CommitterTime;
}): BackfillCommit {
  return {
    sha: nextSha(),
    committerTime: opts.at ?? T0,
    isMerge: opts.isMerge,
    hunks: opts.hunks ?? [],
  };
}

// A fake ModelClient — no network. The judgment judge reaches its model ONLY through this core-side
// port (INV-005 / constraint 3); it never sees author identity, because it is handed SealedEvidence.
function fakeModelClient(): ModelClient & { calls: number } {
  const client = {
    modelId: 'fake-model',
    calls: 0,
    complete(_req: ModelRequest): Promise<ModelResponse> {
      client.calls += 1;
      return Promise.resolve({ text: 'abstain', stopReason: 'complete' as const, modelId: 'fake-model' });
    },
  };
  return client;
}

const MODEL_JUDGE_REF: JudgeRef = { kind: 'model', id: unwrap(parseJudgeId('fake-invariant-judge')) };

function modelBackedJudge(client: ModelClient, assertion: AccumulatorKey): Judge {
  return async (sealed: SealedEvidence): Promise<Verdict> => {
    // Prove the model is reached through the port and given only the sealed (author-free) bundle.
    await client.complete({ system: 'invariant-judge', user: JSON.stringify(sealed.hunkHash) });
    return { assertion, verdict: 'abstain', confidence: CERTAIN };
  };
}

const deterministicSeat: SeatedBackfillJudge = {
  assertion: DEP_ASSERTION,
  tier: backfillTierOf(DEP_ASSERTION.enforcement),
  ref: IMPORT_BOUNDARY_JUDGE,
  judge: judgeImportBoundary,
};

// A src/core/** re-export of a forge SDK: the import-boundary judge rules this `entrenches` (1.0),
// so with precision 1.0 the fresh increment is exactly 1.0 — the clean "full-strength breach" the
// 15% decay fixture needs.
const BREACH_HUNK = hunk('src/core/x.ts', 1, [`+export { Octokit } from '@octokit/rest';`]);

// ---------------------------------------------------------------------------
// The throwaway ledger substrate
// ---------------------------------------------------------------------------

let repoDir = '';
beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'gwtp-backfill-'));
  execFileSync('git', ['-C', repoDir, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@fixture.invalid']);
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'test']);
  execFileSync('git', ['-C', repoDir, 'config', 'commit.gpgsign', 'false']);
});
afterAll(() => {
  if (repoDir !== '') rmSync(repoDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. Backfilled events arrive PRE-DECAYED — the 15% fixture (spec 04 §7)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('an 8-month-old breach lands at ~15% strength (spec 04 §7)', () => {
  const breachMs = Date.parse('2025-11-01T00:00:00Z');
  const asOfMs = breachMs + 240 * 86_400_000; // 8 months = 8 × 30d (mo = 30d, Q-01) = 240 days
  const breachTime = unwrap(committerTimeFromEpochMillis(breachMs));
  const asOf = unwrap(committerTimeFromEpochMillis(asOfMs));

  it('mints a committer-timed drift event, appends it, and folds to the hand-computed value', async () => {
    const store = new GitRefEventStore({ cwd: repoDir, ref: 'refs/program/ledger-strength', now: () => new Date(0) });
    const breach: BackfillCommit = { sha: nextSha(), committerTime: breachTime, isMerge: false, hunks: [BREACH_HUNK] };

    const run = await backfillLedger({
      commits: [breach],
      judges: [deterministicSeat],
      store,
      manifestYaml: MANIFEST_FIXTURE,
    });
    expect(run.ok, JSON.stringify(run)).toBe(true);
    if (!run.ok) throw new Error('backfill failed');
    expect(run.value.result.events).toHaveLength(1);
    expect(run.value.append.written).toHaveLength(1);

    // Committer time is carried onto the event (ADR-0004), so decay applies on arrival.
    const events = await store.list();
    const violation = events.find(isViolationEvent);
    expect(violation, 'the breach produced no drift event').toBeDefined();
    expect(violation!.t).toBe(breachTime);
    expect(violation!.severity).toBe(1); // re-export → entrenches → 1.0

    // THE ARITHMETIC, checked against a calculator (spec 04 §7):
    //   increment       = precision_at · severity = 1.0 × 1.0 = 1.0        (fresh, pre-decayed)
    //   Δt              = 240 committer-days (8 months, mo = 30d — Q-01)
    //   surviving factor = 2^(−240/90) = 2^(−2.6667) ≈ 0.157490
    //   decayed         = 1.0 × 0.157490 ≈ 0.157490                        (~15% strength)
    const expectedFraction = Math.pow(2, -240 / 90);
    const strengths = unwrap(measureBackfillStrength(events, knobsForAssertions([DEP_ASSERTION]), asOf));
    const s = strengths.find((x) => x.key === 'INV-050');
    expect(s, 'no strength for INV-050').toBeDefined();

    expect(s!.preDecayed).toBeCloseTo(1.0, 9); // the fresh increment, exposed for a hand check
    expect(s!.decayed).toBeCloseTo(expectedFraction, 9);
    expect(s!.decayed).toBeCloseTo(0.157490, 6);
    expect(s!.survivingFraction).toBeCloseTo(expectedFraction, 9);
    // "~15% strength": the eight-month-old breach survives to between 15% and 16% of a fresh one.
    expect(s!.decayed).toBeGreaterThan(0.15);
    expect(s!.decayed).toBeLessThan(0.16);
  });

  it('projecting to an instant BEFORE the event never amplifies (decay clamps at 1)', async () => {
    const store = new GitRefEventStore({ cwd: repoDir, ref: 'refs/program/ledger-strength', now: () => new Date(0) });
    const events = await store.list();
    const strengths = unwrap(
      measureBackfillStrength(events, knobsForAssertions([DEP_ASSERTION]), breachTime),
    );
    const s = strengths.find((x) => x.key === 'INV-050');
    expect(s!.decayed).toBeCloseTo(1.0, 9); // as of the event's own instant, undecayed
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. Deterministic-class backfills FULLY; judgment-class only at merges (spec 02 §7)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('tiered replay: deterministic every commit, judgment at merges only', () => {
  it('judges a deterministic-class assertion on every commit — merges included', async () => {
    const commits = [
      commit({ isMerge: false, hunks: [BREACH_HUNK] }), // drift
      commit({ isMerge: true }), // merge, no own content
      commit({ isMerge: false, hunks: [hunk('src/core/y.ts', 1, [`+import { createHash } from 'node:crypto';`])] }), // aligned
      commit({ isMerge: false, hunks: [hunk('docs/notes.md', 1, [`+import { Octokit } from '@octokit/rest';`])] }), // out of scope → abstain
    ];
    const run = await replayEpoch({ commits, judges: [deterministicSeat] });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error('replay failed');
    expect(run.value.commitsReplayed).toBe(4);
    expect(run.value.deterministicJudgements).toBe(4); // one per commit, none skipped
    expect(run.value.judgedMerges).toBe(0);
    expect(run.value.events).toHaveLength(4);
    // Every event carries the commit's committer time.
    for (const v of run.value.verdicts) expect(v.event.t).toBe(v.committerTime);
  });

  it('judges a judgment-class assertion at merges ONLY, and prices each judged merge', async () => {
    const client = fakeModelClient();
    const seat: SeatedBackfillJudge = {
      assertion: JUDGMENT_ASSERTION,
      tier: backfillTierOf(JUDGMENT_ASSERTION.enforcement),
      ref: MODEL_JUDGE_REF,
      judge: modelBackedJudge(client, JUDGMENT_ASSERTION.id),
    };
    expect(seat.tier).toBe('judgment');

    const commits = [
      commit({ isMerge: false }), // skipped: judgment class does not replay non-merges
      commit({ isMerge: true }),
      commit({ isMerge: false }), // skipped
      commit({ isMerge: true }),
    ];
    const run = await replayEpoch({ commits, judges: [seat], budget: { maxJudgedMerges: 5 } });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error('replay failed');
    expect(run.value.judgedMerges).toBe(2); // two merges judged, two non-merges skipped
    expect(run.value.deterministicJudgements).toBe(0);
    expect(client.calls).toBe(2); // the model port was reached exactly at the two merges
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. The judged-merge cost cap stops the run and reports it (spec 04 §7, constraint 5)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('the judged-merge cost cap (spec 04 §7)', () => {
  it('stops and reports when exceeded, without spending the call over the cap', async () => {
    const client = fakeModelClient();
    const seat: SeatedBackfillJudge = {
      assertion: JUDGMENT_ASSERTION,
      tier: 'judgment',
      ref: MODEL_JUDGE_REF,
      judge: modelBackedJudge(client, JUDGMENT_ASSERTION.id),
    };
    const m1 = commit({ isMerge: true });
    const m2 = commit({ isMerge: true });
    const m3 = commit({ isMerge: true });

    const run = await replayEpoch({ commits: [m1, m2, m3], judges: [seat], budget: { maxJudgedMerges: 2 } });
    expect(run.ok).toBe(false);
    if (run.ok) throw new Error('expected the cap to stop the run');
    expect(run.error.reason).toBe('judged-merge-cap-exceeded');
    expect(run.error.cap).toBe(2);
    expect(run.error.judgedSoFar).toBe(2);
    expect(run.error.stoppedAt).toBe(m3.sha);
    // Two merges judged, the third refused BEFORE the model call — no silent overspend.
    expect(client.calls).toBe(2);
  });

  it('runs to completion when the cap is not exceeded', async () => {
    const client = fakeModelClient();
    const seat: SeatedBackfillJudge = {
      assertion: JUDGMENT_ASSERTION,
      tier: 'judgment',
      ref: MODEL_JUDGE_REF,
      judge: modelBackedJudge(client, JUDGMENT_ASSERTION.id),
    };
    const run = await replayEpoch({
      commits: [commit({ isMerge: true }), commit({ isMerge: true }), commit({ isMerge: true })],
      judges: [seat],
      budget: { maxJudgedMerges: 3 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error('replay failed');
    expect(run.value.judgedMerges).toBe(3);
    expect(client.calls).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4. The watermark advance is a PROPOSED change, not a write (spec 04 §8, INV-001)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('the watermark advance is proposed, never written (spec 04 §8)', () => {
  const sha = unwrap(parseCommitSha('a1b2c3d4e5f6'));
  const e1 = unwrap(parseEpochId('e1'));

  it('produces a unified diff against .program/manifest.yaml, decodable to the new watermark', () => {
    const proposal = unwrap(
      proposeWatermarkAdvance({ manifestYaml: MANIFEST_FIXTURE, lastWalked: sha, lastEpoch: e1 }),
    );
    expect(proposal.path).toBe(MANIFEST_PATH);
    expect(proposal.path).toBe('.program/manifest.yaml');
    expect(proposal.lastWalked).toBe(sha);
    expect(proposal.lastEpoch).toBe('e1');
    expect(proposal.diff).toContain('--- a/.program/manifest.yaml');
    expect(proposal.diff).toContain('+  last_walked: "a1b2c3d4e5f6"');
    expect(proposal.diff).toContain('-  last_walked: null');

    // The resulting manifest actually parses and carries the advanced watermark.
    const manifest = unwrap(decodeManifest(parseYaml(proposal.after)));
    expect(manifest.watermark.last_walked).toBe('a1b2c3d4e5f6');
    expect(manifest.watermark.last_epoch).toBe('e1');
  });

  it('is surfaced by backfillLedger, keyed to the newest commit walked', async () => {
    const store = new GitRefEventStore({ cwd: repoDir, ref: 'refs/program/ledger-watermark', now: () => new Date(0) });
    const oldest = commit({ isMerge: false, hunks: [BREACH_HUNK] });
    const newest = commit({ isMerge: false, hunks: [BREACH_HUNK] });
    const run = await backfillLedger({
      commits: [oldest, newest],
      judges: [deterministicSeat],
      store,
      manifestYaml: MANIFEST_FIXTURE,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error('backfill failed');
    expect(run.value.watermark).not.toBeNull();
    expect(run.value.watermark!.lastWalked).toBe(newest.sha); // last SHA walked (spec 04 §8)
    expect(run.value.watermark!.diff).toContain(newest.sha);
  });

  it('refuses to advance when the field is missing (fails loudly, never guesses)', () => {
    const noWatermark = 'schema_version: 0.1.0\njudges: []\n';
    const r = proposeWatermarkAdvance({ manifestYaml: noWatermark, lastWalked: sha });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('should have refused');
    expect(r.error.code).toBe('missing-field');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 5. This repository was never written to
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('git-with-the-program itself is untouched (INV-001)', () => {
  it('nothing under .program/ was written by the backfill step', () => {
    expect(hostGit(['status', '--porcelain', '--', '.program']).trim()).toBe(PROGRAM_STATUS_BEFORE);
    expect(hostGit(['status', '--porcelain', '--', '.program']).trim()).toBe('');
    expect(hostGit(['show-ref']).includes('refs/program/ledger-')).toBe(false);
  });
});
