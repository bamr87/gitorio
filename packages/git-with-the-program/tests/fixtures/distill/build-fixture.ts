// Implements: the SYNTHETIC-BY-CONSTRUCTION fixture repo SEED-04 acceptance calls for. A live
// mid-size OSS clone is not reliably available in this environment, so instead of cloning one we
// BUILD a throwaway git repo whose crafted history exhibits EXACTLY the structures the distillation
// walk must detect (docs/spec/04-distillation.md §1–§7):
//
//   • >= 2 structural epochs — a single upheaval commit renames a whole directory (oldpkg/ →
//     newpkg/), rewrites the README, and bumps the dependency manifest, so the z-score break finder
//     (spec 04 §1) opens a second epoch there. The history is deliberately >= 10 commits so the lone
//     directory-rename spike clears the default 3σ threshold (z = sqrt(N-1)).
//   • a REVERT PAIR — `git revert` writes "This reverts commit <sha>." (spec 04 §2 litigation).
//   • a STABLE violation-free `core/` import boundary — every file under core/ imports only
//     relatively across the whole history, so the negative-space prover proves it held (spec 04 §2)
//     and a precision seed can be computed from the violation-free span (spec 04 §5).
//   • a DOC SNAPSHOT per epoch — README present at each epoch boundary, plus an ADR per epoch.
//   • a `.program/` — one RATIFIED, deterministic-class invariant so `gwtp distill backfill` has a
//     seated judge to replay, and a manifest with a watermark the backfill can propose advancing.
//
// ONE FIXTURE DEFINITION, shared by the CLI test and the integration/exit test (SEED-04 task 3).
// Identity and per-commit dates are PINNED, so the build is deterministic; tests assert the
// STRUCTURE (epoch count, revert detected, boundary held) rather than exact SHAs, so they survive
// git-version differences in rename detection.
//
// This file writes ONLY under the caller-supplied directory (a $TMPDIR throwaway). It runs
// `git init` and read/write git plumbing against THAT repo — never against the checked-in project
// (SEED-04 constraint 7).

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Raw git for arranging the fixture. Identity is pinned; the date is supplied per commit. */
function git(cwd: string, args: readonly string[], date?: string): string {
  const dateEnv = date === undefined ? {} : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@localhost',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@localhost',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      ...dateEnv,
    },
  }).trim();
}

function put(dir: string, rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function del(dir: string, rel: string): void {
  rmSync(join(dir, rel), { force: true });
}

// ── file bodies ──────────────────────────────────────────────────────────────────────────────

const README_V1 = '# Project\n\nEpoch one: the monolith.\n';
const README_V2 =
  '# Project (v2)\n\nEpoch two: the adapters era. The monolith package was split and renamed,\n' +
  'the dependency manifest grew, and the docs were rewritten.\n';

const PKG_EMPTY = '{\n  "name": "fixture",\n  "version": "1.0.0",\n  "dependencies": {}\n}\n';
const PKG_LEFTPAD =
  '{\n  "name": "fixture",\n  "version": "2.0.0",\n  "dependencies": {\n    "left-pad": "^1.3.0"\n  }\n}\n';

// core/ — relative imports ONLY, across the whole history (the held boundary, spec 04 §2/§5).
const CORE_INDEX_V1 = "import { greet } from './util.js';\nexport const app = (): string => greet();\n";
const CORE_INDEX_V2 = "import { greet } from './util.js';\nexport const app = (): string => greet() + '!';\n";
const CORE_INDEX_V3 =
  "import { greet } from './util.js';\nimport { help } from './helper.js';\nexport const app = (): string => greet() + help();\n";
const CORE_UTIL_V1 = "export const greet = (): string => 'hi';\n";
const CORE_UTIL_V2 = "export const greet = (): string => 'hello';\n";
const CORE_UTIL_V3 = "export const greet = (): string => 'hello, world';\n";
const CORE_HELPER = "export const help = (): string => '!';\n";

// app/ — MAY own a third-party dependency (outside core/, so it never breaks the boundary probe).
const APP_MAIN = "import leftPad from 'left-pad';\nexport const pad = (s: string): string => leftPad(s, 8);\n";

const PKG_FILES = ['a', 'b', 'c', 'd'] as const;
const oldpkgBody = (name: string): string => `export const ${name} = ${name.length};\n`;

const PROGRAM_CHARTER =
  '# Charter\n\nThe engine core imports only the standard library; adapters own third-party deps.\n' +
  'The program (.program/) is sacred: human-ratified PRs only.\n';

// A RATIFIED, deterministic-class invariant on core/** — the import-boundary judge sits for the
// `dependency` class, so `gwtp distill backfill` can replay it over the current epoch.
const PROGRAM_INVARIANTS =
  '# Ratified invariants (fixture)\n' +
  '- id: INV-001\n' +
  '  statement: core/ imports no forge or third-party modules; adapters own dependencies\n' +
  '  class: dependency\n' +
  '  scope: [core/**]\n' +
  '  enforcement: deterministic\n' +
  '  precision: 1.0\n' +
  '  budget: 1.0\n' +
  '  half_life: 90d\n' +
  '  status: ratified\n' +
  '  provenance: [charter]\n';

const PROGRAM_PRECEDENTS = '# Precedents (fixture)\n[]\n';

const PROGRAM_MANIFEST =
  '# Manifest (fixture)\n' +
  'walked:\n' +
  '  last_walked: "0000000000000000000000000000000000000000"\n' +
  '  last_epoch: e0\n';

const PROGRAM_SCOPE = '# Scope (fixture)\nclaims: []\n';
const PROGRAM_TRAJECTORY = '# Trajectory (fixture)\n[]\n';

// ── the crafted history ────────────────────────────────────────────────────────────────────────

/** What a built fixture exposes to a test. */
export interface DistillFixture {
  readonly dir: string;
  /** Tip commit sha (HEAD). */
  readonly head: string;
  /** Every commit sha, oldest-first. */
  readonly commits: readonly string[];
  /** The commit that was reverted, and the revert commit itself (the revert pair). */
  readonly revertedSha: string;
  readonly revertSha: string;
  /** The upheaval commit that opens epoch two (directory rename + README rewrite + manifest bump). */
  readonly upheavalSha: string;
  /** Expected minimum number of epochs the segmenter finds (>= 2). */
  readonly minEpochs: 2;
}

/**
 * Builds the synthetic distillation fixture into `dir` (which must exist and be empty). Returns the
 * shas a test needs. Deterministic given a fixed git version; tests assert structure, not exact shas.
 */
export function buildDistillFixture(dir: string): DistillFixture {
  git(dir, ['init', '-q', '-b', 'main', '.']);
  git(dir, ['config', 'user.email', 'fixture@localhost']);
  git(dir, ['config', 'user.name', 'fixture']);
  git(dir, ['config', 'commit.gpgsign', 'false']);

  const commits: string[] = [];
  const day = (n: number): string => {
    // 2022-01-01 + n*30 days, pinned so committer times spread across ~13 months (span > 365d).
    const base = Date.UTC(2022, 0, 1, 12, 0, 0);
    return new Date(base + n * 30 * 24 * 60 * 60 * 1000).toISOString();
  };
  let n = 0;
  const commit = (message: string): string => {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', message], day(n));
    n += 1;
    const sha = git(dir, ['rev-parse', 'HEAD']);
    commits.push(sha);
    return sha;
  };

  // c0 — root: the monolith. core/ (relative imports), README v1, ADR 1, empty manifest, oldpkg/,
  // app/ (owns a third-party dep), and the whole .program/ store.
  put(dir, 'README.md', README_V1);
  put(dir, 'core/index.ts', CORE_INDEX_V1);
  put(dir, 'core/util.ts', CORE_UTIL_V1);
  put(dir, 'app/main.ts', APP_MAIN);
  put(dir, 'package.json', PKG_EMPTY);
  put(dir, 'docs/adr/0001-foundation.md', '# ADR 1 — foundation\n\nThe monolith era.\n');
  for (const f of PKG_FILES) put(dir, `oldpkg/${f}.ts`, oldpkgBody(f));
  put(dir, '.program/charter.md', PROGRAM_CHARTER);
  put(dir, '.program/invariants.yaml', PROGRAM_INVARIANTS);
  put(dir, '.program/precedents.yaml', PROGRAM_PRECEDENTS);
  put(dir, '.program/manifest.yaml', PROGRAM_MANIFEST);
  put(dir, '.program/scope.yaml', PROGRAM_SCOPE);
  put(dir, '.program/trajectory.yaml', PROGRAM_TRAJECTORY);
  commit('root: the monolith');

  // c1 — co-change: both core files together (a co-change edge; core boundary still relative-only).
  put(dir, 'core/index.ts', CORE_INDEX_V2);
  put(dir, 'core/util.ts', CORE_UTIL_V2);
  commit('core: refine greeting');

  // c2..c6 — ordinary epoch-one commits, no renames (directory channel stays flat here).
  put(dir, 'oldpkg/e.ts', oldpkgBody('e'));
  commit('oldpkg: add module e');
  put(dir, 'core/util.ts', CORE_UTIL_V3);
  commit('core: expand greeting');
  put(dir, 'app/feature.ts', "import { pad } from './main.js';\nexport const feature = (): string => pad('x');\n");
  commit('app: add feature');
  put(dir, 'app/config.ts', 'export const config = { retries: 3 };\n'); // keep oldpkg/ pristine
  commit('app: add config');
  put(dir, 'core/index.ts', CORE_INDEX_V2 + '// stable\n');
  commit('core: annotate');

  // c7 — THE UPHEAVAL (opens epoch two): rename oldpkg/ -> newpkg/ (IDENTICAL content per file, so
  // `diff-tree -M` detects a 100%-similarity rename), rewrite the README, and grow the dependency
  // manifest. One commit, three structural signals; the lone directory-rename spike guarantees the
  // break clears 3σ (z = sqrt(N-1) over a 14-commit history).
  for (const f of [...PKG_FILES, 'e']) {
    put(dir, `newpkg/${f}.ts`, oldpkgBody(f));
    del(dir, `oldpkg/${f}.ts`);
  }
  put(dir, 'README.md', README_V2);
  put(dir, 'package.json', PKG_LEFTPAD);
  const upheavalSha = commit('refactor: oldpkg -> newpkg, rewrite README, grow deps');

  // c8..c9 — ordinary epoch-two commits.
  put(dir, 'newpkg/f.ts', oldpkgBody('f'));
  commit('newpkg: add module f');
  put(dir, 'core/util.ts', CORE_UTIL_V3 + '// v2 era\n');
  commit('core: note v2 era');

  // c10 — a change that will be reverted.
  put(dir, 'app/oops.ts', 'export const oops = true;\n');
  const revertedSha = commit('app: add oops (to be reverted)');

  // c11 — REVERT c10 → git writes "This reverts commit <sha>." (spec 04 §2 litigation).
  git(dir, ['revert', '--no-edit', revertedSha], day(n));
  n += 1;
  const revertSha = git(dir, ['rev-parse', 'HEAD']);
  commits.push(revertSha);

  // c12 — ADR per epoch: the epoch-two ADR.
  put(dir, 'docs/adr/0002-adapters.md', '# ADR 2 — adapters\n\nThe adapters era: core stays pure.\n');
  commit('docs: ADR 2 (adapters)');

  // c13 — a final relative import into core (the boundary is STILL held at the tip).
  put(dir, 'core/helper.ts', CORE_HELPER);
  put(dir, 'core/index.ts', CORE_INDEX_V3);
  const head = commit('core: add helper (relative import, boundary held)');

  return {
    dir,
    head,
    commits,
    revertedSha,
    revertSha,
    upheavalSha,
    minEpochs: 2,
  };
}
