// Tests for: docs/spec/04-distillation.md §2 (pass one — the deterministic fact base) and §5
// (the violation-free span). SEED-04 deliverable 1.
//
// THE FIXTURE IS SYNTHETIC BY CONSTRUCTION. SEED-04 acceptance asks for "a real mid-size OSS repo
// fixture", but a live clone is not available/reliable in this environment, so this suite BUILDS a
// throwaway repo under $TMPDIR whose crafted history exhibits EXACTLY the structure the walk must
// detect: two structural epochs separated by a directory rename and a README rewrite, one revert
// pair, one dependency-manifest change, a `core/` import boundary held violation-free across every
// commit, and a README + ADR snapshot per epoch. Because the identity and both dates are pinned on
// every commit, the commit SHAs — and therefore the whole fact base — are reproducible, which is
// what lets the determinism assertion be a byte-for-byte string equality.
//
// EVERY git-writing operation runs against the throwaway repo. Nothing here creates a ref in, or
// writes a file into, the repository this suite is checked into (SEED-04 constraint 7): the fixture
// path lives under `os.tmpdir()`, the miner is read-only (asserted: no new refs, clean working
// tree, unchanged HEAD), and the one `writeFactBase` call targets an ABSOLUTE path under the
// fixture, never the relative `.gwtp/` default that would resolve into this project.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseCommitSha, parseEpochId, unwrap } from '../../src/core/index.js';
import {
  DEFAULT_FACT_BASE_CONFIG,
  DISPERSION_MARKER,
  FACT_BASE_FILENAME,
  assertNotProgramPath,
  parseFactBase,
  readFactBase,
  serializeFactBase,
  writeFactBase,
} from '../../src/distill/factbase.js';
import type { EpochBoundary, FactBase } from '../../src/distill/factbase.js';
import { mineFactBase, mineRepo, revListRange, walkCommits } from '../../src/distill/miner.js';
import { createGitExec } from '../../src/ledger/git.js';

const GIT_TEST_TIMEOUT = 120_000;

const workspaces: string[] = [];

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

function workspace(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `gwtp-${name}-`));
  workspaces.push(dir);
  return dir;
}

/** Raw git for arranging the fixture. Identity is pinned; the date is supplied per commit. */
function git(cwd: string, args: readonly string[], date?: string): string {
  const dateEnv =
    date === undefined
      ? {}
      : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@localhost',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@localhost',
      ...dateEnv,
    },
  }).trim();
}

function put(dir: string, rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

interface Fixture {
  readonly dir: string;
  readonly c3: string; // "Add feature X" — the commit that is reverted
  readonly c4: string; // end of epoch one (boundary e0)
  readonly c7: string; // tip (boundary e1)
}

const PKG_EMPTY =
  '{\n  "name": "fixture",\n  "version": "1.0.0",\n  "dependencies": {}\n}\n';
const PKG_LEFTPAD =
  '{\n  "name": "fixture",\n  "version": "1.0.0",\n  "dependencies": {\n    "left-pad": "^1.0.0"\n  }\n}\n';

const README_V1 = '# Project\n\nEpoch one: the monolith.\n';
const README_V2 = '# Project (v2)\n\nEpoch two: the adapters era.\n';

/**
 * The crafted history (oldest → newest):
 *   c0 root      — README v1, core/{index,util}.ts (relative imports only), package.json (no deps),
 *                  docs/adr/0001, oldpkg/mod.ts
 *   c1           — core/index.ts AND core/util.ts modified together (a co-change edge)
 *   c2           — package.json gains a runtime dependency (a manifest event)
 *   c3           — "Add feature X" (feature/x.ts)
 *   c4           — revert c3 ("This reverts commit …") — a revert pair.  ┐ epoch one
 *   c5           — git mv oldpkg/ → newpkg/ (a directory rename)          ┘→┌ epoch two
 *   c6           — README rewritten to v2 (a doc rewrite)                    │
 *   c7 tip       — core/index.ts adds another RELATIVE import (boundary held)┘
 */
function buildFixture(): Fixture {
  const dir = workspace('distill-fixture');
  git(dir, ['init', '-q', '-b', 'main', '.']);
  git(dir, ['config', 'user.email', 'fixture@localhost']);
  git(dir, ['config', 'user.name', 'fixture']);

  // c0 — root
  put(dir, 'README.md', README_V1);
  put(dir, 'core/index.ts', "import { greet } from './util.js';\nexport const app = () => greet();\n");
  put(dir, 'core/util.ts', "export const greet = (): string => 'hi';\n");
  put(dir, 'package.json', PKG_EMPTY);
  put(dir, 'docs/adr/0001-init.md', '# ADR 1 — init\n');
  put(dir, 'oldpkg/mod.ts', 'export const x = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'root: monolith'], '2022-01-01T12:00:00Z');

  // c1 — co-change: both core files in one commit
  put(dir, 'core/index.ts', "import { greet } from './util.js';\nexport const app = () => greet() + '!';\n");
  put(dir, 'core/util.ts', "export const greet = (): string => 'hello';\n");
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'refine greeting'], '2022-02-01T12:00:00Z');

  // c2 — manifest change
  put(dir, 'package.json', PKG_LEFTPAD);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'deps: add left-pad'], '2022-03-01T12:00:00Z');

  // c3 — feature to be reverted
  put(dir, 'feature/x.ts', 'export const feature = 2;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'Add feature X'], '2022-04-01T12:00:00Z');
  const c3 = git(dir, ['rev-parse', 'HEAD']);

  // c4 — revert c3 (git writes "This reverts commit <c3>.")
  git(dir, ['revert', '--no-edit', c3], '2022-05-01T12:00:00Z');
  const c4 = git(dir, ['rev-parse', 'HEAD']);

  // c5 — directory rename. A filesystem move (identical content) + `git add -A`; diff-tree's `-M`
  // detects the rename at diff time, so this does not depend on `git mv` pre-creating the target.
  put(dir, 'newpkg/mod.ts', 'export const x = 1;\n');
  rmSync(join(dir, 'oldpkg', 'mod.ts'));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'move oldpkg -> newpkg'], '2022-06-01T12:00:00Z');

  // c6 — README rewrite
  put(dir, 'README.md', README_V2);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'docs: rewrite README for v2'], '2022-07-01T12:00:00Z');

  // c7 — another relative import into core (boundary still held)
  put(dir, 'core/helper.ts', "export const help = (): string => 'help';\n");
  put(
    dir,
    'core/index.ts',
    "import { greet } from './util.js';\nimport { help } from './helper.js';\nexport const app = () => greet() + help();\n",
  );
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'core: add helper'], '2022-08-01T12:00:00Z');
  const c7 = git(dir, ['rev-parse', 'HEAD']);

  return { dir, c3, c4, c7 };
}

function boundariesOf(fx: Fixture): readonly EpochBoundary[] {
  return [
    { epoch: unwrap(parseEpochId('e0')), at: unwrap(parseCommitSha(fx.c4)) },
    { epoch: unwrap(parseEpochId('e1')), at: unwrap(parseCommitSha(fx.c7)) },
  ];
}

async function mineOk(fx: Fixture): Promise<FactBase> {
  const res = await mineRepo(
    { cwd: fx.dir },
    { range: { from: null, to: 'HEAD' }, boundaries: boundariesOf(fx), config: DEFAULT_FACT_BASE_CONFIG },
  );
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(`mine failed: ${JSON.stringify(res.error)}`);
  return res.value;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('SEED-04 pass one — the deterministic fact miner (spec 04 §2)', () => {
  let fx: Fixture;
  let fb: FactBase;

  beforeAll(async () => {
    fx = buildFixture();
    fb = await mineOk(fx);
  }, GIT_TEST_TIMEOUT);

  it('walks every commit and carries the last SHA as the watermark (spec 04 §8)', () => {
    // c0..c7 = 8 commits, all non-merge (revert is an ordinary commit).
    expect(fb.watermark.commitsWalked).toBe(8);
    expect(fb.watermark.mergesWalked).toBe(0);
    expect(fb.watermark.lastWalked).toBe(fx.c7);
    expect(fb.watermark.firstWalked).toBeNull(); // cold start: walked from root
  });

  it('extracts the revert pair, resolved in range (spec 04 §2, precedents mined for free)', () => {
    const reverts = fb.synthesizable.litigation.reverts;
    expect(reverts).toHaveLength(1);
    const r = reverts[0];
    expect(r?.reverted).toBe(fx.c3);
    expect(r?.revertedResolved).toBe(fx.c3);
    expect(r?.subject).toMatch(/Revert "Add feature X"/);
  });

  it('extracts the dependency-manifest change over time (spec 04 §2)', () => {
    const events = fb.synthesizable.manifests.events;
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.ecosystem).toBe('npm');
    expect(e?.manifest).toBe('package.json');
    expect(e?.deltas).toContainEqual({
      name: 'left-pad',
      change: 'added',
      from: null,
      to: '^1.0.0',
      kind: 'runtime',
    });
  });

  it('extracts the directory rename oldpkg/ → newpkg/ (spec 04 §2 lifecycles)', () => {
    const renamed = fb.synthesizable.directories.events.filter((e) => e.kind === 'renamed');
    expect(renamed).toContainEqual(
      expect.objectContaining({ kind: 'renamed', dir: 'newpkg', fromDir: 'oldpkg', at: expect.any(String) }),
    );
    // The old directory is dead at the tip; the new one is alive.
    const byDir = new Map(fb.synthesizable.directories.lifecycles.map((l) => [l.dir, l]));
    expect(byDir.get('oldpkg' as never)?.alive).toBe(false);
    expect(byDir.get('newpkg' as never)?.alive).toBe(true);
  });

  it('records the file co-change edge for the two core files changed together', () => {
    const edge = fb.synthesizable.coChange.edges.find(
      (e) => e.a === 'core/index.ts' && e.b === 'core/util.ts',
    );
    expect(edge).toBeDefined();
    expect((edge?.coChanges ?? 0) >= 1).toBe(true);
    expect(edge?.confidence).toBeGreaterThan(0);
  });

  it('takes a doc snapshot per epoch — two distinct README states (spec 04 §2)', () => {
    const readmes = fb.synthesizable.docs.snapshots.filter((s) => s.kind === 'readme');
    expect(readmes).toHaveLength(2); // one per boundary
    for (const s of readmes) expect(s.present).toBe(true);
    const hashes = new Set(readmes.map((s) => s.contentHash));
    expect(hashes.size).toBe(2); // v1 and v2 are genuinely different snapshots
    const texts = readmes.map((s) => s.text);
    expect(texts).toContain(README_V1);
    expect(texts).toContain(README_V2);
    // The ADR is snapshotted too, at each boundary.
    expect(fb.synthesizable.docs.snapshots.some((s) => s.kind === 'adr')).toBe(true);
  });

  it('proves the core/ import boundary held violation-free, with a concrete span (spec 04 §2/§5)', () => {
    const proof = fb.synthesizable.negativeSpace.find((p) => p.probe.id === 'core-external-purity');
    expect(proof).toBeDefined();
    expect(proof?.held).toBe(true);
    expect(proof?.firstBreach).toBeNull();
    // Exhaustiveness witness: every walked commit was checked.
    expect(proof?.commitsChecked).toBe(fb.watermark.commitsWalked);
    expect((proof?.filesScanned ?? 0) > 0).toBe(true);
    // A CONCRETE violation-free span — the empirical precision seed input (spec 04 §5).
    expect(proof?.spanFrom).not.toBeNull();
    expect(proof?.spanTo).not.toBeNull();
    expect(
      Date.parse(proof?.spanFrom as string) <= Date.parse(proof?.spanTo as string),
    ).toBe(true);
  });

  it('builds an import graph per epoch boundary with relative edges resolved intra-repo', () => {
    expect(fb.synthesizable.importGraphs).toHaveLength(2);
    const tip = fb.synthesizable.importGraphs.find((g) => g.at === fx.c7);
    expect(tip).toBeDefined();
    const coreEdge = tip?.edges.find((e) => e.from === 'core/index.ts' && e.toSpecifier === './util.js');
    expect(coreEdge?.external).toBe(false);
    expect(coreEdge?.toPath).toBe('core/util.ts'); // ./util.js resolved to the .ts source
  });

  it('keeps author identity in the dispersion partition only (INV-003)', () => {
    expect(fb.dispersion.marker).toBe(DISPERSION_MARKER);
    expect(fb.dispersion.authorFileMatrix.authors).toBe(1);
    expect(fb.dispersion.authorFileMatrix.cells.length).toBeGreaterThan(0);
    // The synthesizable partition carries no author-bearing field: its serialization never names
    // the fixture author, while the dispersion partition does.
    const synthJson = JSON.stringify(fb.synthesizable);
    expect(synthJson).not.toContain('fixture@localhost');
    expect(JSON.stringify(fb.dispersion)).toContain('fixture@localhost');
  });
});

describe('determinism (spec 04 §2: a pure function of repo + range + config)', () => {
  it('mines the same range twice into a byte-identical fact base', async () => {
    const fx = buildFixture();
    const a = await mineOk(fx);
    const b = await mineOk(fx);
    const sa = serializeFactBase(a);
    const sb = serializeFactBase(b);
    expect(sa.ok && sb.ok).toBe(true);
    if (sa.ok && sb.ok) expect(sa.value).toBe(sb.value);
    // The regularity keys — what a tombstone binds to across re-runs (spec 04 §6) — are stable.
    expect(a.synthesizable.negativeSpace[0]?.regularity).toBe(b.synthesizable.negativeSpace[0]?.regularity);
    expect(a.synthesizable.litigation.reverts[0]?.regularity).toBe(
      b.synthesizable.litigation.reverts[0]?.regularity,
    );
  }, GIT_TEST_TIMEOUT);

  it('round-trips through parse without changing its serialized bytes', async () => {
    const fx = buildFixture();
    const fb = await mineOk(fx);
    const s1 = serializeFactBase(fb);
    expect(s1.ok).toBe(true);
    if (!s1.ok) return;
    const parsed = parseFactBase(s1.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s2 = serializeFactBase(parsed.value);
    expect(s2.ok && s2.value).toBe(s1.value);
  }, GIT_TEST_TIMEOUT);
});

describe('the walk is read-only — nothing under this project is touched (constraint 7)', () => {
  it('leaves the throwaway repo unchanged: no new refs, clean tree, unchanged HEAD', async () => {
    const fx = buildFixture();
    // The fixture lives under the OS temp directory, never this project.
    expect(fx.dir.startsWith(tmpdir())).toBe(true);

    const headBefore = git(fx.dir, ['rev-parse', 'HEAD']);
    const refsBefore = git(fx.dir, ['for-each-ref', '--format=%(refname)']);

    await mineOk(fx);

    expect(git(fx.dir, ['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(git(fx.dir, ['for-each-ref', '--format=%(refname)'])).toBe(refsBefore);
    // The miner touched no ledger/program ref and staged nothing.
    expect(refsBefore).toBe('refs/heads/main');
    expect(git(fx.dir, ['status', '--porcelain'])).toBe('');
  }, GIT_TEST_TIMEOUT);

  it('writeFactBase writes only under an explicit path and refuses the program store (INV-001)', async () => {
    const fx = buildFixture();
    const fb = await mineOk(fx);

    // A real write, to an ABSOLUTE path under the fixture (never the relative `.gwtp/` default,
    // which would resolve into this project's working directory).
    const outDir = join(fx.dir, '.gwtp', 'distill', 'facts');
    const written = writeFactBase({ ...DEFAULT_FACT_BASE_CONFIG, outDir }, fb);
    expect(written.ok).toBe(true);
    if (written.ok) {
      // The returned path is the resolved absolute path (symlinks collapsed, e.g. /var → /private/var
      // on macOS), so compare the suffix rather than the pre-resolution spelling.
      expect(written.value.endsWith(join('.gwtp', 'distill', 'facts', FACT_BASE_FILENAME))).toBe(true);
      expect(existsSync(written.value)).toBe(true);
      const back = readFactBase(written.value);
      expect(back.ok).toBe(true);
    }

    // The INV-001 structural guard: any outDir resolving into `.program/` is refused before any fs.
    const refused = assertNotProgramPath(join(fx.dir, '.program', 'distill'));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('invalid-path');

    // Belt-and-braces: writeFactBase itself refuses, and writes nothing.
    const programOut = join(fx.dir, '.program', 'facts');
    const badWrite = writeFactBase({ ...DEFAULT_FACT_BASE_CONFIG, outDir: programOut }, fb);
    expect(badWrite.ok).toBe(false);
    expect(existsSync(programOut)).toBe(false);
  }, GIT_TEST_TIMEOUT);
});

describe('the cost guard stops and reports rather than silently spending (spec 04 §7)', () => {
  it('trips maxCommits in walkCommits', async () => {
    const fx = buildFixture();
    const git0 = createGitExec({ cwd: fx.dir });
    const res = await walkCommits(git0, { from: null, to: 'HEAD' }, {
      order: 'oldest-first',
      detectRenames: true,
      maxCommits: 2,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe('budget-exceeded');
      expect(res.error.limit).toBe('maxCommits');
      expect(res.error.cap).toBe(2);
      expect(res.error.seen).toBe(8);
    }
  }, GIT_TEST_TIMEOUT);

  it('trips maxBlobBytes in mineFactBase', async () => {
    const fx = buildFixture();
    const git0 = createGitExec({ cwd: fx.dir });
    const res = await mineFactBase(git0, {
      range: { from: null, to: 'HEAD' },
      boundaries: boundariesOf(fx),
      config: { ...DEFAULT_FACT_BASE_CONFIG, budget: { ...DEFAULT_FACT_BASE_CONFIG.budget, maxBlobBytes: 1 } },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe('budget-exceeded');
      expect(res.error.limit).toBe('maxBlobBytes');
    }
  }, GIT_TEST_TIMEOUT);

  it('revListRange returns a fixed oldest-first order', async () => {
    const fx = buildFixture();
    const git0 = createGitExec({ cwd: fx.dir });
    const shas = await revListRange(git0, { from: null, to: 'HEAD' }, 'oldest-first');
    expect(shas).toHaveLength(8);
    expect(shas[shas.length - 1]).toBe(fx.c7); // newest last
  }, GIT_TEST_TIMEOUT);
});
