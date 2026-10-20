// Implements tests for: docs/spec/05-nexus.md §3 (construction and the determinism
// requirements) and §1.4 ("deterministic, or it is a defect") — the fold-purity obligation
// applied to perception, held the way tests/ledger/fold.test.ts holds it for the fold:
// property-tested over permutations, plus a GOLDEN HASH pinning extractor behavior to the
// declared extractor version (spec 05 §1.5).

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { unwrap } from '../../src/core/result.js';
import type { RepoPath } from '../../src/core/paths.js';
import {
  type FileSnapshot,
  NEXUS_EXTRACTOR_VERSION,
  buildNexus,
  resolveImport,
} from '../../src/nexus/build.js';
import { encodeNexusDocument, nexusHash, sealNexusDocument } from '../../src/nexus/serialize.js';

const path = (p: string): RepoPath => p as RepoPath;

// ---------------------------------------------------------------------------
// A small fixed tree, exercised by most cases below
// ---------------------------------------------------------------------------

const FIXTURE: readonly FileSnapshot[] = [
  {
    path: path('src/core/math.ts'),
    content: [
      'export function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
      'export function twice(n: number): number {',
      '  return add(n, n);',
      '}',
      'export default add;',
    ].join('\n'),
  },
  {
    path: path('src/app/main.ts'),
    content: [
      "import { twice } from '../core/math.js';",
      "import * as m from '../core/math.js';",
      "import missing from './nonesuch.js';",
      "import { parse } from 'yaml';",
      'export function run(): number {',
      '  parse(\'x\');',
      '  missing();',
      '  return twice(m.add(1, 2));',
      '}',
    ].join('\n'),
  },
  { path: path('README.md'), content: '# fixture\n' },
];

describe('buildNexus over the fixture tree', () => {
  const graph = buildNexus(FIXTURE);
  const ids = graph.nodes.map((n) => n.id);

  it('P1: every file is a module node; ancestors are directories with contains edges', () => {
    expect(ids).toContain('module:src/core/math.ts');
    expect(ids).toContain('module:src/app/main.ts');
    expect(ids).toContain('module:README.md');
    expect(ids).toContain('dir:src');
    expect(ids).toContain('dir:src/core');
    expect(
      graph.edges.some(
        (e) => e.kind === 'contains' && e.from === 'dir:src/core' && e.to === 'module:src/core/math.ts',
      ),
    ).toBe(true);
    expect(
      graph.edges.some((e) => e.kind === 'contains' && e.from === 'dir:src' && e.to === 'dir:src/core'),
    ).toBe(true);
  });

  it('unparsed files degrade to structure-only modules, never blocking the build (P1)', () => {
    const readme = graph.nodes.find((n) => n.id === 'module:README.md');
    expect(readme).toMatchObject({ kind: 'module', language: null, parsed: false });
    expect(graph.stats.files).toBe(3);
    expect(graph.stats.parsed).toBe(2);
  });

  it('P3: resolution distinguishes internal, external and unresolved — counted, never guessed', () => {
    expect(graph.stats.imports).toEqual({ internal: 2, external: 1, unresolved: 1 });
    const importsOfMain = graph.edges.filter(
      (e) => e.kind === 'imports' && e.from === 'module:src/app/main.ts',
    );
    expect(importsOfMain.map((e) => e.to).sort()).toEqual([
      'ext:./nonesuch.js',
      'ext:yaml',
      'module:src/core/math.ts',
      'module:src/core/math.ts',
    ]);
  });

  it('P4: calls resolve same-file, through named imports, namespaces, and to externals', () => {
    const calls = graph.edges.filter((e) => e.kind === 'calls');
    const twiceToAdd = calls.find(
      (e) => e.from.startsWith('def:src/core/math.ts#twice') && e.to.startsWith('def:src/core/math.ts#add'),
    );
    expect(twiceToAdd).toMatchObject({ resolution: 'same-file' });

    const runCalls = calls.filter((e) => e.from.startsWith('def:src/app/main.ts#run'));
    const targets = runCalls.map((e) => e.to).sort();
    expect(targets).toContain('def:src/core/math.ts#twice@4'); // named import
    expect(targets).toContain('def:src/core/math.ts#add@1'); // namespace-qualified
    expect(targets).toContain('ext:yaml'); // external binding
    expect(targets).toContain('ext:./nonesuch.js'); // unresolved specifier, still a proved binding
    expect(graph.stats.calls.resolved).toBeLessThanOrEqual(graph.stats.calls.sites);
  });

  it('spans are citable: every definition node carries a 1-based inclusive span', () => {
    for (const n of graph.nodes) {
      if (n.kind !== 'definition') continue;
      expect(n.span.start).toBeGreaterThanOrEqual(1);
      expect(n.span.end).toBeGreaterThanOrEqual(n.span.start);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveImport (spec 05 §3 P3)
// ---------------------------------------------------------------------------

describe('resolveImport', () => {
  const paths = new Set(['src/a.ts', 'src/lib/index.ts', 'src/b/c.tsx', 'top.ts']);

  it('resolves NodeNext .js emissions to their .ts sources, indexes, and exact paths', () => {
    expect(resolveImport('src/a.ts', './lib/index.js', paths)).toBe('src/lib/index.ts');
    expect(resolveImport('src/a.ts', './lib', paths)).toBe('src/lib/index.ts');
    expect(resolveImport('src/b/c.tsx', '../a.js', paths)).toBe('src/a.ts');
    expect(resolveImport('src/a.ts', '../top.js', paths)).toBe('top.ts');
    expect(resolveImport('src/a.ts', './missing.js', paths)).toBeNull();
    expect(resolveImport('src/a.ts', 'node:fs', paths)).toBeNull();
    expect(resolveImport('src/a.ts', '../../escape.ts', paths)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Determinism (spec 05 §1.4) — the property, then the golden seat
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same snapshot in ANY order => byte-identical artifact and identical hash', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.nat(FIXTURE.length - 1), { minLength: FIXTURE.length, maxLength: FIXTURE.length })
          .filter((xs) => new Set(xs).size === xs.length),
        (perm) => {
          const shuffled = perm.map((i) => FIXTURE[i] as FileSnapshot);
          const a = unwrap(sealNexusDocument(buildNexus(FIXTURE)));
          const b = unwrap(sealNexusDocument(buildNexus(shuffled)));
          expect(b.nexus).toBe(a.nexus);
          expect(encodeNexusDocument(b)).toBe(encodeNexusDocument(a));
        },
      ),
      { numRuns: 24 },
    );
  });

  it('a duplicated path is first-occurrence-wins, deterministically', () => {
    const dup: FileSnapshot = { path: path('src/core/math.ts'), content: 'export const other = 1;' };
    const a = unwrap(nexusHash(buildNexus(FIXTURE)));
    const b = unwrap(nexusHash(buildNexus([...FIXTURE, dup])));
    expect(b).toBe(a);
  });

  /**
   * THE GOLDEN SEAT (spec 05 §1.5). This hash is the fixture tree perceived by extractor
   * 0.1.0. If extraction behavior changes — a new pattern, a fixed span rule, a widened
   * resolution — this hash changes, and the ONLY legitimate way to update this test is to
   * bump NEXUS_EXTRACTOR_VERSION in src/nexus/build.ts in the same diff. Changed behavior
   * under an unchanged version is a re-perceived world under an old seat: the exact defect
   * this line exists to make loud.
   */
  it('golden: the fixture tree under extractor 0.1.0', () => {
    expect(NEXUS_EXTRACTOR_VERSION).toBe('0.1.0');
    expect(unwrap(nexusHash(buildNexus(FIXTURE)))).toBe(
      'sha256:7f09ae50e3cc3e522656550d9fbeca643383788c2da4fc7877f1f5f43d77b08f',
    );
  });
});
