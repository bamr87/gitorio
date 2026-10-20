// SEED-04 deliverable 5 — the ratification ritual (docs/spec/04-distillation.md §6).
//
// Asserts the three things the seed's acceptance names for ratification:
//   1. the proposal renders <= 12 candidates, provenance as links, and a per-assertion
//      accept/edit/reject checklist — and NOTHING under `.program/` is written (git status clean);
//   2. tombstone idempotence — reject a candidate, it becomes a `ruling: coincidence` precedent,
//      re-run the ratify step, and that candidate is NOT re-proposed;
//   3. the proposed CAND-* blocks are valid assertions (they decode) and are all `status: inferred`
//      (spec 04 §4 — distillation may only emit inferred).
//
// THE REPOSITORY THIS TEST IS CHECKED INTO IS NEVER WRITTEN. The proposal is written to a throwaway
// directory under $TMPDIR; the real `.program/` is fingerprinted for read-only-ness at the end.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

import {
  type CandidateAssertion,
  decodeInvariantsFile,
  deliveryKeyParts,
  findDeliveryMarker,
  isCandidateAssertion,
  unwrap,
} from '../../src/core/index.js';
import {
  MAX_RATIFICATION_CANDIDATES,
  appendAssertionBlocks,
  buildRatificationProposal,
  candidateRegularityKey,
  rejectCandidate,
  renderCandidateBlock,
  writeRatificationProposal,
} from '../../src/distill/ratify.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_URL = 'https://github.com/bamr87/git-with-the-program';

function hostGit(args: readonly string[]): string {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

const PROGRAM_STATUS_BEFORE = hostGit(['status', '--porcelain', '--', '.program']).trim();

// A minimal but real invariants.yaml the proposal appends to. Deliberately NOT the real one, so the
// test is hermetic — but shaped like it (a non-empty sequence with a header comment).
const INVARIANTS_FIXTURE = [
  '# fixture invariants — a non-empty sequence',
  '- id: INV-001',
  '  statement: Nothing writes to .program/ except human-ratified PRs',
  '  class: boundary',
  '  scope: [".program/**"]',
  '  enforcement: deterministic',
  '  precision: 1.0',
  '  budget: 1.0',
  '  half_life: 365d',
  '  status: ratified',
  '  provenance: [adr-0001]',
  '',
].join('\n');

const PRECEDENTS_FIXTURE = ['# fixture precedents', '[]', ''].join('\n');

/** Builds N distinct candidates with decreasing precision seeds, so ranking is deterministic. */
function makeCandidates(count: number): readonly CandidateAssertion[] {
  const blocks: string[] = ['# candidates'];
  for (let n = 1; n <= count; n += 1) {
    const seed = Number((0.99 - n * 0.01).toFixed(2)); // 0.98 down to 0.99 - count/100
    blocks.push(
      [
        `- id: CAND-${String(n).padStart(3, '0')}`,
        `  statement: inferred regularity ${n} governing the engine core import boundary`,
        `  class: dependency`,
        `  scope: ["src/core/**"]`,
        `  enforcement: judgment`,
        `  precision: ${seed}`,
        `  budget: 3.0`,
        `  half_life: 90d`,
        `  status: inferred`,
        `  provenance: ["import-graph e3..e6", "pr#${n}", "commit 9f2c1d${n}"]`,
        `  precision_seed: ${seed}`,
        `  evidence:`,
        `    span: "2022-0${(n % 9) + 1} → present"`,
        `    corroborations: ["import-graph e3..e6", "pr#${n}"]`,
      ].join('\n'),
    );
  }
  const all = unwrap(decodeInvariantsFile(parseYaml(blocks.join('\n\n'))));
  return all.filter(isCandidateAssertion);
}

const tmpDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gwtp-ratify-'));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 1. The proposal: <= 12 candidates, provenance links, accept/edit/reject checklist
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('the ratification proposal (spec 04 §6)', () => {
  const candidates = makeCandidates(15);
  const proposal = unwrap(
    buildRatificationProposal({ candidates, invariantsYaml: INVARIANTS_FIXTURE, repoUrl: REPO_URL }),
  );

  it('constitutional minimalism: ranks by evidence and ships only the top ~12', () => {
    expect(MAX_RATIFICATION_CANDIDATES).toBe(12);
    expect(proposal.proposed).toHaveLength(12);
    expect(proposal.deferred).toHaveLength(3);
    // Highest precision seed first (CAND-001), the three lowest deferred to the long tail.
    expect(proposal.proposed.map((r) => r.candidate.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `CAND-${String(i + 1).padStart(3, '0')}`),
    );
    expect(proposal.deferred.map((r) => r.candidate.id)).toEqual(['CAND-013', 'CAND-014', 'CAND-015']);
    // Ranked strictly descending by evidence score.
    for (let i = 1; i < proposal.proposed.length; i += 1) {
      expect(proposal.proposed[i - 1]!.score).toBeGreaterThan(proposal.proposed[i]!.score);
    }
  });

  it('renders a per-assertion accept / edit / reject checklist', () => {
    for (const r of proposal.proposed) {
      expect(proposal.body).toContain(`**accept** \`${r.candidate.id}\``);
      expect(proposal.body).toContain(`**edit** \`${r.candidate.id}\``);
      expect(proposal.body).toContain(`**reject** \`${r.candidate.id}\``);
    }
    // Markdown checkbox syntax, three per proposed candidate.
    const boxes = proposal.body.split('- [ ]').length - 1;
    expect(boxes).toBe(proposal.proposed.length * 3);
  });

  it('renders provenance and corroborations as links when a repo URL is given', () => {
    expect(proposal.body).toContain(`[pr#1](${REPO_URL}/pull/1)`);
    expect(proposal.body).toContain(`](${REPO_URL}/commit/9f2c1d1)`);
    expect(proposal.body).toContain('import-graph e3..e6');
  });

  it('proposes the candidates as a .program/invariants.yaml PATCH — never a write', () => {
    expect(proposal.patches).toHaveLength(1);
    expect(proposal.patches[0]!.path).toBe('.program/invariants.yaml');
    expect(proposal.patches[0]!.diff).toContain('+- id: CAND-001');
    expect(proposal.patches[0]!.diff).toContain('+  status: inferred');
  });

  it('carries its own delivery marker keyed to the ratification', () => {
    const marker = findDeliveryMarker(proposal.body);
    expect(marker).toBe(proposal.key);
    expect(deliveryKeyParts(proposal.key)?.assertion).toBe('distill-ratification');
  });

  it('the proposed blocks are valid assertions and every one is `status: inferred` (spec 04 §4)', () => {
    const decoded = unwrap(decodeInvariantsFile(parseYaml(proposal.result)));
    const cands = decoded.filter(isCandidateAssertion);
    expect(cands).toHaveLength(12);
    for (const c of cands) expect(c.status).toBe('inferred');
  });

  it('applies as a real diff: git apply --check accepts the invariants patch', () => {
    const dir = scratch();
    execFileSync('git', ['-C', dir, 'init', '-q']);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@fixture.invalid']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'test']);
    mkdirSync(join(dir, '.program'), { recursive: true });
    writeFileSync(join(dir, '.program', 'invariants.yaml'), INVARIANTS_FIXTURE, 'utf8');
    execFileSync('git', ['-C', dir, 'add', '-A']);
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'base']);
    const patchFile = join(dir, 'ratify.patch');
    writeFileSync(patchFile, proposal.patches[0]!.diff, 'utf8');
    expect(() => execFileSync('git', ['-C', dir, 'apply', '--check', patchFile])).not.toThrow();
  });

  it('writes the proposal under a proposals/ directory — never .program/ — idempotently', async () => {
    const dir = scratch();
    const first = await writeRatificationProposal(proposal, { directory: join(dir, 'proposals'), log: () => {} });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('write failed');
    expect(first.value.status).toBe('created');
    expect(readFileSync(first.value.path, 'utf8')).toContain(proposal.key);

    // Asked twice, written once (idempotent via the delivery marker).
    const second = await writeRatificationProposal(proposal, { directory: join(dir, 'proposals'), log: () => {} });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('second write failed');
    expect(second.value.status).toBe('existing');
  });

  it('refuses to write into .program/ (INV-001)', async () => {
    const dir = scratch();
    const r = await writeRatificationProposal(proposal, { directory: join(dir, '.program', 'proposals'), log: () => {} });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('should have refused');
    expect(r.error.code).toBe('invalid-path');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2. Tombstone idempotence (spec 04 §6): reject → coincidence → re-run → not re-proposed
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('tombstones are binding (spec 04 §6)', () => {
  const [c1, c2] = makeCandidates(2);
  if (c1 === undefined || c2 === undefined) throw new Error('fixture');

  it('proposes both candidates before any rejection', () => {
    const before = unwrap(buildRatificationProposal({ candidates: [c1, c2], invariantsYaml: INVARIANTS_FIXTURE }));
    expect(before.proposed.map((r) => r.candidate.id).sort()).toEqual(['CAND-001', 'CAND-002']);
    expect(before.suppressed).toHaveLength(0);
  });

  it('rejecting a candidate produces a `ruling: coincidence` tombstone, as a PROPOSED diff', () => {
    const rejected = unwrap(rejectCandidate({ candidate: c2, precedentsYaml: PRECEDENTS_FIXTURE }));
    expect(rejected.precedent.ruling).toBe('coincidence');
    expect(rejected.precedent.id).toBe('PRE-001');
    expect(rejected.patch.path).toBe('.program/precedents.yaml');
    expect(rejected.patch.diff).toContain('+  ruling: coincidence');
    // The tombstone carries the regularity marker so a re-run can match it.
    expect(rejected.precedent.evidence.join('\n')).toContain('gwtp-regularity:');
    expect(rejected.regularity).toBe(candidateRegularityKey(c2));
  });

  it('re-running with the tombstone in the corpus does NOT re-propose the rejected candidate', () => {
    const rejected = unwrap(rejectCandidate({ candidate: c2, precedentsYaml: PRECEDENTS_FIXTURE }));

    const after = unwrap(
      buildRatificationProposal({
        candidates: [c1, c2],
        invariantsYaml: INVARIANTS_FIXTURE,
        precedents: [rejected.precedent],
      }),
    );
    expect(after.proposed.map((r) => r.candidate.id)).toEqual(['CAND-001']);
    expect(after.suppressed.map((s) => s.candidate.id)).toEqual(['CAND-002']);
    expect(after.suppressed[0]!.tombstone.kind).toBe('precedent');
    // The rejected candidate's block never reaches the proposed invariants diff.
    expect(after.patches[0]?.diff ?? '').not.toContain('CAND-002');
  });

  it('also suppresses via a prior run’s rejection ledger (by RegularityKey)', () => {
    const after = unwrap(
      buildRatificationProposal({
        candidates: [c1, c2],
        invariantsYaml: INVARIANTS_FIXTURE,
        priorRejections: [candidateRegularityKey(c2)],
      }),
    );
    expect(after.proposed.map((r) => r.candidate.id)).toEqual(['CAND-001']);
    expect(after.suppressed[0]!.tombstone.kind).toBe('prior-run');
  });

  it('a NON-coincidence precedent (killed/affirmed) is not a tombstone and suppresses nothing', () => {
    const rejected = unwrap(rejectCandidate({ candidate: c2, precedentsYaml: PRECEDENTS_FIXTURE }));
    const notATombstone = { ...rejected.precedent, ruling: 'affirmed' as const };
    const after = unwrap(
      buildRatificationProposal({ candidates: [c1, c2], invariantsYaml: INVARIANTS_FIXTURE, precedents: [notATombstone] }),
    );
    expect(after.proposed.map((r) => r.candidate.id).sort()).toEqual(['CAND-001', 'CAND-002']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 3. YAML rendering helpers
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('candidate block rendering', () => {
  it('renders a decodable CAND-* block pinned to status: inferred', () => {
    const [c1] = makeCandidates(1);
    if (c1 === undefined) throw new Error('fixture');
    const block = renderCandidateBlock(c1);
    expect(block).toContain('  status: inferred');
    const decoded = unwrap(decodeInvariantsFile(parseYaml(block)));
    expect(decoded).toHaveLength(1);
    expect(isCandidateAssertion(decoded[0]!)).toBe(true);
  });

  it('appendAssertionBlocks replaces `[]` and appends to a non-empty sequence', () => {
    expect(unwrap(appendAssertionBlocks('[]\n', ['- id: CAND-001']))).not.toContain('[]');
    expect(unwrap(appendAssertionBlocks(INVARIANTS_FIXTURE, ['- id: CAND-001']))).toContain('- id: CAND-001');
    // No blocks is a no-op.
    expect(unwrap(appendAssertionBlocks(INVARIANTS_FIXTURE, []))).toBe(INVARIANTS_FIXTURE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 4. This repository was never written to
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('git-with-the-program itself is untouched (INV-001)', () => {
  it('nothing under .program/ was written by the ratify step', () => {
    expect(hostGit(['status', '--porcelain', '--', '.program']).trim()).toBe(PROGRAM_STATUS_BEFORE);
    expect(hostGit(['status', '--porcelain', '--', '.program']).trim()).toBe('');
  });
});
