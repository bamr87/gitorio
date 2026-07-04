// Deterministic layered layout for the fleet graph: columns follow workflow_run depth
// (producers/roots left → mergers right), external repos sit in a final column. Pure.

import type { Fleet } from './types';
import { externalNodeId } from './types';

export interface XY {
  x: number;
  y: number;
}

const COL_W = 300;
const ROW_H = 128;
const X0 = 40;
const Y0 = 24;

/** Longest incoming workflow_run chain to each workflow → its column. Cycle-safe. */
function depths(fleet: Fleet): Map<string, number> {
  const incoming = new Map<string, string[]>(); // node → workflow_run sources
  for (const w of fleet.workflows) incoming.set(w.path, []);
  for (const e of fleet.edges) {
    if (e.kind === 'workflow_run' && incoming.has(e.to)) incoming.get(e.to)!.push(e.from);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const sources = incoming.get(id) ?? [];
    const d = sources.length ? 1 + Math.max(...sources.map(depth)) : 0;
    visiting.delete(id);
    memo.set(id, d);
    return d;
  };
  for (const w of fleet.workflows) depth(w.path);
  return memo;
}

/** Node id → position. Includes external-repo station nodes in the rightmost column. */
export function layoutFleet(fleet: Fleet): Map<string, XY> {
  const pos = new Map<string, XY>();
  const d = depths(fleet);
  const maxDepth = fleet.workflows.reduce((m, w) => Math.max(m, d.get(w.path) ?? 0), 0);

  // Stack workflows within each column, in stable file order.
  const rowInCol = new Map<number, number>();
  for (const w of fleet.workflows) {
    const col = d.get(w.path) ?? 0;
    const row = rowInCol.get(col) ?? 0;
    rowInCol.set(col, row + 1);
    pos.set(w.path, { x: X0 + col * COL_W, y: Y0 + row * ROW_H });
  }

  // External repos in a final column, stacked.
  fleet.externalRepos.forEach((r, i) => {
    pos.set(externalNodeId(r), { x: X0 + (maxDepth + 1) * COL_W, y: Y0 + i * ROW_H });
  });

  return pos;
}
