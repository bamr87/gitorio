// Implements tests for: docs/adr/0003-judge-blindness.md ("verdict and sentencing are separate
// branches"; "any code path leaking author or accumulator data to a judge is a framework bug of
// the highest class"), docs/spec/03-judge.md §2 (the two blindness rules) and
// .program/invariants.yaml INV-003 — which, since PR #1, carries `status: ratified` and is
// therefore ENFORCED law rather than an aspiration (spec 01 §4.2).
//
// WHY THIS TEST EXISTS ALONGSIDE `Blind<T>` AND `scripts/check-inv003.ts`.
//
// The three defences answer three different questions, and only the third is asked here:
//
//   `Blind<T>`               — "can a sentencing VALUE sit in an evidence bundle?"   (types)
//   check-inv003             — "does a blind FILE name a declassifier?"              (one file)
//   this file                — "can a blind file REACH the sentencing branch AT ALL, through
//                              any chain of value imports, however long?"            (the graph)
//
// The second is a per-file textual rule; it would pass a judge that imports an innocuous-looking
// local helper which itself imports `../core/sentencing.js`. Nothing in the current tree does
// that, because src/judge and src/evidence are still one-line type re-export skeletons — which
// is precisely why the check must be written NOW, while it is cheap, and written DATA-DRIVEN
// over the real file tree, so it keeps holding as SEED-03 lands actual judges under those paths.
//
// EVERYTHING HERE IS STATIC INSPECTION. Nothing is imported for its side effects, nothing is
// executed. The suite reads source text off disk and computes over it, exactly as a reviewer
// with `grep` would, because a runtime probe cannot prove the absence of a path it did not take.
//
// THREE ANTI-VACUITY GUARDS, because a reachability test over an empty graph passes for the
// wrong reason and would keep passing forever:
//   1. the blind directories must exist and contain files;
//   2. the traversal must be shown to find a real multi-hop edge (positive control);
//   3. the sentencing-side set must be non-empty and must contain the two modules SEED-02
//      deliberately put on the sighted side.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  BLIND_DIRS,
  SENTENCING_MODULES,
  findInv003Violations,
  isBlindFile,
  isSentencingModule,
  normalizeSpecifier,
  parseImports,
  type SourceFile,
} from '../../scripts/check-inv003.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// The tree, read once
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

/** Every TypeScript file under `src/`, keyed by repo-relative POSIX path. */
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

const SOURCE_FILES: readonly SourceFile[] = FILES.map((path) => ({
  path,
  text: SOURCES.get(path) as string,
}));

// ---------------------------------------------------------------------------
// The import graph
// ---------------------------------------------------------------------------

/**
 * Resolves a NodeNext specifier to a repo-relative source path. Only RELATIVE specifiers can
 * name a file in this tree; a bare specifier is a package (`node:fs`, `ajv`, `yaml`) and cannot
 * be the sentencing branch, so it resolves to `null` and contributes no edge.
 *
 * The `.js` -> `.ts` rewrite is the whole trick of NodeNext: the emitted specifier names the
 * OUTPUT file, and the file that actually holds the code is its `.ts` sibling.
 */
export function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = normalizeSpecifier(join(dirname(fromFile), specifier).split(sep).join('/'));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (SOURCES.has(candidate)) return candidate;
  }
  return null;
}

export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly line: number;
  /** `import type` / `export type`: erased by `verbatimModuleSyntax`, so it links nothing. */
  readonly typeOnly: boolean;
  readonly source: string;
}

/**
 * One edge per import statement, using the SAME reader `scripts/check-inv003.ts` uses. Sharing
 * the lexer is deliberate: two import readers would drift, and the day they disagreed the
 * prescreen and this test would each be proving something about a different graph.
 */
const EDGES: readonly Edge[] = FILES.flatMap((from) =>
  parseImports(SOURCES.get(from) as string).flatMap((imp) => {
    const to = resolveSpecifier(from, imp.specifier);
    return to === null
      ? []
      : [{ from, to, line: imp.line, typeOnly: imp.typeOnly, source: imp.source }];
  }),
);

/**
 * Value edges only. A per-specifier `type` modifier inside an otherwise-value import
 * (`import { type A, b } from './x.js'`) still leaves a runtime import of the module, so the
 * only edge dropped is a whole-clause `import type` — which is erased entirely. Conservative in
 * the safe direction: this graph has MORE edges than the runtime one, never fewer.
 */
function successors(all: readonly Edge[], from: string): readonly string[] {
  return all.filter((e) => e.from === from && !e.typeOnly).map((e) => e.to);
}

/** Transitive closure over value edges, excluding the root. */
function valueClosure(roots: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const to of successors(EDGES, next)) {
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Who is blind, and who is sentencing-side — both DERIVED, never listed
// ---------------------------------------------------------------------------

const BLIND_FILES: readonly string[] = FILES.filter((f) => isBlindFile(f));

const SENTENCING_CORE: readonly string[] = FILES.filter((f) =>
  SENTENCING_MODULES.some((m) => normalizeSpecifier(f) === `src/${m}` || normalizeSpecifier(f).endsWith(`/${m}`)),
);

/**
 * THE SET THIS FILE IS REALLY ABOUT. A ledger module is sentencing-side if its own value-import
 * closure reaches `src/core/{sentencing,accumulator,dispersion}.ts` — computed, never enumerated.
 *
 * Deriving it means SEED-03 (and SEED-04) get the same protection for free: any new file that
 * starts reading identity or the meter joins this set on its first commit, and every assertion
 * below immediately covers it. A hard-coded list would have had to be remembered.
 */
const SENTENCING_SIDE_LEDGER: readonly string[] = FILES.filter(
  (f) =>
    f.startsWith('src/ledger/') &&
    [...valueClosure([f])].some((r) => (SENTENCING_CORE as readonly string[]).includes(r)),
);

/**
 * Does `file` value-import `name` from the sentencing branch? Read off the import clause rather
 * than off the file text, so a module that merely DISCUSSES a declassifier in a comment — which
 * this repository does constantly, because it documents its own boundary — is not mistaken for
 * one that holds it.
 */
function valueImportsFromSentencing(file: string, names: readonly string[]): boolean {
  return parseImports(SOURCES.get(file) as string).some(
    (imp) =>
      isSentencingModule(imp.specifier) &&
      imp.named.some((b) => !b.typeOnly && names.includes(b.name)),
  );
}

/**
 * The narrowest and sharpest derived set: ledger modules that hold the IDENTITY door — the ones
 * that can turn a git handle into an `ActorId` or an `ActorId` back into a string. ADR-0003's
 * clause 1 is about exactly these, and a new one appearing is the event worth noticing.
 */
const IDENTITY_READERS: readonly string[] = FILES.filter(
  (f) =>
    f.startsWith('src/ledger/') &&
    valueImportsFromSentencing(f, ['actorId', 'revealActor', 'actorGroupKey']),
);

/** Ledger modules that can MINT a warrant, i.e. that can start a declassification of their own. */
const WARRANT_MINTERS: readonly string[] = FILES.filter(
  (f) => f.startsWith('src/ledger/') && valueImportsFromSentencing(f, ['withSentencingWarrant']),
);

// ---------------------------------------------------------------------------

describe('the tree this suite is reasoning about', () => {
  it('found source files, blind files and the sentencing branch — none of it vacuous', () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(BLIND_FILES.length).toBeGreaterThan(0);
    expect(SENTENCING_CORE.length).toBe(SENTENCING_MODULES.length);
    expect([...SENTENCING_CORE].sort()).toEqual([
      'src/core/accumulator.ts',
      'src/core/dispersion.ts',
      'src/core/sentencing.ts',
    ]);
  });

  it('derives the blind directories from the ratified INV-003, not from a constant in a test', () => {
    // Q-38's rule: assert the RELATION between artifacts, never the current value of a field. The
    // relation here is that the deterministic prescreen's scope must be the scope the constitution
    // actually gives INV-003. Amending one and forgetting the other is exactly what should fail.
    const invariants = parseYaml(
      readFileSync(join(REPO_ROOT, '.program', 'invariants.yaml'), 'utf8'),
    ) as readonly { id: string; scope: readonly string[] }[];
    const inv003 = invariants.find((a) => a.id === 'INV-003');
    expect(inv003, 'INV-003 has left the constitution; this suite has no subject').toBeDefined();

    // `src/judge/**` names the directory `src/judge/`. Only the `dir/**` shape is expected here,
    // and anything else fails loudly rather than being silently skipped.
    const dirs = (inv003?.scope ?? []).map((glob) => {
      expect(glob, 'INV-003 scope entry is not a directory glob').toMatch(/^[\w./-]+\/\*\*$/);
      return `${glob.slice(0, -2)}`;
    });
    expect([...dirs].sort()).toEqual([...BLIND_DIRS].sort());
  });

  it('found real files under every blind directory — a scan of nothing has not passed', () => {
    for (const dir of BLIND_DIRS) {
      expect(
        BLIND_FILES.filter((f) => f.startsWith(dir)).length,
        `no source files under ${dir}`,
      ).toBeGreaterThan(0);
    }
  });

  it('POSITIVE CONTROL: the traversal finds a real multi-hop value edge', () => {
    // Without this, every "is not reachable" assertion below could be passing because the graph
    // is empty. src/ledger/firing.ts -> src/ledger/fold.ts is not an edge; firing.ts reaches the
    // sentencing branch directly, and fold.ts reaches it too. Assert BOTH a direct edge and a
    // two-hop path through the core barrel, so depth is proven, not assumed.
    expect(valueClosure(['src/ledger/firing.ts'])).toContain('src/core/sentencing.ts');
    expect(valueClosure(['src/ledger/firing.ts'])).toContain('src/core/dispersion.ts');
    // Two hops: firing.ts -> core/index.ts -> core/event.ts. index.ts is a value re-export.
    expect(successors(EDGES, 'src/ledger/firing.ts')).toContain('src/core/index.ts');
    expect(successors(EDGES, 'src/ledger/firing.ts')).not.toContain('src/core/event.ts');
    expect(valueClosure(['src/ledger/firing.ts'])).toContain('src/core/event.ts');
  });

  it('POSITIVE CONTROL: the sentencing-side ledger set is non-empty and holds the sighted modules', () => {
    expect(SENTENCING_SIDE_LEDGER).toContain('src/ledger/sighted.ts');
    expect(SENTENCING_SIDE_LEDGER).toContain('src/ledger/firing.ts');
  });
});

describe('INV-003: no blind file value-imports the sentencing branch', () => {
  it('holds directly, over every file under every blind directory', () => {
    const offences = EDGES.filter(
      (e) => isBlindFile(e.from) && !e.typeOnly && (SENTENCING_CORE as readonly string[]).includes(e.to),
    );
    expect(
      offences.map((e) => `${e.from}:${e.line}  ${e.source}`),
      'a blind module value-imports the sentencing branch (ADR-0003: a framework bug of the highest class)',
    ).toEqual([]);
  });

  it('holds by SPECIFIER too, so a path this resolver could not follow is still caught', () => {
    for (const file of BLIND_FILES) {
      for (const imp of parseImports(SOURCES.get(file) as string)) {
        if (!isSentencingModule(imp.specifier)) continue;
        expect(imp.typeOnly, `${file}:${imp.line} value-imports ${imp.specifier}`).toBe(true);
      }
    }
  });

  it('holds TRANSITIVELY: nothing a blind file can reach at runtime is sentencing-side', () => {
    for (const file of BLIND_FILES) {
      const reach = valueClosure([file]);
      for (const module of SENTENCING_CORE) {
        expect(reach.has(module), `${file} reaches ${module} through a chain of value imports`).toBe(
          false,
        );
      }
    }
  });

  it('agrees with the deterministic prescreen over the real tree', () => {
    // One assertion, two mechanisms: if this suite's graph and check-inv003's text rules ever
    // disagreed, one of them would be lying about the same repository.
    expect(findInv003Violations(SOURCE_FILES)).toEqual([]);
  });
});

describe("INV-003: src/ledger's sighted modules are unreachable from the verdict branch", () => {
  it('no blind file value-imports any sentencing-side ledger module, at any depth', () => {
    for (const file of BLIND_FILES) {
      const reach = valueClosure([file]);
      for (const module of SENTENCING_SIDE_LEDGER) {
        expect(
          reach.has(module),
          `${file} reaches ${module}, which resolves git authorship and holds the meter`,
        ).toBe(false);
      }
    }
  });

  it('no blind file mentions them at all — not even as an erased type import', () => {
    // Stricter than the runtime rule on purpose. A type-only import declassifies nothing, so this
    // is not a correctness requirement; it is a DESIGN one. `src/ledger/sighted.ts` is the only
    // producer of `ActorId` in the engine and `src/ledger/firing.ts` mints the only sentencing
    // warrant in it. A judge that has started naming their types is a judge whose evidence bundle
    // is about to grow a slot for what they hold, and the moment to notice that is the import.
    for (const file of BLIND_FILES) {
      for (const imp of parseImports(SOURCES.get(file) as string)) {
        const target = resolveSpecifier(file, imp.specifier);
        if (target === null) continue;
        expect(
          (SENTENCING_SIDE_LEDGER as readonly string[]).includes(target),
          `${file}:${imp.line} imports ${target} — sentencing-side, even as a type`,
        ).toBe(false);
      }
    }
  });

  it('no blind file imports anything under src/ledger/ as a value', () => {
    // The whole ledger is the accumulator's home. A judge needs an assertion and some hunks
    // (spec 03 §3); it has no business holding an EventStore, a fold, or a cache either.
    const offences = EDGES.filter(
      (e) => isBlindFile(e.from) && !e.typeOnly && e.to.startsWith('src/ledger/'),
    );
    expect(offences.map((e) => `${e.from}:${e.line}  ${e.source}`)).toEqual([]);
  });
});

describe('the sighted side is where the spec says it is', () => {
  it('src/ledger is NOT a blind directory — it is the one module allowed to read authorship', () => {
    // ADR-0003: "authorship is used only downstream, in dispersion statistics at firing time".
    // If src/ledger ever became blind, the firing detector could not compute dispersion at all
    // and the refactor/reprogram hinge would silently stop working.
    expect(BLIND_DIRS.some((d) => 'src/ledger/'.startsWith(d))).toBe(false);
    expect(isBlindFile('src/ledger/sighted.ts')).toBe(false);
    expect(isBlindFile('src/ledger/firing.ts')).toBe(false);
  });

  it('every module holding the IDENTITY door declares itself in a header a grep will find', () => {
    expect(IDENTITY_READERS, 'nothing in src/ledger can resolve an author — dispersion is dead')
      .toContain('src/ledger/sighted.ts');
    for (const file of IDENTITY_READERS) {
      const header = (SOURCES.get(file) as string).slice(0, 4000);
      expect(header, `${file} reads author identity without declaring it`).toMatch(
        /SENTENCING-SIDE MODULE/,
      );
      // The header must name the directories that may not import it, so the rule and the file it
      // governs are one grep apart.
      expect(header).toMatch(/src\/judge/);
      expect(header).toMatch(/src\/evidence/);
    }
  });

  it('exactly two ledger modules may mint a warrant, and both are accounted for', () => {
    // ADR-0003 is auditable only if the audit is FINITE. Every unwrap of identity or the meter is
    // a call carrying a warrant, and `withSentencingWarrant` is the only issuer — so the set of
    // modules that value-import it is the set of doors. Read off the import graph rather than out
    // of the file text, because this repository documents its own boundary in prose everywhere.
    //   firing.ts — `atFiringTime`, the moment ADR-0003 permits (dispersion, rendering).
    //   fold.ts   — `rawSurprise` for `ContributingEvent.rawWeight`, which src/core types as a
    //               plain number; the warrant never leaves the walk.
    expect([...WARRANT_MINTERS].sort()).toEqual(['src/ledger/firing.ts', 'src/ledger/fold.ts']);
    for (const file of WARRANT_MINTERS) {
      expect(SENTENCING_SIDE_LEDGER).toContain(file);
    }
  });

  it('the ledger never persists an identity: no sentencing-side module writes an author field', () => {
    // The storage-level expression of ADR-0003 (src/core/event.ts: "the persisted ledger is
    // identity-free"). A `author:`/`committer:` key appearing in a serializer under src/ledger
    // would put a handle on disk, where no warrant guards it and every later reader is untainted.
    for (const file of SENTENCING_SIDE_LEDGER) {
      const text = SOURCES.get(file) as string;
      // Object-literal keys only; a TYPE annotation (`author: ActorId`) is the sighted port's
      // own shape and is fine, as is any mention in a comment.
      const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(
        /^\s*(author|committer|author_email|committer_email)\s*:\s*['"`]/m.test(withoutComments),
        `${file} appears to serialize an identity into a string field`,
      ).toBe(false);
    }
  });
});

describe('the check keeps working as SEED-03 lands', () => {
  it('is driven by the file tree, so a new judge is covered without editing this file', () => {
    // The guarantee, stated as an assertion rather than as a comment: every file discovered under
    // a blind directory participates in every reachability check above, and the set is recomputed
    // from disk on each run. A file added under src/judge/ tomorrow is in BLIND_FILES tomorrow.
    for (const file of FILES) {
      expect(BLIND_FILES.includes(file)).toBe(isBlindFile(file));
    }
    expect(BLIND_FILES.every((f) => BLIND_DIRS.some((d) => f.startsWith(d)))).toBe(true);
  });

  it('would FAIL on a judge that reaches the sentencing branch through an innocuous helper', () => {
    // The negative control the real tree cannot supply, run against a SYNTHETIC graph with the
    // same traversal. Without it, "holds transitively" is an untested code path.
    const synthetic: readonly Edge[] = [
      { from: 'src/judge/panel.ts', to: 'src/judge/util.ts', line: 3, typeOnly: false, source: '' },
      { from: 'src/judge/util.ts', to: 'src/ledger/sighted.ts', line: 1, typeOnly: false, source: '' },
      { from: 'src/ledger/sighted.ts', to: 'src/core/sentencing.ts', line: 9, typeOnly: false, source: '' },
    ];
    const walk = (roots: readonly string[]): ReadonlySet<string> => {
      const seen = new Set<string>();
      const queue = [...roots];
      while (queue.length > 0) {
        const next = queue.shift() as string;
        for (const to of successors(synthetic, next)) {
          if (seen.has(to)) continue;
          seen.add(to);
          queue.push(to);
        }
      }
      return seen;
    };
    expect(walk(['src/judge/panel.ts'])).toContain('src/core/sentencing.ts');
    expect(walk(['src/judge/panel.ts'])).toContain('src/ledger/sighted.ts');

    // …and would PASS the same helper reached only through an erased type import.
    const erased = synthetic.map((e, i) => (i === 1 ? { ...e, typeOnly: true } : e));
    const walkErased = (roots: readonly string[]): ReadonlySet<string> => {
      const seen = new Set<string>();
      const queue = [...roots];
      while (queue.length > 0) {
        const next = queue.shift() as string;
        for (const to of successors(erased, next)) {
          if (seen.has(to)) continue;
          seen.add(to);
          queue.push(to);
        }
      }
      return seen;
    };
    expect(walkErased(['src/judge/panel.ts'])).not.toContain('src/core/sentencing.ts');
  });

  it('terminates on an import cycle rather than hanging the suite', () => {
    const cyclic: readonly Edge[] = [
      { from: 'a.ts', to: 'b.ts', line: 1, typeOnly: false, source: '' },
      { from: 'b.ts', to: 'a.ts', line: 1, typeOnly: false, source: '' },
    ];
    const seen = new Set<string>();
    const queue = ['a.ts'];
    while (queue.length > 0) {
      const next = queue.shift() as string;
      for (const to of successors(cyclic, next)) {
        if (seen.has(to)) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    expect([...seen].sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('resolves NodeNext specifiers, directory indexes and bare packages correctly', () => {
    expect(resolveSpecifier('src/ledger/firing.ts', '../core/sentencing.js')).toBe(
      'src/core/sentencing.ts',
    );
    expect(resolveSpecifier('src/ledger/firing.ts', '../core/index.js')).toBe('src/core/index.ts');
    expect(resolveSpecifier('src/judge/index.ts', '../core/index.js')).toBe('src/core/index.ts');
    expect(resolveSpecifier('src/ledger/firing.ts', 'node:crypto')).toBeNull();
    expect(resolveSpecifier('src/ledger/firing.ts', 'yaml')).toBeNull();
    expect(resolveSpecifier('src/ledger/firing.ts', '../core/nonesuch.js')).toBeNull();
  });
});
