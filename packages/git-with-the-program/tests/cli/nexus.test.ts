// Implements tests for: docs/spec/05-nexus.md §4-§7 through the CLI surface (`gwtp nexus`)
// and the `gwtp judge --ring` integration — the self-hosting posture throughout: every case
// runs against THIS repository's real tree, because a perception layer that only works on
// fixtures has not been shown to work (TRJ-003).
//
// Q-38's rule holds: assertions are relations (fresh-after-build, drift-cites-added-line,
// exit-code contracts), never snapshots of today's node counts.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run as runNexus } from '../../src/cli/commands/nexus.js';
import { run as runJudge } from '../../src/cli/commands/judge.js';
import { main } from '../../src/cli/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let stdout: string;
let stderr: string;

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

// A scratch repo copy is overkill; build/status write only under .gwtp/nexus/ (gitignored).
// For the write-path cases, use an isolated temp tree so the suite never races the real cache.
let scratch: string;

function makeScratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gwtp-nexus-'));
  writeFileSync(
    join(dir, 'a.ts'),
    ['export function one(): number {', '  return 1;', '}', 'export function two(): number {', '  return one() + one();', '}'].join(
      '\n',
    ),
  );
  writeFileSync(join(dir, 'b.ts'), "import { two } from './a.js';\nexport const n = two();\n");
  return dir;
}

describe('gwtp nexus build / status', () => {
  beforeEach(() => {
    scratch = makeScratchRepo();
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('build writes the cache and status then reports FRESH (exit 0)', async () => {
    expect(await runNexus(['build', '--repo', scratch])).toBe(0);
    expect(stdout).toContain('nexus        sha256:');
    expect(stdout).toContain('.gwtp');
    expect(await runNexus(['status', '--repo', scratch])).toBe(0);
    expect(stdout).toContain('FRESH');
  });

  it('status reports STALE (exit 1) after the tree changes — staleness answered by rebuilding', async () => {
    expect(await runNexus(['build', '--repo', scratch])).toBe(0);
    writeFileSync(join(scratch, 'c.ts'), 'export const later = 3;\n');
    expect(await runNexus(['status', '--repo', scratch])).toBe(1);
    expect(stdout).toContain('STALE');
  });

  it('status without a cache is exit 1 with a note, never a crash', async () => {
    expect(await runNexus(['status', '--repo', scratch])).toBe(1);
    expect(stdout).toContain('MISSING');
  });

  it('build --json is machine-readable and self-describing', async () => {
    expect(await runNexus(['build', '--repo', scratch, '--json'])).toBe(0);
    const parsed = JSON.parse(stdout) as { nexus: string; stats: { files: number }; ok: boolean };
    expect(parsed.ok).toBe(true);
    expect(parsed.nexus).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(parsed.stats.files).toBeGreaterThan(0);
  });
});

describe('gwtp nexus queries over this repository', () => {
  it('defs cites spans in path:start-end form (INV-004 currency)', async () => {
    expect(await runNexus(['defs', 'src/core/paths.ts', '--repo', REPO_ROOT, '--json'])).toBe(0);
    const parsed = JSON.parse(stdout) as {
      definitions: readonly { name: string; citation: string }[];
    };
    const names = parsed.definitions.map((d) => d.name);
    expect(names).toContain('matchesScope');
    for (const d of parsed.definitions) {
      expect(d.citation).toMatch(/^src\/core\/paths\.ts:\d+-\d+$/);
    }
  });

  it('importers distinguishes value from type-only, the ImportForm vocabulary shared with the judge', async () => {
    expect(await runNexus(['importers', 'src/core/paths.ts', '--repo', REPO_ROOT, '--json'])).toBe(0);
    const parsed = JSON.parse(stdout) as { importers: readonly { path: string; form: string }[] };
    const forms = new Set(parsed.importers.map((i) => i.form));
    expect(forms.has('value')).toBe(true);
    expect(forms.has('type-only')).toBe(true);
  });

  it('callers answers for a named definition', async () => {
    expect(await runNexus(['callers', 'src/core/paths.ts#matchesScope', '--repo', REPO_ROOT, '--json'])).toBe(0);
    const parsed = JSON.parse(stdout) as {
      definitions: readonly { callers: readonly { at: string }[] }[];
    };
    expect(parsed.definitions.length).toBeGreaterThan(0);
    expect((parsed.definitions[0]?.callers.length ?? 0)).toBeGreaterThan(0);
  });

  it('seams partitions the tree and every module lands in exactly one seam', async () => {
    expect(await runNexus(['seams', '--repo', REPO_ROOT, '--json'])).toBe(0);
    const parsed = JSON.parse(stdout) as { seams: readonly { id: string; members: readonly string[] }[] };
    const all = parsed.seams.flatMap((s) => s.members);
    expect(new Set(all).size).toBe(all.length);
    // The engine's src modules are one import-connected seam — they all reach src/core.
    const seamOfCore = parsed.seams.find((s) => s.members.includes('src/core/paths.ts'));
    expect(seamOfCore?.members).toContain('src/ledger/fold.ts');
    expect(seamOfCore?.members).toContain('src/judge/deterministic/imports.ts');
  });

  it('an unknown module is a usage error (exit 2), and an unknown verb prints usage', async () => {
    expect(await runNexus(['defs', 'src/nonesuch.ts', '--repo', REPO_ROOT])).toBe(2);
    expect(stderr).toContain('no module');
    stderr = '';
    expect(await runNexus(['perceive-harder'])).toBe(2);
    expect(stderr).toContain('unknown verb');
  });

  it('is registered on the gwtp command surface', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(stdout).toContain('nexus');
  });
});

describe('gwtp nexus ring / gwtp judge --ring (spec 05 §5, spec 03 §3)', () => {
  const RING_DIFF = [
    'diff --git a/src/core/paths.ts b/src/core/paths.ts',
    '--- a/src/core/paths.ts',
    '+++ b/src/core/paths.ts',
    '@@ -105,1 +105,1 @@',
    '+  return scope.some((g) => matchesGlob(g, path));',
    '',
  ].join('\n');

  it('ring callers grants cross-file caller bodies as context', async () => {
    const diffFile = join(mkdtempSync(join(tmpdir(), 'gwtp-ring-')), 'ring.diff');
    writeFileSync(diffFile, RING_DIFF);
    try {
      expect(await runNexus(['ring', 'callers', '--diff', diffFile, '--repo', REPO_ROOT, '--json'])).toBe(0);
      const parsed = JSON.parse(stdout) as {
        hunks: readonly { path: string; kind: string }[];
        counts: { diff: number; context: number };
      };
      expect(parsed.counts.diff).toBe(1);
      expect(parsed.counts.context).toBeGreaterThan(0);
      // matchesScope's callers include the deterministic judges — other files, granted.
      expect(parsed.hunks.some((h) => h.kind === 'context' && h.path !== 'src/core/paths.ts')).toBe(true);
    } finally {
      rmSync(dirname(diffFile), { recursive: true, force: true });
    }
  });

  it('judge --ring widens the sealed bundle and still cites only the introduced line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gwtp-judge-ring-'));
    const diffFile = join(dir, 'breach.diff');
    writeFileSync(
      diffFile,
      [
        'diff --git a/src/core/canonical.ts b/src/core/canonical.ts',
        '--- a/src/core/canonical.ts',
        '+++ b/src/core/canonical.ts',
        '@@ -10,2 +10,3 @@',
        " import { createHash } from 'node:crypto';",
        "+import { Octokit } from '@octokit/rest';",
        " import { fail, ok, type Parsed } from './result.js';",
        '',
      ].join('\n'),
    );
    try {
      expect(await runJudge(['INV-005', '--diff', diffFile, '--repo', REPO_ROOT, '--ring', 'file', '--json'])).toBe(0);
      const parsed = JSON.parse(stdout) as {
        diff: { hunks: number; scopedHunks: number; ring: string };
        verdict: { verdict: string; severity?: string; evidence?: readonly string[] };
      };
      expect(parsed.diff.ring).toBe('file');
      expect(parsed.diff.scopedHunks).toBeGreaterThan(parsed.diff.hunks); // context was granted
      expect(parsed.verdict.verdict).toBe('drift');
      expect(parsed.verdict.evidence).toEqual(['src/core/canonical.ts:11']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a ring outside the CONTEXT_RINGS ladder (exit 2)', async () => {
    expect(await runJudge(['INV-005', '--diff', '-', '--ring', 'galaxy'])).toBe(2);
    expect(stderr).toContain('--ring must be one of');
  });
});
