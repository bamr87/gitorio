// Implements tests for: docs/spec/05-nexus.md §7 (rung-0 and negative space) and the
// self-hosting obligation (TRJ-003, CLAUDE.md): the framework's own perception proving the
// framework's own law, on the real tree, exhaustively.
//
// Spec 04 §2: "the strongest laws live in negative space — no third-party import EVER
// crossing into core/ … absence is exactly what a deterministic pass can prove exhaustively."
// The diff-reading judge can only catch a breach being INTRODUCED; these assertions certify
// the absence itself, on every CI run, with citable nodes behind every claim.
//
// Q-38's rule is honored: each test asserts a RELATION the constitution states (INV-005's
// statement, the dependency-free convention), never a count or a snapshot of today's tree.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { PathGlob } from '../../src/core/paths.js';
import { forgeModuleOf } from '../../src/judge/deterministic/imports.js';
import { buildNexus } from '../../src/nexus/build.js';
import { importsMatching, indexNexus } from '../../src/nexus/query.js';
import { collectTreeSnapshot } from '../../src/nexus/store.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const glob = (g: string): PathGlob => g as PathGlob;

// One perception of the real tree, shared by every case (build is pure; the walk is the cost).
const ix = indexNexus(buildNexus(collectTreeSnapshot(REPO_ROOT)));

describe('INV-005 as negative space, certified on the whole tree (spec 05 §7)', () => {
  it('perceived a real engine, not an empty directory', () => {
    // Anti-vacuity: an empty graph would pass every emptiness assertion below for the wrong
    // reason. The engine core exists and has imports.
    expect(ix.moduleByPath.has('src/core/paths.ts')).toBe(true);
    expect(ix.graph.stats.imports.internal).toBeGreaterThan(50);
  });

  it('no module under src/core/** imports anything under src/adapters/**', () => {
    const crossings = importsMatching(
      ix,
      [glob('src/core/**')],
      (target) => target !== null && target.kind === 'module' && target.path.startsWith('src/adapters/'),
    );
    expect(
      crossings.map((c) => `${c.from.path}:${c.answer.edge.at} -> ${c.answer.edge.specifier}`),
      'INV-005: GitHub access lives in adapters/; the arrow points inward only',
    ).toEqual([]);
  });

  it('no module under src/core/** imports a forge API, under the SAME pattern law the judge applies', () => {
    // The import-boundary judge's FORGE_MODULE_PATTERNS is the ratified operational meaning
    // of "forge-specific" (Q-58). Using it here keeps one law with two enforcement surfaces:
    // the judge on diffs, the nexus on the whole tree. Type-only edges are excluded per
    // Q-64's shipped reading (a type-only import does not refute a negative-space boundary);
    // the graph still RECORDS them, so the stricter reading stays recoverable.
    const crossings = importsMatching(
      ix,
      [glob('src/core/**')],
      (_target, edge) => edge.form !== 'type-only' && forgeModuleOf(edge.specifier) !== null,
    );
    expect(crossings.map((c) => `${c.from.path}:${c.answer.edge.at} ${c.answer.edge.specifier}`)).toEqual([]);
  });

  it('src/core is dependency-free: its only external imports are node builtins', () => {
    // CONTRIBUTING.md's house rule ("src/core is also dependency-free by convention"),
    // provable exhaustively only from a whole-tree view — the exact capability spec 05 §7
    // exists for.
    const nonBuiltin = importsMatching(
      ix,
      [glob('src/core/**')],
      (target, edge) =>
        target !== null &&
        target.kind === 'external' &&
        !edge.specifier.startsWith('node:') &&
        !edge.specifier.startsWith('.'),
    );
    expect(nonBuiltin.map((c) => `${c.from.path}:${c.answer.edge.at} ${c.answer.edge.specifier}`)).toEqual([]);
  });

  it('every relative import in src/** resolves inside the tree — no dangling seams', () => {
    const dangling = importsMatching(
      ix,
      [glob('src/**')],
      (target, edge) => edge.specifier.startsWith('.') && (target === null || target.kind === 'external'),
    );
    expect(dangling.map((c) => `${c.from.path}:${c.answer.edge.at} ${c.answer.edge.specifier}`)).toEqual([]);
  });
});
