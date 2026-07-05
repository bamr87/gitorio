// Live compiler diagnostics, bucketed per node — the seam that lets the Inspector and the
// canvas surface "what's wrong with THIS machine" without re-running the compiler N times.
// The compiler is the single source of truth for validation (golden rule #3): rather than a
// parallel form-validation system, we compile the working blueprint and route each
// diagnostic to its node. Cached by blueprint hash so all callers share one compile pass.

import { useMemo } from 'react';
import { compile, type Diagnostic } from '../compiler/compile';
import type { Blueprint } from '../blueprint/types';
import { useFactoryStore } from './store';

// Diagnostics depend on machine types, config, wiring, and the factory name — NOT on node
// positions, so dragging a machine never recompiles. This signature excludes positions.
function semanticSig(bp: Blueprint): string {
  return JSON.stringify([
    bp.meta.name,
    bp.nodes.map((n) => [n.id, n.type, n.config]),
    bp.edges.map((e) => [e.from.node, e.to.node]),
  ]);
}

export type DiagLevel = 'error' | 'warning';

export interface BlueprintDiagnostics {
  /** All diagnostics carrying a nodeId, keyed by that id. */
  byNode: Map<string, Diagnostic[]>;
  /** The most severe level per node (error > warning); nodes with only info are absent. */
  worstByNode: Map<string, DiagLevel>;
  /** Diagnostics not tied to a specific node (line-level / global). */
  global: Diagnostic[];
  errorCount: number;
  warningCount: number;
}

let cache: { sig: string; result: BlueprintDiagnostics } | null = null;

/** Pure: compile the blueprint and bucket diagnostics by node. Memoised on the semantic signature. */
export function diagnosticsFor(bp: Blueprint): BlueprintDiagnostics {
  const sig = semanticSig(bp);
  if (cache && cache.sig === sig) return cache.result;

  const { workflows, diagnostics } = compile(bp);
  const all: Diagnostic[] = [...diagnostics, ...workflows.flatMap((w) => w.diagnostics)];

  const byNode = new Map<string, Diagnostic[]>();
  const global: Diagnostic[] = [];
  for (const d of all) {
    if (!d.nodeId) {
      global.push(d);
      continue;
    }
    const arr = byNode.get(d.nodeId);
    if (arr) arr.push(d);
    else byNode.set(d.nodeId, [d]);
  }

  const worstByNode = new Map<string, DiagLevel>();
  for (const [id, ds] of byNode) {
    if (ds.some((d) => d.level === 'error')) worstByNode.set(id, 'error');
    else if (ds.some((d) => d.level === 'warning')) worstByNode.set(id, 'warning');
  }

  const result: BlueprintDiagnostics = {
    byNode,
    worstByNode,
    global,
    errorCount: all.filter((d) => d.level === 'error').length,
    warningCount: all.filter((d) => d.level === 'warning').length,
  };
  cache = { sig, result };
  return result;
}

/** Recomputes only when the graph or meta changes; shared across every node via the hash cache. */
export function useBlueprintDiagnostics(): BlueprintDiagnostics {
  const nodes = useFactoryStore((s) => s.nodes);
  const edges = useFactoryStore((s) => s.edges);
  const meta = useFactoryStore((s) => s.meta);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  return useMemo(() => diagnosticsFor(toBlueprint()), [nodes, edges, meta, toBlueprint]);
}
