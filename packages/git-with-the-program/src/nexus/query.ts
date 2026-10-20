// Implements: docs/spec/05-nexus.md §5 (enclosing definitions and callers, the ring
// primitives), §6 (seams: connected components of the internal import graph), and §7
// (whole-tree queries — the negative-space primitive). Pure functions over an in-memory
// index; nothing here reads a file, a ref, or a clock.

import type { PathGlob, RepoPath } from '../core/paths.js';
import { matchesScope } from '../core/paths.js';
import type {
  CallsEdge,
  DefinitionNode,
  ImportsEdge,
  ModuleNode,
  NexusEdge,
  NexusGraph,
  NexusNode,
  NexusNodeId,
} from './types.js';
import { moduleId } from './types.js';

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

export interface NexusIndex {
  readonly graph: NexusGraph;
  readonly byId: ReadonlyMap<string, NexusNode>;
  readonly moduleByPath: ReadonlyMap<string, ModuleNode>;
  /** Definitions per module path, sorted by (span.start, span size) — innermost lookup ground. */
  readonly defsByPath: ReadonlyMap<string, readonly DefinitionNode[]>;
  readonly edgesFrom: ReadonlyMap<string, readonly NexusEdge[]>;
  readonly edgesTo: ReadonlyMap<string, readonly NexusEdge[]>;
}

export function indexNexus(graph: NexusGraph): NexusIndex {
  const byId = new Map<string, NexusNode>();
  const moduleByPath = new Map<string, ModuleNode>();
  const defsByPath = new Map<string, DefinitionNode[]>();
  for (const n of graph.nodes) {
    byId.set(n.id, n);
    if (n.kind === 'module') moduleByPath.set(n.path, n);
    if (n.kind === 'definition') {
      const list = defsByPath.get(n.path) ?? [];
      list.push(n);
      defsByPath.set(n.path, list);
    }
  }
  for (const list of defsByPath.values()) {
    list.sort(
      (a, b) => a.span.start - b.span.start || a.span.end - b.span.end || (a.id < b.id ? -1 : 1),
    );
  }
  const edgesFrom = new Map<string, NexusEdge[]>();
  const edgesTo = new Map<string, NexusEdge[]>();
  for (const e of graph.edges) {
    const f = edgesFrom.get(e.from) ?? [];
    f.push(e);
    edgesFrom.set(e.from, f);
    const t = edgesTo.get(e.to) ?? [];
    t.push(e);
    edgesTo.set(e.to, t);
  }
  return { graph, byId, moduleByPath, defsByPath, edgesFrom, edgesTo };
}

// ---------------------------------------------------------------------------
// Ring primitives (spec 05 §5)
// ---------------------------------------------------------------------------

/** All definitions in `path`, in span order. */
export function definitionsIn(ix: NexusIndex, path: RepoPath): readonly DefinitionNode[] {
  return ix.defsByPath.get(path) ?? [];
}

/** The INNERMOST definition whose span contains `line`, or null (spec 05 §2). */
export function enclosingDefinition(
  ix: NexusIndex,
  path: RepoPath,
  line: number,
): DefinitionNode | null {
  let best: DefinitionNode | null = null;
  let bestSize = Number.POSITIVE_INFINITY;
  for (const d of ix.defsByPath.get(path) ?? []) {
    const size = d.span.end - d.span.start;
    if (d.span.start <= line && line <= d.span.end && size < bestSize) {
      best = d;
      bestSize = size;
    }
  }
  return best;
}

/** Definitions with a resolved `calls` edge INTO `def` — spec 03 §3's "nearest callers". */
export function callersOf(
  ix: NexusIndex,
  def: DefinitionNode,
): readonly { readonly definition: DefinitionNode; readonly edge: CallsEdge }[] {
  const out: { definition: DefinitionNode; edge: CallsEdge }[] = [];
  for (const e of ix.edgesTo.get(def.id) ?? []) {
    if (e.kind !== 'calls') continue;
    const from = ix.byId.get(e.from);
    if (from !== undefined && from.kind === 'definition') {
      out.push({ definition: from, edge: e });
    }
  }
  return out;
}

/** Nodes `def` has a resolved `calls` edge into (definitions and externals). */
export function calleesOf(
  ix: NexusIndex,
  def: DefinitionNode,
): readonly { readonly target: NexusNode; readonly edge: CallsEdge }[] {
  const out: { target: NexusNode; edge: CallsEdge }[] = [];
  for (const e of ix.edgesFrom.get(def.id) ?? []) {
    if (e.kind !== 'calls') continue;
    const target = ix.byId.get(e.to);
    if (target !== undefined) out.push({ target, edge: e });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Import queries (spec 05 §7 — the negative-space primitive)
// ---------------------------------------------------------------------------

export interface ImportAnswer {
  readonly edge: ImportsEdge;
  /** The resolved target: an in-tree module or an external node. */
  readonly target: NexusNode | null;
}

/** Outgoing `imports` edges of one module. */
export function importsOf(ix: NexusIndex, path: RepoPath): readonly ImportAnswer[] {
  const out: ImportAnswer[] = [];
  for (const e of ix.edgesFrom.get(moduleId(path)) ?? []) {
    if (e.kind !== 'imports') continue;
    out.push({ edge: e, target: ix.byId.get(e.to) ?? null });
  }
  return out;
}

/** Modules importing `path` — who depends on this seam. */
export function importersOf(
  ix: NexusIndex,
  path: RepoPath,
): readonly { readonly module: ModuleNode; readonly edge: ImportsEdge }[] {
  const out: { module: ModuleNode; edge: ImportsEdge }[] = [];
  for (const e of ix.edgesTo.get(moduleId(path)) ?? []) {
    if (e.kind !== 'imports') continue;
    const from = ix.byId.get(e.from);
    if (from !== undefined && from.kind === 'module') out.push({ module: from, edge: e });
  }
  return out;
}

/**
 * Every `imports` edge whose FROM module matches `fromScope` and whose target matches the
 * predicate — the whole-tree query shape of spec 05 §7. INV-005's negative-space proof is
 * exactly `importsMatching(ix, ['src/core/**'], target => target names a forge or adapters/)`
 * asserted EMPTY, node by node, citable line by line (tests/nexus/negative-space.test.ts).
 */
export function importsMatching(
  ix: NexusIndex,
  fromScope: readonly PathGlob[],
  matches: (target: NexusNode | null, edge: ImportsEdge) => boolean,
): readonly { readonly from: ModuleNode; readonly answer: ImportAnswer }[] {
  const out: { from: ModuleNode; answer: ImportAnswer }[] = [];
  for (const m of ix.moduleByPath.values()) {
    if (!matchesScope(fromScope, m.path)) continue;
    for (const answer of importsOf(ix, m.path)) {
      if (matches(answer.target, answer.edge)) out.push({ from: m, answer });
    }
  }
  return out.sort(
    (a, b) =>
      (a.from.path < b.from.path ? -1 : a.from.path > b.from.path ? 1 : 0) ||
      a.answer.edge.at - b.answer.edge.at,
  );
}

// ---------------------------------------------------------------------------
// Seams (spec 05 §6)
// ---------------------------------------------------------------------------

export interface Seam {
  /** The lexicographically-least member path — the seam's stable name. */
  readonly id: RepoPath;
  readonly members: readonly RepoPath[];
}

/**
 * Connected components of the UNDIRECTED graph over in-tree modules joined by `imports`
 * edges. Direction is deliberately dropped: a seam answers "what moves together", and a
 * module and its importer move together whichever way the arrow points. Sorted by id;
 * singleton modules are their own seams — the honest reading, reported rather than hidden.
 */
export function seams(ix: NexusIndex): readonly Seam[] {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let root = a;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let cur = a;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) ?? root;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };

  for (const path of ix.moduleByPath.keys()) parent.set(path, path);
  for (const e of ix.graph.edges) {
    if (e.kind !== 'imports') continue;
    const from = ix.byId.get(e.from);
    const to = ix.byId.get(e.to);
    if (from?.kind === 'module' && to?.kind === 'module') union(from.path, to.path);
  }

  const groups = new Map<string, RepoPath[]>();
  for (const path of ix.moduleByPath.keys()) {
    const root = find(path);
    const list = groups.get(root) ?? [];
    list.push(path as RepoPath);
    groups.set(root, list);
  }
  return [...groups.entries()]
    .map(([, members]) => {
      const sorted = [...members].sort();
      return { id: sorted[0] as RepoPath, members: sorted };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The seam containing `path`, or null when the module is not in the graph. */
export function seamOf(ix: NexusIndex, path: RepoPath): Seam | null {
  for (const s of seams(ix)) {
    if (s.members.includes(path)) return s;
  }
  return null;
}
