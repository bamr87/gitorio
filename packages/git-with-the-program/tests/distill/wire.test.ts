// Implements tests for: src/distill/wire.ts — the SEED-04 integration layer that reconciles the
// four slices (docs/spec/04-distillation.md §1–§5). Runs the whole read-only walk end to end
// against the SHARED synthetic fixture (tests/fixtures/distill/build-fixture.ts), proving:
//   • the segmentation signals derive from the walk (deriveCommitStats),
//   • distillWalk finds >= 2 epochs, the core/ boundary held, and the revert pair is mined,
//   • epochSynthesisInputs maps the REAL FactBase onto synthesis's author-free views WITH NO author
//     identity crossing the seam (INV-003), while the author-file matrix keeps it dispersion-side,
//   • deterministicCandidates emits `status: inferred` candidates seeded from the violation-free span,
//   • the walk is deterministic (same inputs → same epochs).
// NO network, NO model: the whole pipeline here is deterministic and model-free.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGitExec, type GitExec } from '../../src/ledger/git.js';
import { buildDistillFixture } from '../fixtures/distill/build-fixture.js';
import {
  deriveCommitStats,
  deterministicCandidates,
  distillWalk,
  epochSynthesisInputs,
  walkCommits,
  type DistilledWalk,
} from '../../src/distill/index.js';

const GIT_TIMEOUT = 120_000;
const WHOLE = { from: null, to: 'HEAD' } as const;

let dir: string;
let git: GitExec;
let walk: DistilledWalk;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gwtp-wire-'));
  buildDistillFixture(dir);
  git = createGitExec({ cwd: dir });
  const r = await distillWalk(git, WHOLE);
  if (!r.ok) throw new Error(`distillWalk: ${r.error.detail}`);
  walk = r.value;
}, GIT_TIMEOUT);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('deriveCommitStats — the segmentation signal series (spec 04 §1)', () => {
  it('surfaces the directory rename as a lone spike (the guaranteed structural break)', async () => {
    const commits = await walkCommits(git, WHOLE, { order: 'oldest-first', detectRenames: true, maxCommits: 1000 });
    if (!commits.ok) throw new Error('walk budget');
    const stats = deriveCommitStats(commits.value);
    const spikes = stats.filter((s) => s.directoryEvents > 0);
    // Exactly one commit renamed a directory (oldpkg/ -> newpkg/): a lone spike, so its z-score is
    // sqrt(N-1) and clears the default 3σ threshold on this 14-commit history.
    expect(spikes).toHaveLength(1);
    expect(stats.length).toBeGreaterThanOrEqual(10);
  });
});

describe('distillWalk — the whole read-only walk (spec 04 §1–§2)', () => {
  it('finds >= 2 epochs, the final one flagged', () => {
    expect(walk.segmentation.epochs.length).toBeGreaterThanOrEqual(2);
    expect(walk.segmentation.epochs.filter((e) => e.isFinal)).toHaveLength(1);
    expect(walk.segmentation.finalEpoch).not.toBeNull();
  });

  it('proves the core/ import boundary held violation-free (seeds precision, spec 04 §2/§5)', () => {
    const proof = walk.factBase.synthesizable.negativeSpace.find((n) => n.probe.scope === 'core/**');
    expect(proof).toBeDefined();
    expect(proof?.held).toBe(true);
    expect(proof?.firstBreach).toBeNull();
    expect(proof?.spanFrom).not.toBeNull();
    expect(proof?.spanTo).not.toBeNull();
  });

  it('mines the revert pair (spec 04 §2)', () => {
    const reverts = walk.factBase.synthesizable.litigation.reverts;
    expect(reverts.length).toBeGreaterThanOrEqual(1);
    expect(reverts.some((r) => r.revertedResolved !== null)).toBe(true);
  });

  it('takes a doc snapshot per epoch (README present at each boundary)', () => {
    const byEpoch = new Map<string, boolean>();
    for (const d of walk.factBase.synthesizable.docs.snapshots) {
      if (d.kind === 'readme' && d.present) byEpoch.set(d.epoch, true);
    }
    for (const e of walk.segmentation.epochs) expect(byEpoch.get(e.id)).toBe(true);
  });
});

describe('epochSynthesisInputs — FactBase → author-free views (spec 04 §3, INV-003)', () => {
  it('produces one input per epoch, final flagged, with the held negative-space proof surfaced', () => {
    const inputs = epochSynthesisInputs(walk.factBase, walk.segmentation);
    expect(inputs).toHaveLength(walk.segmentation.epochs.length);
    expect(inputs.filter((i) => i.isFinal)).toHaveLength(1);
    for (const input of inputs) {
      expect(input.aggregates.negativeSpaceProofs.some((p) => p.held && p.scope === 'core/**')).toBe(true);
    }
  });

  it('INV-003: no author identity crosses into the synthesis inputs', () => {
    const inputs = epochSynthesisInputs(walk.factBase, walk.segmentation);
    const serialized = JSON.stringify(inputs);
    // The fixture's author identity is mined ONLY into the dispersion-side author-file matrix.
    expect(serialized).not.toContain('fixture@localhost');
    // …and it IS present on the dispersion side, proving the partition is real, not vacuous.
    const matrix = JSON.stringify(walk.factBase.dispersion.authorFileMatrix);
    expect(matrix).toContain('fixture@localhost');
  });
});

describe('deterministicCandidates — model-free candidates (spec 04 §2/§4/§5)', () => {
  it('turns each held boundary into a status:inferred candidate with a seeded precision', () => {
    const candidates = deterministicCandidates(walk.factBase, walk.segmentation);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of candidates) {
      // Compile-time + runtime proof of spec 04 §4: a candidate can only be `inferred`.
      const pinned: 'inferred' = c.status;
      expect(pinned).toBe('inferred');
      expect(c.id.startsWith('CAND-')).toBe(true);
      expect(c.precision_seed).toBeGreaterThan(0.5);
      expect(c.precision_seed).toBeLessThanOrEqual(0.95);
      expect(c.provenance.length).toBeGreaterThan(0);
    }
  });
});

describe('determinism (spec 04 §2/§8)', () => {
  it('two walks over the same repo produce the same epoch structure', async () => {
    const again = await distillWalk(git, WHOLE);
    if (!again.ok) throw new Error(again.error.detail);
    const a = walk.segmentation.epochs.map((e) => `${e.id}:${e.startIndex}-${e.endIndex}:${e.isFinal}`);
    const b = again.value.segmentation.epochs.map((e) => `${e.id}:${e.startIndex}-${e.endIndex}:${e.isFinal}`);
    expect(b).toEqual(a);
    expect(again.value.factBase.watermark.rangeDigest).toBe(walk.factBase.watermark.rangeDigest);
  }, GIT_TIMEOUT);
});
