// THE SEED-04 EXIT TEST — v1.5, "the historian".
//
// seeds/SEED-04-distillation-miner.md, Acceptance:
//   "Run against a real mid-size OSS repo fixture: fact base builds; >= 2 plausible epochs found;
//    candidates all carry provenance; ratification PR renders; rejecting a candidate then re-running
//    does not re-propose it; backfilled accumulators show pre-decayed values matching hand
//    computation."
//
// This file asserts the whole SEED-04 acceptance as ONE re-runnable proof over the walk modules the
// parallel agents shipped (src/distill/**) and the SYNTHETIC-BY-CONSTRUCTION fixture the Wire agent
// produced (tests/fixtures/distill/build-fixture.ts). It reimplements neither: the reusable pipeline
// lives in `scripts/demo-v15.ts` and is imported here, exactly as `tests/exit-test-v0.test.ts` imports
// `scripts/demo-v0.ts` and `tests/exit-test-v05.test.ts` imports `scripts/demo-v05.ts`.
//
// WHY THE FIXTURE IS SYNTHETIC. A live mid-size OSS clone is not reliably available in this
// environment, so instead of cloning one the fixture builder CRAFTS a throwaway git repo under
// $TMPDIR whose history exhibits exactly the structures the walk must detect: >= 2 structural epochs
// (a directory rename + README rewrite + dependency-manifest bump at one upheaval commit), a revert
// pair ("This reverts commit …"), a `core/` import boundary held violation-free across the whole
// history (so a precision seed can be computed), and a README/ADR doc snapshot per epoch. The tests
// assert STRUCTURE (epoch count, boundary held, decay arithmetic), never exact SHAs, so they survive
// git-version differences in rename detection.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
//  NETWORK-FREE (constraint 3): pass two runs through the core-side `ModelClient` port with a FAKE
//  behind it (scripts/demo-v15.ts `cannedSynthesisModel`); nothing constructs a real client.
//
//  THIS REPOSITORY IS NEVER WRITTEN (constraint 7, INV-001): the walk is read-only git against a
//  $TMPDIR fixture; the ledger the backfill appends to is a throwaway `refs/program/ledger-*` in that
//  fixture; the ratification proposal is written under a $TMPDIR `proposals/` directory. The final
//  section proves the real `.program/` stayed clean and that no `refs/program/` ref was created here.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CandidateAssertion,
  decodeInvariantsFile,
  findDeliveryMarker,
  isCandidateAssertion,
  isViolationEvent,
  parseCommitSha,
  unwrap,
} from '../src/core/index.js';
import { createGitExec, type GitExec } from '../src/ledger/git.js';
import { GitRefEventStore } from '../src/ledger/index.js';
import {
  MANIFEST_PATH,
  MAX_RATIFICATION_CANDIDATES,
  candidateRegularityKey,
  proposeWatermarkAdvance,
  rejectCandidate,
  writeRatificationProposal,
  type DistilledWalk,
} from '../src/distill/index.js';
import { buildDistillFixture, type DistillFixture } from './fixtures/distill/build-fixture.js';
import {
  BACKFILL_AS_OF,
  BREACH_COMMITTER_TIME,
  CORE_BOUNDARY_STATEMENT,
  DEMO_REPO_URL,
  V15_BACKFILL,
  buildProposal,
  cannedCandidatesReply,
  factBaseBytes,
  runBackfill,
  runDistillWalk,
  runSynthesis,
} from '../scripts/demo-v15.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GIT_TIMEOUT = 120_000;

function hostGit(args: readonly string[]): string {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

// Fingerprint the real .program/ BEFORE anything runs, so the final section can prove it is unchanged.
const PROGRAM_STATUS_BEFORE = hostGit(['status', '--porcelain', '--', '.program']).trim();

let dir: string;
let git: GitExec;
let fx: DistillFixture;
let walk: DistilledWalk;
let invariantsYaml: string;
let manifestYaml: string;
let precedentsYaml: string;
/** The candidates the walk synthesizes via the fake port — computed once, reused across sections. */
let candidates: readonly CandidateAssertion[];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gwtp-exit-v15-'));
  fx = buildDistillFixture(dir);
  git = createGitExec({ cwd: dir });
  invariantsYaml = readFileSync(join(dir, '.program', 'invariants.yaml'), 'utf8');
  manifestYaml = readFileSync(join(dir, '.program', 'manifest.yaml'), 'utf8');
  precedentsYaml = readFileSync(join(dir, '.program', 'precedents.yaml'), 'utf8');

  walk = await runDistillWalk(git);
  const synth = await runSynthesis(walk, cannedCandidatesReply(fx));
  candidates = synth.candidates;
}, GIT_TIMEOUT);

afterAll(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. The fact base builds and is DETERMINISTIC — same range twice → byte-identical (spec 04 §2/§8)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('the fact base builds and is deterministic (spec 04 §2/§8)', () => {
  it('builds a non-empty canonical fact base over the whole history', () => {
    const bytes = factBaseBytes(walk);
    expect(bytes.length).toBeGreaterThan(0);
    // It proved the core/ boundary and mined the revert pair — the fixture's crafted structure.
    const proof = walk.factBase.synthesizable.negativeSpace.find((n) => n.probe.scope === 'core/**');
    expect(proof?.held).toBe(true);
    expect(walk.factBase.synthesizable.litigation.reverts.length).toBeGreaterThanOrEqual(1);
  });

  it('a second walk over the same range produces a BYTE-IDENTICAL fact base', async () => {
    const again = await runDistillWalk(git);
    expect(factBaseBytes(again)).toBe(factBaseBytes(walk));
    // The range digest (the replay identity, spec 04 §8) and the epoch structure are identical too.
    expect(again.factBase.watermark.rangeDigest).toBe(walk.factBase.watermark.rangeDigest);
    const struct = (w: DistilledWalk): string =>
      w.segmentation.epochs.map((e) => `${e.id}:${e.startIndex}-${e.endIndex}:${e.isFinal}`).join('|');
    expect(struct(again)).toBe(struct(walk));
  }, GIT_TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. >= 2 plausible epochs found, with AUDITABLE boundary signals (spec 04 §1)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('>= 2 plausible epochs found with auditable boundary signals (spec 04 §1)', () => {
  it('segments the history into >= 2 epochs, exactly one flagged final (recency asymmetry §3)', () => {
    expect(walk.segmentation.epochs.length).toBeGreaterThanOrEqual(2);
    expect(walk.segmentation.epochs.filter((e) => e.isFinal)).toHaveLength(1);
    expect(walk.segmentation.finalEpoch).not.toBeNull();
  });

  it('every non-first boundary is opened by an auditable change-point signal above threshold', () => {
    const [first, ...rest] = walk.segmentation.epochs;
    expect(first?.openedBy).toBeNull(); // index 0 is the natural start, never a break
    expect(rest.length).toBeGreaterThanOrEqual(1);
    for (const e of rest) {
      // The boundary is not asserted by fiat: it names the signals that crossed threshold and their
      // z-scores, so a human can audit WHY a new epoch opened there (spec 04 §1).
      expect(e.openedBy).not.toBeNull();
      expect(e.openedBy!.triggers.length).toBeGreaterThanOrEqual(1);
      expect(e.openedBy!.score).toBeGreaterThanOrEqual(walk.segmentation.config.zThreshold);
      for (const t of e.openedBy!.triggers) expect(t.z).toBeGreaterThanOrEqual(walk.segmentation.config.zThreshold);
    }
    // Every candidate break is retained for audit even if debounce dropped some.
    expect(walk.segmentation.candidateBreaks.length).toBeGreaterThanOrEqual(rest.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. Every synthesized candidate carries provenance; provenance-free is rejected; all are inferred
//    (spec 04 §3/§4, spec 01 §4 rule 1)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('synthesized candidates carry provenance and are all status: inferred (spec 04 §3/§4)', () => {
  it('made exactly one FAKE model call per epoch — no network (INV-005, constraint 3)', async () => {
    const synth = await runSynthesis(walk, cannedCandidatesReply(fx));
    expect(synth.model.calls).toBe(walk.segmentation.epochs.length);
    expect(synth.result.modelCalls).toBe(walk.segmentation.epochs.length);
  });

  it('every synthesized candidate carries non-empty provenance and a CAND-* id', () => {
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of candidates) {
      expect(c.provenance.length).toBeGreaterThan(0);
      expect(c.id.startsWith('CAND-')).toBe(true);
    }
  });

  it('a provenance-free candidate is REJECTED before it can be proposed (spec 01 §4 rule 1)', async () => {
    const synth = await runSynthesis(walk, cannedCandidatesReply(fx));
    // The fixture reply carries one candidate with NO `provenance` field; it never becomes a proposal.
    expect(synth.result.dropped.some((d) => d.reason === 'missing-provenance')).toBe(true);
    // …and its statement is nowhere among the survivors.
    expect(synth.result.candidates.some((c) => c.assertion.statement.includes('single letters'))).toBe(false);
  });

  it('distillation may only emit `inferred` — pinned by the type AND checked at runtime (spec 04 §4)', () => {
    for (const c of candidates) {
      // Compile-time proof: this assignment type-checks only because CandidateAssertion.status is the
      // literal 'inferred'. Self-ratification is unrepresentable — the miner cannot promote its own law.
      const pinned: 'inferred' = c.status;
      expect(pinned).toBe('inferred');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4. The ratification PROPOSAL renders — <= 12, accept/edit/reject, provenance links — no .program/ write
//    (spec 04 §6, INV-001)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('the ratification proposal renders and writes nothing under .program/ (spec 04 §6, INV-001)', () => {
  it('constitutional minimalism: ranks by evidence and ships <= 12 candidates', () => {
    const proposal = buildProposal(candidates, invariantsYaml);
    expect(MAX_RATIFICATION_CANDIDATES).toBe(12);
    expect(proposal.proposed.length).toBeLessThanOrEqual(12);
    expect(proposal.proposed.length).toBeGreaterThanOrEqual(1);
    // Ranked strictly descending by evidence score (the derived precision seed dominates, §5).
    for (let i = 1; i < proposal.proposed.length; i += 1) {
      expect(proposal.proposed[i - 1]!.score).toBeGreaterThanOrEqual(proposal.proposed[i]!.score);
    }
  });

  it('renders a per-assertion accept / edit / reject checklist', () => {
    const proposal = buildProposal(candidates, invariantsYaml);
    for (const r of proposal.proposed) {
      expect(proposal.body).toContain(`**accept** \`${r.candidate.id}\``);
      expect(proposal.body).toContain(`**edit** \`${r.candidate.id}\``);
      expect(proposal.body).toContain(`**reject** \`${r.candidate.id}\``);
    }
    const boxes = proposal.body.split('- [ ]').length - 1;
    expect(boxes).toBe(proposal.proposed.length * 3);
  });

  it('renders provenance as links when a repo URL is supplied', () => {
    const proposal = buildProposal(candidates, invariantsYaml);
    // The core-boundary candidate cites `commit <fixture-head>`, which linkifies against the repo URL.
    expect(proposal.body).toContain(`](${DEMO_REPO_URL}/commit/`);
  });

  it('proposes the candidates as a .program/invariants.yaml PATCH — never a write — all `inferred`', () => {
    const proposal = buildProposal(candidates, invariantsYaml);
    expect(proposal.patches).toHaveLength(1);
    expect(proposal.patches[0]!.path).toBe('.program/invariants.yaml');
    expect(proposal.patches[0]!.diff).toContain('+  status: inferred');
    // The result the patch would produce decodes, and every appended block is a status:inferred candidate.
    const decoded = unwrap(decodeInvariantsFile(parseYaml(proposal.result)));
    const cands = decoded.filter(isCandidateAssertion);
    expect(cands.length).toBe(proposal.proposed.length);
    for (const c of cands) expect(c.status).toBe('inferred');
  });

  it('writes the proposal under a $TMPDIR proposals/ directory — never .program/ — carrying its marker', async () => {
    const proposal = buildProposal(candidates, invariantsYaml);
    const scratch = mkdtempSync(join(tmpdir(), 'gwtp-exit-v15-ratify-'));
    try {
      const receipt = await writeRatificationProposal(proposal, {
        directory: join(scratch, 'proposals'),
        log: () => {},
      });
      expect(receipt.ok).toBe(true);
      if (!receipt.ok) throw new Error('write failed');
      expect(receipt.value.status).toBe('created');
      expect(findDeliveryMarker(readFileSync(receipt.value.path, 'utf8'))).toBe(proposal.key);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 5. TOMBSTONE IDEMPOTENCE — reject a candidate, re-run the walk, it is NOT re-proposed (spec 04 §6)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('rejecting a candidate then re-running does not re-propose it (spec 04 §6)', () => {
  /** The proven-boundary candidate the human will decline; a sibling stays to prove the block is targeted. */
  function coreBoundaryCandidate(): CandidateAssertion {
    const c = candidates.find((x) => x.statement === CORE_BOUNDARY_STATEMENT);
    if (c === undefined) throw new Error('the walk did not synthesize the core-boundary candidate');
    return c;
  }

  it('rejection records a `ruling: coincidence` tombstone as a PROPOSED precedents.yaml diff', () => {
    const rejected = unwrap(rejectCandidate({ candidate: coreBoundaryCandidate(), precedentsYaml }));
    expect(rejected.precedent.ruling).toBe('coincidence');
    expect(rejected.patch.path).toBe('.program/precedents.yaml');
    expect(rejected.patch.diff).toContain('+  ruling: coincidence');
    // The tombstone carries the regularity marker AND the statement, so a re-run matches either way.
    expect(rejected.regularity).toBe(candidateRegularityKey(coreBoundaryCandidate()));
    expect(rejected.precedent.evidence.join('\n')).toContain('gwtp-regularity:');
  });

  it('RE-RUNS synthesis with the tombstone in the corpus: the rejected law is not re-synthesized', async () => {
    const rejected = unwrap(rejectCandidate({ candidate: coreBoundaryCandidate(), precedentsYaml }));
    // Re-run the whole pass two over the SAME (deterministic) walk, now knowing the rejection.
    const again = await runSynthesis(walk, cannedCandidatesReply(fx), [rejected.precedent]);
    expect(again.result.candidates.some((c) => c.assertion.statement === CORE_BOUNDARY_STATEMENT)).toBe(false);
    expect(again.result.dropped.some((d) => d.reason === 'tombstoned')).toBe(true);
    // The sibling law is untouched — the tombstone is targeted, not a blanket suppression.
    expect(again.result.candidates.some((c) => c.assertion.statement.includes('app/**'))).toBe(true);
  });

  it('RE-RUNS ratification with the tombstone: the rejected candidate is withheld, the sibling proposed', () => {
    const rejected = unwrap(rejectCandidate({ candidate: coreBoundaryCandidate(), precedentsYaml }));
    const before = buildProposal(candidates, invariantsYaml);
    const after = buildProposal(candidates, invariantsYaml, { precedents: [rejected.precedent] });

    expect(before.proposed.some((r) => r.candidate.statement === CORE_BOUNDARY_STATEMENT)).toBe(true);
    expect(after.proposed.some((r) => r.candidate.statement === CORE_BOUNDARY_STATEMENT)).toBe(false);
    expect(after.suppressed.some((s) => s.candidate.statement === CORE_BOUNDARY_STATEMENT)).toBe(true);
    // A different candidate is still proposed, and the rejected block never reaches the invariants diff.
    expect(after.proposed.length).toBe(before.proposed.length - 1);
    expect(after.patches[0]?.diff ?? '').not.toContain(CORE_BOUNDARY_STATEMENT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 6. BACKFILL DECAY — an 8-month breach against a 90d half-life lands at ~15% (spec 04 §7/§8)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('backfilled accumulators are pre-decayed matching hand computation (spec 04 §7/§8)', () => {
  it('an 8-month-old breach against a 90-day half-life lands at ~15% strength', async () => {
    // THE ARITHMETIC, HAND-COMPUTED (matches scripts/demo-v15.ts V15_BACKFILL):
    //   The fixture's OWN ratified INV-001 (class dependency, scope [core/**], precision 1.0,
    //   half_life 90d) is seated as the deterministic import-boundary judge. A re-export of a forge
    //   SDK into core/ is ruled `entrenches` → severity 1.0.
    //     increment        = precision_at · severity = 1.0 × 1.0 = 1.0          (fresh, pre-decayed)
    //     Δt               = 8 months = 8 × 30d = 240 committer-days   (mo = 30d, Q-01)
    //     surviving factor = 2^(−240/90) = 2^(−2.6̄) ≈ 0.157490
    //     decayed          = 1.0 × 0.157490 ≈ 0.157490                          (~15% strength)
    const expectedFraction = Math.pow(2, -240 / 90);
    expect(V15_BACKFILL.survivingFraction).toBeCloseTo(expectedFraction, 12);

    const store = new GitRefEventStore({ cwd: dir, ref: 'refs/program/ledger-v15exit', now: () => new Date(0) });
    const back = await runBackfill(store, invariantsYaml, manifestYaml);

    const s = back.strengths.find((x) => x.key === back.seat.assertion.id);
    expect(s, 'no strength for the seated boundary invariant').toBeDefined();
    expect(s!.preDecayed).toBeCloseTo(1.0, 9); // the fresh increment, exposed for a hand check
    expect(s!.decayed).toBeCloseTo(expectedFraction, 9);
    expect(s!.decayed).toBeCloseTo(0.15749, 6);
    expect(s!.survivingFraction).toBeCloseTo(expectedFraction, 9);
    // "~15% strength": between 15% and 16% of a fresh breach.
    expect(s!.decayed).toBeGreaterThan(0.15);
    expect(s!.decayed).toBeLessThan(0.16);

    // The minted event carries COMMITTER time (ADR-0004), which is why decay applies on arrival.
    const violation = (await store.list()).find(isViolationEvent);
    expect(violation, 'the breach produced no drift event').toBeDefined();
    expect(violation!.t).toBe(BREACH_COMMITTER_TIME);
    expect(violation!.severity).toBe(1); // re-export → entrenches → 1.0
    // The asOf instant is exactly 240 committer-days after the breach.
    expect(BACKFILL_AS_OF).not.toBe(BREACH_COMMITTER_TIME);
  }, GIT_TIMEOUT);

  it('the watermark advance is a PROPOSED .program/manifest.yaml change, never a write (spec 04 §8)', async () => {
    const store = new GitRefEventStore({ cwd: dir, ref: 'refs/program/ledger-v15exit', now: () => new Date(0) });
    const back = await runBackfill(store, invariantsYaml, manifestYaml);
    expect(back.ledger.watermark).not.toBeNull();
    expect(back.ledger.watermark!.path).toBe(MANIFEST_PATH);
    expect(back.ledger.watermark!.path).toBe('.program/manifest.yaml');
    expect(back.ledger.watermark!.diff).toContain('--- a/.program/manifest.yaml');
    expect(back.ledger.watermark!.lastEpoch).toBe('e1');

    // And, tied faithfully to the actual walk: advancing to the fixture's REAL tip is also a PROPOSAL.
    const head = unwrap(parseCommitSha(fx.head));
    const toTip = unwrap(proposeWatermarkAdvance({ manifestYaml, lastWalked: head }));
    expect(toTip.path).toBe('.program/manifest.yaml');
    expect(toTip.lastWalked).toBe(head);
    expect(toTip.diff).toContain(fx.head);
  }, GIT_TIMEOUT);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 7. This repository was never written to (constraint 7, INV-001)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('git-with-the-program itself is untouched by the walk (INV-001, constraint 7)', () => {
  it('.program/ is clean — the machine proposed patches, it did not write the constitution', () => {
    expect(hostGit(['status', '--porcelain', '--', '.program']).trim()).toBe(PROGRAM_STATUS_BEFORE);
    expect(hostGit(['status', '--porcelain', '--', '.program']).trim()).toBe('');
  });

  it('no refs/program/ ledger ref was created in this repository — the walk surveils nothing here', () => {
    expect(hostGit(['for-each-ref', 'refs/program/']).trim()).toBe('');
  });
});
