// Implements tests for: docs/spec/05-nexus.md §1.1 — the nexus is blind BY CONSTRUCTION, and
// src/nexus/** holds the same import boundary INV-003 imposes on src/judge/** and
// src/evidence/**, so the proposed amendment adding it to INV-003's scope
// (proposals/PROPOSED-nexus-amendment.md) is a ratification of standing fact, not a
// remediation. Until that amendment lands, THIS SUITE is the boundary's enforcement — the
// same data-driven closure walk tests/ledger/blindness-boundary.test.ts runs for the judges,
// using the same shared import reader so the two suites reason about the same graph.
//
// EVERYTHING HERE IS STATIC INSPECTION, plus the same anti-vacuity posture: the directory
// must exist, the traversal must find real edges, and a positive control proves the walk can
// see multi-hop reachability at all.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { normalizeSpecifier, parseImports } from '../../scripts/check-inv003.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

function collectSources(root: string, dir: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs).sort()) {
      if (SKIP_DIRS.has(entry)) continue;
      const child = join(abs, entry);
      if (statSync(child).isDirectory()) {
        walk(child);
        continue;
      }
      if (!/\.(m|c)?tsx?$/.test(entry)) continue;
      out.set(relative(root, child).split(sep).join('/'), readFileSync(child, 'utf8'));
    }
  };
  walk(resolve(root, dir));
  return out;
}

const SOURCES = collectSources(REPO_ROOT, 'src');
const FILES: readonly string[] = [...SOURCES.keys()];

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = normalizeSpecifier(join(dirname(fromFile), specifier).split(sep).join('/'));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (SOURCES.has(candidate)) return candidate;
  }
  return null;
}

interface Edge {
  readonly from: string;
  readonly to: string;
  readonly line: number;
  readonly typeOnly: boolean;
}

const EDGES: readonly Edge[] = FILES.flatMap((from) =>
  parseImports(SOURCES.get(from) as string).flatMap((imp) => {
    const to = resolveSpecifier(from, imp.specifier);
    return to === null ? [] : [{ from, to, line: imp.line, typeOnly: imp.typeOnly }];
  }),
);

function valueClosure(roots: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const e of EDGES) {
      if (e.from !== next || e.typeOnly || seen.has(e.to)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return seen;
}

const NEXUS_FILES: readonly string[] = FILES.filter((f) => f.startsWith('src/nexus/'));
const SENTENCING_CORE = ['src/core/sentencing.ts', 'src/core/accumulator.ts', 'src/core/dispersion.ts'];

describe('the tree this suite is reasoning about', () => {
  it('found nexus files and real edges — nothing vacuous', () => {
    expect(NEXUS_FILES.length).toBeGreaterThan(5);
    expect(EDGES.filter((e) => e.from.startsWith('src/nexus/')).length).toBeGreaterThan(5);
  });

  it('POSITIVE CONTROL: the walk sees multi-hop reachability', () => {
    // src/nexus/store.ts -> src/nexus/serialize.ts -> src/core/canonical.ts is two hops.
    const reach = valueClosure(['src/nexus/store.ts']);
    expect(reach).toContain('src/nexus/serialize.ts');
    expect(reach).toContain('src/core/canonical.ts');
  });
});

describe('spec 05 §1.1: the perception layer cannot reach the sentencing branch', () => {
  it('no nexus file value-imports core/{sentencing,accumulator,dispersion}, at any depth', () => {
    for (const file of NEXUS_FILES) {
      const reach = valueClosure([file]);
      for (const module of SENTENCING_CORE) {
        expect(reach.has(module), `${file} reaches ${module} through value imports`).toBe(false);
      }
    }
  });

  it('no nexus file imports src/ledger at all — not even as an erased type', () => {
    // Stricter than the runtime rule, for the same reason the judges hold it: src/ledger is
    // where authorship is resolved, and perception naming its types is the moment to notice.
    for (const file of NEXUS_FILES) {
      for (const imp of parseImports(SOURCES.get(file) as string)) {
        expect(
          normalizeSpecifier(imp.specifier).split('/').includes('ledger'),
          `${file}:${imp.line} imports ${imp.specifier}`,
        ).toBe(false);
      }
    }
  });

  it('no nexus file value-imports the core barrel (it re-exports accumulator arithmetic)', () => {
    // Deep imports only, exactly as the deterministic judges do and for the same reason: the
    // barrel value-re-exports accumulator.ts, whose closure reaches sentencing.ts. An erased
    // `import type` of the barrel would be harmless, but no nexus module needs even that.
    for (const file of NEXUS_FILES) {
      for (const imp of parseImports(SOURCES.get(file) as string)) {
        const target = resolveSpecifier(file, imp.specifier);
        expect(
          target === 'src/core/index.ts' && !imp.typeOnly,
          `${file}:${imp.line} value-imports the core barrel`,
        ).toBe(false);
      }
    }
  });

  it('the one blindness-relevant CONSUMER direction also holds: src/evidence and src/judge do not import src/nexus', () => {
    // Composition happens in the CLI (a sighted, non-blind module): the nexus IMPLEMENTS the
    // ChangeSource port; the blind assembler consumes the port, never the package. If a blind
    // module ever imports src/nexus directly, INV-003's amendment must land FIRST — surface
    // that ordering here rather than in review archaeology.
    for (const file of FILES) {
      if (!file.startsWith('src/evidence/') && !file.startsWith('src/judge/')) continue;
      for (const imp of parseImports(SOURCES.get(file) as string)) {
        const target = resolveSpecifier(file, imp.specifier);
        expect(
          target !== null && target.startsWith('src/nexus/'),
          `${file}:${imp.line} imports ${String(target)} — ratify the INV-003 scope amendment first`,
        ).toBe(false);
      }
    }
  });
});
