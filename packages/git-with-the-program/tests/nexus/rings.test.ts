// Implements tests for: docs/spec/05-nexus.md §5 (context rings) against spec 03 §3's
// contract ("function bodies → file → nearest callers") and its three ring rules: context is
// context (` `-prefixed, never citable as an offence), the ring does not escape the
// assertion's scope (Q-66), and everything still passes the real seal — the widened bundle
// goes through `sealEvidence` and the deterministic judge unchanged. Also covers
// src/nexus/query.ts (enclosing definitions, callers, seams, importsMatching).

import { describe, expect, it } from 'vitest';

import { postImageLines } from '../../src/judge/deterministic/imports.js';
import { judgeImportBoundary } from '../../src/judge/deterministic/imports.js';
import { assembleEvidence } from '../../src/evidence/assembler.js';
import { sealEvidence, citationsWithinBundle, type AssertionView } from '../../src/core/evidence.js';
import { parseUnifiedDiff } from '../../src/core/diff.js';
import { unwrap } from '../../src/core/result.js';
import type { NonEmptyReadonlyArray } from '../../src/core/brand.js';
import type { PathGlob, RepoPath } from '../../src/core/paths.js';
import { parseCitation } from '../../src/core/verdict.js';
import type { ChangeRef } from '../../src/core/change.js';
import { parseCommitSha } from '../../src/core/ids.js';
import { committerTimeFromEpochMillis } from '../../src/core/time.js';
import { parseAssertionId } from '../../src/core/ids.js';
import { type FileSnapshot, buildNexus } from '../../src/nexus/build.js';
import {
  callersOf,
  enclosingDefinition,
  importsMatching,
  indexNexus,
  seamOf,
  seams,
} from '../../src/nexus/query.js';
import { nexusChangeSource, ringHunks } from '../../src/nexus/rings.js';

const path = (p: string): RepoPath => p as RepoPath;
const glob = (g: string): PathGlob => g as PathGlob;

// ---------------------------------------------------------------------------
// The tree under test
// ---------------------------------------------------------------------------

const CORE = [
  'export function target(n: number): number {', // 1
  '  return n + 1;', // 2
  '}', // 3
  '', // 4
  'export function nearby(n: number): number {', // 5
  '  return target(n) * 2;', // 6
  '}', // 7
].join('\n');

const CALLER = [
  "import { target } from '../core/lib.js';", // 1
  '', // 2
  'export function outside(n: number): number {', // 3
  '  return target(n) - 1;', // 4
  '}', // 5
].join('\n');

const FILES: readonly FileSnapshot[] = [
  { path: path('src/core/lib.ts'), content: CORE },
  { path: path('src/app/use.ts'), content: CALLER },
];

const ix = indexNexus(buildNexus(FILES));
const fileMap = new Map<string, string>([
  ['src/core/lib.ts', CORE],
  ['src/app/use.ts', CALLER],
]);

/** A diff touching the body of `target` (line 2 of src/core/lib.ts). */
const DIFF = [
  'diff --git a/src/core/lib.ts b/src/core/lib.ts',
  '--- a/src/core/lib.ts',
  '+++ b/src/core/lib.ts',
  '@@ -2,1 +2,1 @@',
  '+  return n + 2;',
  '',
].join('\n');
const BASE = parseUnifiedDiff(DIFF);

// ---------------------------------------------------------------------------
// Query primitives
// ---------------------------------------------------------------------------

describe('query primitives', () => {
  it('enclosingDefinition finds the innermost span', () => {
    expect(enclosingDefinition(ix, path('src/core/lib.ts'), 2)?.name).toBe('target');
    expect(enclosingDefinition(ix, path('src/core/lib.ts'), 6)?.name).toBe('nearby');
    expect(enclosingDefinition(ix, path('src/core/lib.ts'), 4)).toBeNull();
  });

  it('callersOf finds resolved callers across modules', () => {
    const target = enclosingDefinition(ix, path('src/core/lib.ts'), 2);
    expect(target).not.toBeNull();
    const callers = callersOf(ix, target ?? (() => { throw new Error('unreachable'); })());
    expect(callers.map((c) => c.definition.name).sort()).toEqual(['nearby', 'outside']);
  });

  it('seams: the two modules are one import-connected component', () => {
    const partition = seams(ix);
    expect(partition).toHaveLength(1);
    expect(partition[0]?.id).toBe('src/app/use.ts');
    expect(seamOf(ix, path('src/core/lib.ts'))?.members).toEqual([
      'src/app/use.ts',
      'src/core/lib.ts',
    ]);
  });

  it('importsMatching answers the whole-tree shape (spec 05 §7)', () => {
    const hits = importsMatching(ix, [glob('src/app/**')], (t) => t?.kind === 'module');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.from.path).toBe('src/app/use.ts');
  });
});

// ---------------------------------------------------------------------------
// The rings (spec 05 §5)
// ---------------------------------------------------------------------------

describe('ringHunks', () => {
  it('`hunk` is the base diff, untouched', () => {
    expect(ringHunks(ix, fileMap, BASE, 'hunk')).toBe(BASE);
  });

  it('`enclosing-symbol` grants the innermost function body', () => {
    const hunks = ringHunks(ix, fileMap, BASE, 'enclosing-symbol');
    expect(hunks.length).toBe(2);
    const ctx = hunks[1];
    expect(ctx).toMatchObject({ path: 'src/core/lib.ts', newStart: 1, newLines: 3 });
  });

  it('`file` grants each touched module in full, swallowing the symbol span', () => {
    const hunks = ringHunks(ix, fileMap, BASE, 'file');
    expect(hunks.length).toBe(2);
    expect(hunks[1]).toMatchObject({ path: 'src/core/lib.ts', newStart: 1, newLines: 7 });
  });

  it('`callers` adds nearest-caller bodies across modules — spec 03 §3 made real', () => {
    const hunks = ringHunks(ix, fileMap, BASE, 'callers');
    const spans = hunks.map((h) => `${h.path}:${h.newStart}-${h.newStart + h.newLines - 1}`);
    expect(spans).toContain('src/core/lib.ts:1-7'); // whole touched file (nearby swallowed)
    expect(spans).toContain('src/app/use.ts:3-5'); // the cross-module caller's body
  });

  it('rule 1: granted context carries only context lines — nothing a judge can call added', () => {
    for (const ring of ['enclosing-symbol', 'file', 'callers'] as const) {
      for (const h of ringHunks(ix, fileMap, BASE, ring)) {
        if (BASE.includes(h)) continue;
        for (const line of postImageLines(h)) {
          expect(line.added).toBe(false);
        }
      }
    }
  });

  it('deterministic: same inputs, same hunks, byte for byte', () => {
    const a = ringHunks(ix, fileMap, BASE, 'callers');
    const b = ringHunks(ix, fileMap, BASE, 'callers');
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// The port, through the REAL assembler and seal (nothing bypassed)
// ---------------------------------------------------------------------------

const REF: ChangeRef = {
  commit: unwrap(parseCommitSha('0'.repeat(40))),
  committerTime: unwrap(committerTimeFromEpochMillis(0)),
};

const CORE_SCOPE_VIEW: AssertionView = {
  id: unwrap(parseAssertionId('INV-005')),
  statement: 'Engine core imports no forge-specific APIs; GitHub access lives in adapters/',
  class: 'dependency',
  scope: [glob('src/core/**')] as unknown as NonEmptyReadonlyArray<PathGlob>,
};

describe('nexusChangeSource through assembleEvidence + sealEvidence', () => {
  it('rule 2: the ring does not escape the assertion scope (Q-66)', async () => {
    const source = nexusChangeSource(ix, fileMap, BASE);
    const sealed = unwrap(
      await assembleEvidence(
        { assertion: CORE_SCOPE_VIEW, charter: '', change: source, ref: REF, ring: 'callers' },
        sealEvidence,
      ),
    );
    // src/app/use.ts is a real caller but lies OUTSIDE scope src/core/** — never shown.
    expect(sealed.bundle.hunks.every((h) => h.path.startsWith('src/core/'))).toBe(true);
    expect(sealed.bundle.hunks.length).toBe(2); // the diff hunk + the whole in-scope file
    expect(sealed.bundle.ring).toBe('callers');
  });

  it('widened evidence is citable: a citation into granted context passes INV-004 checking', async () => {
    const source = nexusChangeSource(ix, fileMap, BASE);
    const sealed = unwrap(
      await assembleEvidence(
        { assertion: CORE_SCOPE_VIEW, charter: '', change: source, ref: REF, ring: 'file' },
        sealEvidence,
      ),
    );
    const intoContext = unwrap(parseCitation('src/core/lib.ts:5-7'));
    expect(citationsWithinBundle(sealed, [intoContext])).toBe(true);
  });

  it('the deterministic judge rules the widened bundle and cites only the diff', async () => {
    // A breach diff plus a pre-existing (context) forge import: the judge must cite the
    // ADDED line and must NOT manufacture an offence from granted context (rule 1).
    const dirty = [
      "import { Octokit } from '@octokit/rest';",
      'export function target(n: number): number {',
      '  return n + 1;',
      '}',
    ].join('\n');
    const dirtyFiles = new Map([['src/core/lib.ts', dirty]]);
    const dirtyIx = indexNexus(
      buildNexus([{ path: path('src/core/lib.ts'), content: dirty }]),
    );
    const breachDiff = parseUnifiedDiff(
      [
        'diff --git a/src/core/lib.ts b/src/core/lib.ts',
        '--- a/src/core/lib.ts',
        '+++ b/src/core/lib.ts',
        '@@ -3,1 +3,2 @@',
        '   return n + 1;',
        "+  void import('probot');",
        '',
      ].join('\n'),
    );
    const source = nexusChangeSource(dirtyIx, dirtyFiles, breachDiff);
    const sealed = unwrap(
      await assembleEvidence(
        { assertion: CORE_SCOPE_VIEW, charter: '', change: source, ref: REF, ring: 'file' },
        sealEvidence,
      ),
    );
    const verdict = judgeImportBoundary(sealed);
    expect(verdict.verdict).toBe('drift');
    if (verdict.verdict === 'drift') {
      // One offence: the dynamic probot import this diff INTRODUCED. The @octokit line rode
      // along as context in the whole-file hunk and grounds nothing.
      expect(verdict.evidence.map((c) => c.source)).toEqual(['src/core/lib.ts:4']);
    }
  });
});
