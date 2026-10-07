// Implements tests for: docs/spec/06-upkeep.md §2 (the local half of the facets) and §1.3
// (identity-free observation) — the pure parsers in src/upkeep/facts.ts, then the gatherer
// against a real throwaway git repository.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGitExec } from '../../src/ledger/git.js';
import { defaultConfig } from '../../src/upkeep/config.js';
import {
  captureVersion,
  countAreas,
  extractItems,
  gatherLocalFacts,
  missingMentions,
  parseLog,
  parseTagRefs,
  readmeTagline,
} from '../../src/upkeep/facts.js';
import type { UpkeepConfig } from '../../src/upkeep/types.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('pure parsers', () => {
  it('parseTagRefs peels annotated tags to their commit', () => {
    const text = ['v1.0.0\x1faaaa\x1fcccc', 'v0.9.0\x1fbbbb\x1f', ''].join('\n');
    expect(parseTagRefs(text)).toEqual([
      { name: 'v1.0.0', sha: 'cccc' },
      { name: 'v0.9.0', sha: 'bbbb' },
    ]);
  });

  it('parseLog keeps subject and a BREAKING CHANGE bit, and nothing else from the body', () => {
    const text = 'a1\x1ffeat: x\x1fBREAKING CHANGE: wire format\x1e\nb2\x1ffix: y\x1fjust a body\x1e\n';
    expect(parseLog(text)).toEqual([
      { sha: 'a1', subject: 'feat: x', breaking: true },
      { sha: 'b2', subject: 'fix: y', breaking: false },
    ]);
  });

  it('countAreas groups by top-level directory, root files under "."', () => {
    expect(countAreas(['src/a.ts', 'src/b/c.ts', 'README.md', 'docs/x.md'])).toEqual({ '.': 1, docs: 1, src: 2 });
  });

  it('readmeTagline skips badges, comments and headings, and strips markdown', () => {
    const md = [
      '# Title',
      '',
      '[![ci](https://x/badge.svg)](https://x)',
      '<!-- a comment -->',
      '',
      '**A [tool](https://x) that `does` things.**',
      'Second line of the same paragraph.',
      '',
      'Not this one.',
    ].join('\n');
    expect(readmeTagline(md)).toBe('A tool that does things. Second line of the same paragraph.');
  });

  it("reads this repository's own tagline", () => {
    const tagline = readmeTagline(readFileSync(join(REPO_ROOT, 'README.md'), 'utf8'));
    expect(tagline).toMatch(/^An agentic governance framework/);
    expect(tagline).not.toContain('**');
  });

  it('captureVersion reports the 1-based line of the match', () => {
    const text = '{\n  "name": "x",\n  "version": "1.2.3"\n}';
    expect(captureVersion('package.json', text, '"version"\\s*:\\s*"([^"]+)"')).toEqual({
      path: 'package.json',
      value: '1.2.3',
      line: 3,
    });
    expect(captureVersion('missing', null, '(x)')).toEqual({ path: 'missing', value: null, line: null });
  });

  it('extractItems: glob with a capture group, and a regex over one file', () => {
    const tracked = ['schemas/a.schema.json', 'schemas/b.schema.json', 'schemas/README.md', 'src/x.ts'];
    expect(extractItems({ glob: 'schemas/*.schema.json', capture: '^schemas/(.+)\\.schema\\.json$' }, tracked, () => null)).toEqual(['a', 'b']);
    expect(extractItems({ glob: 'src/**' }, tracked, () => null)).toEqual(['src/x.ts']);
    const file = 'const C = {\n  alpha: {\n  },\n  beta: {\n  },\n};';
    expect(extractItems({ file: 'f.ts', pattern: '^  ([a-z]+): \\{$' }, tracked, () => file)).toEqual(['alpha', 'beta']);
  });

  it('missingMentions is a case-insensitive substring check of the rendered mention', () => {
    expect(missingMentions('Run `GWTP Validate` first.', ['validate', 'ledger'], 'gwtp {item}')).toEqual(['ledger']);
  });
});

// ---------------------------------------------------------------------------
// The gatherer, against a real repository
// ---------------------------------------------------------------------------

describe('gatherLocalFacts on a throwaway repository', () => {
  let dir: string;
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Secret Author',
        GIT_AUTHOR_EMAIL: 'secret@example.com',
        GIT_COMMITTER_NAME: 'Secret Author',
        GIT_COMMITTER_EMAIL: 'secret@example.com',
      },
    }).toString();
  const pkg = (version: string): void =>
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version, description: 'A demo.', keywords: ['Demo Tool'], license: 'MIT' }, null, 2));
  const commit = (msg: string): void => {
    git('add', '-A');
    git('commit', '-q', '-m', msg);
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gwtp-upkeep-facts-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'README.md'), '# Demo\n\nA demo project for upkeep.\n');
    pkg('0.1.0');
    commit('init');
    git('tag', 'v0.1.0');
    writeFileSync(join(dir, 'a.txt'), 'a');
    commit('fix: something');
    pkg('0.2.0');
    commit('feat: bump to 0.2.0');
    writeFileSync(join(dir, 'b.txt'), 'b');
    commit('feat: after the bump');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const config = (): UpkeepConfig => ({ ...defaultConfig(), releases: { backfill: 5, notes: 'template' } });

  it('locates where the current version began, and what is unreleased since', async () => {
    const facts = await gatherLocalFacts({ root: dir, git: createGitExec({ cwd: dir }), config: config() });
    expect(facts.version?.source.value).toBe('0.2.0');
    const intro = git('rev-list', '-n', '1', 'HEAD~1').trim();
    expect(facts.version?.introduced_at).toBe(intro);
    expect(facts.unreleased.map((c) => c.subject)).toEqual(['feat: after the bump']);
    expect(facts.license_file).toBeNull();
    expect(facts.readme?.tagline).toBe('A demo project for upkeep.');
  });

  it('builds release histories for existing tags and the pending one', async () => {
    const facts = await gatherLocalFacts({ root: dir, git: createGitExec({ cwd: dir }), config: config() });
    expect(facts.history.map((h) => [h.tag, h.pending, h.previous])).toEqual([
      ['v0.1.0', false, null],
      ['v0.2.0', true, 'v0.1.0'],
    ]);
    expect(facts.history[1]!.commits.map((c) => c.subject)).toEqual(['feat: bump to 0.2.0', 'fix: something']);
    expect(facts.history[1]!.areas).toEqual({ '.': 2 });
  });

  it('is identity-free: no author or committer reaches the facts', async () => {
    const facts = await gatherLocalFacts({ root: dir, git: createGitExec({ cwd: dir }), config: config() });
    const s = JSON.stringify(facts);
    expect(s).not.toContain('Secret Author');
    expect(s).not.toContain('secret@example.com');
  });
});
