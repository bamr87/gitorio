// Implements tests for: src/cli/commands/distill.ts — `gwtp distill facts|epochs|candidates|
// ratify|backfill` (docs/spec/04-distillation.md), SEED-04. Every test runs against the SHARED
// synthetic fixture (tests/fixtures/distill/build-fixture.ts — the ONE fixture definition the exit
// test and the unit tests both use), built under $TMPDIR. NO network: distillation is offline by
// default, so no subcommand constructs a ModelClient. Git writes (the ledger ref) happen only in
// the throwaway fixture repos, never in the checked-in project (SEED-04 constraint 7).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli/commands/distill.js';
import { buildDistillFixture } from '../fixtures/distill/build-fixture.js';
import { createGitExec } from '../../src/ledger/git.js';
import {
  deterministicCandidates,
  distillWalk,
  rejectCandidate,
} from '../../src/distill/index.js';

const GIT_TIMEOUT = 120_000;

const dirs: string[] = [];
function freshFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gwtp-cli-distill-'));
  dirs.push(dir);
  buildDistillFixture(dir);
  return dir;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

let stdout = '';
let stderr = '';
beforeEach(() => {
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Reads captured stdout as JSON (the `--json` output shape). */
function json<T = unknown>(): T {
  return JSON.parse(stdout) as T;
}

/** git in a throwaway, for assertions about refs / working tree. */
function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();
}

// A shared, read-mostly fixture for the non-mutating subcommands.
let shared: string;
beforeAll(() => {
  shared = freshFixture();
}, GIT_TIMEOUT);

describe('gwtp distill — usage surface', () => {
  it('prints usage and exits 0 on --help', async () => {
    expect(await run(['--help'])).toBe(0);
    expect(stdout).toContain('gwtp distill');
    for (const sub of ['facts', 'epochs', 'candidates', 'ratify', 'backfill']) {
      expect(stdout).toContain(sub);
    }
  });

  it('exits 2 on an unknown subcommand', async () => {
    expect(await run(['bogus'])).toBe(2);
    expect(stderr).toContain('unknown subcommand');
  });

  it('exits 2 when --repo is not a directory', async () => {
    expect(await run(['facts', '--repo', join(shared, 'nope')])).toBe(2);
  });

  it('each subcommand has its own --help (exit 0)', async () => {
    for (const sub of ['facts', 'epochs', 'candidates', 'ratify', 'backfill']) {
      stdout = '';
      expect(await run([sub, '--help'])).toBe(0);
      expect(stdout).toContain(`gwtp distill ${sub}`);
    }
  });
});

describe('gwtp distill facts (spec 04 §2)', () => {
  it('builds and writes the fact base under .gwtp (never .program/)', async () => {
    expect(await run(['facts', '--repo', shared, '--json'])).toBe(0);
    const summary = json<{ path: string; epochs: number; reverts: number; negativeSpaceProofs: { held: boolean }[] }>();
    expect(summary.epochs).toBeGreaterThanOrEqual(2);
    expect(summary.reverts).toBeGreaterThanOrEqual(1);
    expect(summary.negativeSpaceProofs.some((p) => p.held)).toBe(true);
    expect(summary.path).toContain('.gwtp');
    expect(summary.path).not.toContain('.program');
    expect(existsSync(summary.path)).toBe(true);
  });
});

describe('gwtp distill epochs (spec 04 §1)', () => {
  it('finds >= 2 epochs with a structural break', async () => {
    expect(await run(['epochs', '--repo', shared, '--json'])).toBe(0);
    const res = json<{ epochs: { isFinal: boolean; openedBy: unknown }[] }>();
    expect(res.epochs.length).toBeGreaterThanOrEqual(2);
    expect(res.epochs.filter((e) => e.isFinal)).toHaveLength(1);
    // At least one epoch was opened by a detected break.
    expect(res.epochs.some((e) => e.openedBy !== null)).toBe(true);
  });
});

describe('gwtp distill candidates (offline by default, spec 04 §2/§4)', () => {
  it('reports it ran offline and emits only model-free (inferred) candidates', async () => {
    expect(await run(['candidates', '--repo', shared, '--json'])).toBe(0);
    const res = json<{ mode: string; note: string; candidates: { status: string; class: string }[] }>();
    expect(res.mode).toBe('offline-deterministic');
    expect(res.note.toLowerCase()).toContain('no modelclient');
    expect(res.candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of res.candidates) expect(c.status).toBe('inferred');
  });
});

describe('gwtp distill ratify (spec 04 §6) — proposes, never writes .program/', () => {
  it('proposes the candidates as a .program/invariants.yaml PATCH, not a write', async () => {
    const before = readFileSync(join(shared, '.program', 'invariants.yaml'), 'utf8');
    expect(await run(['ratify', '--repo', shared, '--json'])).toBe(0);
    const res = json<{ proposed: { id: string }[]; patches: string[]; writtenPath: string | null }>();
    expect(res.proposed.length).toBeGreaterThanOrEqual(1);
    expect(res.patches).toContain('.program/invariants.yaml');
    expect(res.writtenPath).toBeNull();
    // The actual .program/invariants.yaml is UNCHANGED — the machine proposed, it did not write.
    expect(readFileSync(join(shared, '.program', 'invariants.yaml'), 'utf8')).toBe(before);
  });

  it('with --out writes a proposal file outside .program/', async () => {
    const dir = freshFixture();
    expect(await run(['ratify', '--repo', dir, '--out', 'proposals'])).toBe(0);
    expect(existsSync(join(dir, 'proposals'))).toBe(true);
    expect(existsSync(join(dir, '.program', 'proposals'))).toBe(false);
    // .program/ files are all still tracked-clean (nothing under .program changed).
    expect(git(dir, ['status', '--porcelain']).split('\n').some((l) => l.includes('.program/'))).toBe(false);
  });
});

describe('tombstones are binding (spec 04 §6) — reject, re-run, not re-proposed', () => {
  it('a coincidence tombstone suppresses the candidate on the next ratify run', async () => {
    const dir = freshFixture();

    // 1. First run proposes the model-free candidate.
    expect(await run(['ratify', '--repo', dir, '--json'])).toBe(0);
    const first = json<{ proposed: { id: string }[] }>();
    expect(first.proposed.length).toBeGreaterThanOrEqual(1);

    // 2. Reject it: record a `ruling: coincidence` tombstone into .program/precedents.yaml (the
    //    sanctioned rejection artifact — a proposed patch a human applies; here the test applies it).
    const gitExec = createGitExec({ cwd: dir });
    const walk = await distillWalk(gitExec, { from: null, to: 'HEAD' });
    if (!walk.ok) throw new Error(`distillWalk: ${walk.error.detail}`);
    const candidate = deterministicCandidates(walk.value.factBase, walk.value.segmentation)[0];
    if (candidate === undefined) throw new Error('expected a model-free candidate');
    const precedentsYaml = readFileSync(join(dir, '.program', 'precedents.yaml'), 'utf8');
    const rejected = rejectCandidate({ candidate, precedentsYaml });
    if (!rejected.ok) throw new Error(`rejectCandidate: ${rejected.error.message}`);
    writeFileSync(join(dir, '.program', 'precedents.yaml'), rejected.value.result, 'utf8');

    // 3. Re-run: the candidate is now SUPPRESSED, not re-proposed.
    stdout = '';
    expect(await run(['ratify', '--repo', dir, '--json'])).toBe(0);
    const second = json<{ proposed: { id: string }[]; suppressed: { id: string }[] }>();
    expect(second.proposed).toHaveLength(0);
    expect(second.suppressed.length).toBeGreaterThanOrEqual(1);
  }, GIT_TIMEOUT);
});

describe('gwtp distill backfill (spec 04 §7/§8) — replay the current epoch into the ledger', () => {
  const REF = 'refs/program/ledger-seed04-test';

  it('replays deterministic judges, appends events, and PROPOSES the watermark advance', async () => {
    const dir = freshFixture();
    expect(await run(['backfill', '--repo', dir, '--ledger-ref', REF, '--json'])).toBe(0);
    const res = json<{
      epoch: string;
      commitsReplayed: number;
      deterministicJudgements: number;
      eventsWritten: number;
      watermarkDiff: string | null;
      watermark: { lastEpoch: string } | null;
    }>();
    expect(res.commitsReplayed).toBeGreaterThanOrEqual(1);
    expect(res.deterministicJudgements).toBeGreaterThanOrEqual(1);
    expect(res.eventsWritten).toBeGreaterThanOrEqual(1);
    // The watermark advance is a PROPOSED manifest diff (never a write to .program/).
    expect(res.watermarkDiff).toContain('.program/manifest.yaml');
    expect(res.watermarkDiff).toContain('last_walked');
    expect(res.watermark?.lastEpoch).toBe(res.epoch);

    // The events landed on the requested ref — and NOT on the real refs/program/ledger.
    expect(git(dir, ['rev-parse', '--verify', REF]).length).toBeGreaterThan(0);
    expect(() => git(dir, ['rev-parse', '--verify', 'refs/program/ledger'])).toThrow();

    // .program/ is untouched (the machine proposes; the human ratifies — INV-001).
    expect(git(dir, ['status', '--porcelain']).split('\n').some((l) => l.includes('.program/'))).toBe(false);
  }, GIT_TIMEOUT);

  it('is idempotent: a second backfill dedupes rather than re-appending (content-addressed)', async () => {
    const dir = freshFixture();
    expect(await run(['backfill', '--repo', dir, '--ledger-ref', REF, '--json'])).toBe(0);
    const firstWritten = json<{ eventsWritten: number }>().eventsWritten;
    expect(firstWritten).toBeGreaterThanOrEqual(1);

    stdout = '';
    expect(await run(['backfill', '--repo', dir, '--ledger-ref', REF, '--json'])).toBe(0);
    const second = json<{ eventsWritten: number; eventsDeduped: number }>();
    expect(second.eventsWritten).toBe(0);
    expect(second.eventsDeduped).toBe(firstWritten);
  }, GIT_TIMEOUT);

  it('exits 2 without --ledger-ref', async () => {
    expect(await run(['backfill', '--repo', shared])).toBe(2);
    expect(stderr).toContain('--ledger-ref');
  });

  it('rejects a negative --max-judged (exit 2)', async () => {
    expect(await run(['backfill', '--repo', shared, '--ledger-ref', REF, '--max-judged', '-1'])).toBe(2);
  });
});
