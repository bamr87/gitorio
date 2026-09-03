// Blueprint / Fleet → archify IR (ADR-034, specs/010-archify-maps).
//
// A second pure consumer of GitFactory's data model, beside the compiler: one assembly
// line becomes an archify *workflow* diagram, one or more reverse-imported fleets become
// an *architecture* diagram. Output is plain JSON matching vendor/archify/schemas/*.json;
// rendering happens in scripts and CI (never the browser — golden rule #1). No I/O, no
// globals, deterministic for a given input (golden rule #3).

import type { Blueprint, BlueprintNode } from '../blueprint/types';
import type { AssemblyLine } from '../compiler/compile';
import type { Fleet } from '../fleet/types';
import { repoSlug } from '../github/types';
import {
  LANES,
  LEGEND,
  LOOP_PRONE_TRIGGERS,
  type ComponentType,
  type LaneId,
  vocabularyFor,
} from './vocabulary';

// ── IR types (the subset of the archify schemas we emit) ────────────────────

export type Variant = 'default' | 'emphasis' | 'security' | 'dashed';

export interface GuidedView {
  id: string;
  label: string;
  focus: string[];
  note?: string;
}

interface MetaBase {
  title: string;
  subtitle?: string;
  visual_preset?: 'classic' | 'signal-flow' | 'blueprint' | 'editorial';
  quality_profile?: 'standard' | 'showcase';
  animation?: 'trace' | 'none';
  views?: GuidedView[];
  legend?: {
    mode?: 'auto' | 'all' | 'hidden';
    entries?: Partial<Record<ComponentType, { label: string }>>;
  };
  viewBox?: [number, number];
}

export interface WorkflowNodeIR {
  id: string;
  lane: string;
  col: number;
  type: ComponentType;
  label: string;
  sublabel?: string;
}

export interface WorkflowEdgeIR {
  id: string;
  from: string;
  to: string;
  label?: string;
  variant?: Variant;
  role?: 'main' | 'branch' | 'async' | 'return' | 'error';
}

export interface WorkflowIR {
  schema_version: 1;
  diagram_type: 'workflow';
  meta: MetaBase;
  lanes: { id: string; label: string; variant?: 'normal' | 'exception' }[];
  mainPath?: string[];
  nodes: WorkflowNodeIR[];
  edges: WorkflowEdgeIR[];
}

export interface ArchComponentIR {
  id: string;
  type: ComponentType;
  label: string;
  sublabel?: string;
  row: number;
  col: number;
}

export interface ArchConnectionIR {
  id: string;
  from: string;
  to: string;
  label?: string;
  variant?: Variant;
}

export interface ArchitectureIR {
  schema_version: 1;
  diagram_type: 'architecture';
  meta: MetaBase;
  layout: {
    mode: 'grid';
    origin: [number, number];
    cols: number;
    gapX: number;
    gapY: number;
    cellW: number;
    cellH: number;
  };
  components: ArchComponentIR[];
  boundaries: { kind: string; label: string; wraps: string[] }[];
  connections: ArchConnectionIR[];
}

// ── shared helpers ──────────────────────────────────────────────────────────

/** archify ids must match ^[a-zA-Z][a-zA-Z0-9_-]*$ — blueprint/workflow ids need not. */
export function safeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-');
  return /^[a-zA-Z]/.test(cleaned) ? cleaned : `n-${cleaned}`;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** What a machine says about itself under the label — always short, never attacker-length. */
export function sublabelFor(node: BlueprintNode): string | undefined {
  const c = node.config;
  const promptRef = str(c.promptRef);
  if (promptRef) return truncate(promptRef.split('/').pop()!.replace(/\.md$/i, ''), 18);
  const cron = str(c.cron);
  if (cron) return truncate(cron, 18);
  const variable = str(c.variable);
  if (variable) return truncate(variable, 18);
  const label = str(c.label);
  if (label) return truncate(label, 18);
  const target = str(c.targetRepo);
  if (target) return truncate(target, 18);
  const eventType = str(c.eventType);
  if (eventType) return truncate(eventType, 18);
  if (typeof c.maxPerDay === 'number') return `${c.maxPerDay}/day`;
  if (typeof c.maxOpenPrs === 'number') return `≤ ${c.maxOpenPrs} open PRs`;
  return undefined;
}

// ── workflow IR: one assembly line ──────────────────────────────────────────

/** The renderer's column x positions (vendor/archify/renderers/workflow). A 92 px node needs ≥ 100 px of separation from its lane-mates. */
const COL_X = [88, 220, 300, 430, 500, 625];
const MIN_SEP = 100;
const MAX_COL = COL_X.length - 1;

/** Longest-path depth from any trigger; cycles (impossible in a compiled line, but cheap to guard) stop at the first revisit. */
function depths(
  ids: string[],
  outgoing: Map<string, string[]>,
  roots: string[],
): Map<string, number> {
  const depth = new Map<string, number>();
  for (const id of ids) depth.set(id, 0);
  const visit = (id: string, d: number, seen: Set<string>) => {
    if (seen.has(id)) return;
    if ((depth.get(id) ?? 0) < d) depth.set(id, d);
    const next = new Set(seen).add(id);
    for (const to of outgoing.get(id) ?? []) visit(to, d + 1, next);
  };
  for (const r of roots) visit(r, 0, new Set());
  return depth;
}

/** Longest simple walk from a root, preferring to end on a sink. */
function longestPath(
  roots: string[],
  outgoing: Map<string, string[]>,
  isSink: (id: string) => boolean,
): string[] {
  let best: string[] = [];
  const score = (p: string[]) => p.length + (isSink(p[p.length - 1]) ? 100 : 0);
  const walk = (path: string[]) => {
    const here = path[path.length - 1];
    const next = (outgoing.get(here) ?? []).filter((n) => !path.includes(n));
    if (next.length === 0) {
      if (score(path) > score(best)) best = path;
      return;
    }
    for (const n of next) walk([...path, n]);
  };
  for (const r of roots) walk([r]);
  return best;
}

/** Same-lane collision resolver: nearest free column at ≥ MIN_SEP px, preferring rightward. */
function placeInLane(occupied: number[], preferred: number): number | null {
  const free = (c: number) => occupied.every((o) => Math.abs(COL_X[c] - COL_X[o]) >= MIN_SEP);
  // Rightward only: a node placed left of its predecessor would force a backward belt,
  // which archify's clean-flow rules reject. A full lane overflows into a "(cont.)" lane.
  for (let c = preferred; c <= MAX_COL; c++) if (free(c)) return c;
  return null;
}

export interface WorkflowIROptions {
  /** e.g. the blueprint's repo path, shown as the subtitle's tail. */
  source?: string;
}

/**
 * Compile one assembly line to an archify workflow diagram. Lanes are roles (triggers →
 * gates → processing → outputs), columns follow topological depth, and a loop-prone line
 * (ADR-009's condition: an event trigger an agent's own write can re-emit, plus a writing
 * sink) gets the compiler's bot-actor guard drawn as a node in an exception lane — the map
 * shows the guard the YAML really carries.
 */
export function toWorkflowIR(
  bp: Blueprint,
  line: AssemblyLine,
  opts: WorkflowIROptions = {},
): WorkflowIR {
  const inLine = new Set(line.nodeIds);
  const nodes = bp.nodes.filter((n) => inLine.has(n.id));
  const edges = bp.edges.filter((e) => inLine.has(e.from.node) && inLine.has(e.to.node));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  for (const e of edges)
    outgoing.set(e.from.node, [...(outgoing.get(e.from.node) ?? []), e.to.node]);

  const laneOf = (n: BlueprintNode): LaneId => vocabularyFor(n.type).lane;
  const triggers = nodes.filter((n) => laneOf(n) === 'triggers').map((n) => n.id);
  const sinks = new Set(nodes.filter((n) => laneOf(n) === 'sinks').map((n) => n.id));
  const depth = depths(
    nodes.map((n) => n.id),
    outgoing,
    triggers.length ? triggers : nodes.map((n) => n.id),
  );

  // Stable order: by depth, then by blueprint order — so placement is deterministic.
  const ordered = [...nodes].sort(
    (a, b) => depth.get(a.id)! - depth.get(b.id)! || nodes.indexOf(a) - nodes.indexOf(b),
  );
  const maxDepth = Math.max(0, ...ordered.map((n) => depth.get(n.id)!));
  const scale = maxDepth > MAX_COL ? MAX_COL / maxDepth : 1;

  // Placement. A lane holds at most four 92 px nodes across the six columns; when a lane
  // is full, the tail collapses into one "+N more" node (the same honest device the fleet
  // map uses) rather than overlapping or fighting the router with extra lanes.
  const occupied = new Map<string, number[]>();
  const usedLanes = new Set<string>();
  const irNodes: WorkflowNodeIR[] = [];
  const idMap = new Map<string, string>();
  const overflow = new Map<string, BlueprintNode[]>();
  const lastPlaced = new Map<string, WorkflowNodeIR>();
  for (const n of ordered) {
    const v = vocabularyFor(n.type);
    const preferred = Math.min(MAX_COL, Math.round(depth.get(n.id)! * scale));
    const col = placeInLane(occupied.get(v.lane) ?? [], preferred);
    if (col === null) {
      overflow.set(v.lane, [...(overflow.get(v.lane) ?? []), n]);
      continue;
    }
    occupied.set(v.lane, [...(occupied.get(v.lane) ?? []), col]);
    usedLanes.add(v.lane);
    const id = safeId(n.id);
    idMap.set(n.id, id);
    const sub = sublabelFor(n);
    const node: WorkflowNodeIR = {
      id,
      lane: v.lane,
      col,
      type: v.component,
      label: v.label,
      ...(sub ? { sublabel: sub } : {}),
    };
    irNodes.push(node);
    lastPlaced.set(v.lane, node);
  }
  for (const [lane, extra] of overflow) {
    // The last placed node of the lane gives up its slot to the collapsed group.
    const victim = lastPlaced.get(lane)!;
    const victimSource = nodes.find((n) => idMap.get(n.id) === victim.id)!;
    const members = [victimSource, ...extra];
    const moreId = safeId(`${lane}-more`);
    const kinds = [...new Set(members.map((m) => vocabularyFor(m.type).label))];
    Object.assign(victim, {
      id: moreId,
      type: vocabularyFor(victimSource.type).component,
      label: `+${members.length} more`,
      sublabel: truncate(kinds.join(', '), 18),
    });
    for (const m of members) idMap.set(m.id, moreId);
  }

  const rawMain = longestPath(triggers, outgoing, (id) => sinks.has(id)).map((id) =>
    idMap.get(id)!,
  );
  const main = rawMain.filter((id, i) => i === 0 || id !== rawMain[i - 1]);
  const mainPairs = new Set(main.slice(1).map((id, i) => `${main[i]}>${id}`));
  const seenEdge = new Set<string>();
  const irEdges: WorkflowEdgeIR[] = [];
  for (const e of edges) {
    const from = idMap.get(e.from.node)!;
    const to = idMap.get(e.to.node)!;
    if (from === to || seenEdge.has(`${from}>${to}`)) continue;
    seenEdge.add(`${from}>${to}`);
    irEdges.push({
      id: safeId(`e-${e.id}`),
      from,
      to,
      role: mainPairs.has(`${from}>${to}`) ? 'main' : 'branch',
    });
  }

  // The compiler's bot-actor guard (ADR-009), drawn where it acts: right after the trigger.
  const loopProne =
    triggers.some((t) => LOOP_PRONE_TRIGGERS.has(byId.get(t)!.type)) && sinks.size > 0;
  const views: GuidedView[] = [];
  if (main.length >= 2) {
    views.push({
      id: 'main-path',
      label: 'Main path',
      focus: main,
      note: 'Trigger to terminal output — the line as compiled.',
    });
  }
  if (loopProne) {
    const guardId = 'guard-bot-actor';
    const firstTrigger = irNodes.find((n) => n.lane === 'triggers')!;
    usedLanes.add('guards');
    irNodes.push({
      id: guardId,
      lane: 'guards',
      col: Math.min(MAX_COL, firstTrigger.col + 1),
      type: 'security',
      label: 'Bot guard',
      sublabel: 'sender ≠ Bot',
    });
    for (const t of triggers) {
      irEdges.push({
        id: safeId(`e-guard-${t}`),
        from: idMap.get(t)!,
        to: guardId,
        label: 'if',
        variant: 'security',
        role: 'branch',
      });
    }
    views.push({
      id: 'loop-guard',
      label: 'Loop guard',
      focus: [
        ...triggers.map((t) => idMap.get(t)!),
        guardId,
        ...[...sinks].map((s) => idMap.get(s)!),
      ],
      note: 'Writes this line performs could re-emit its own trigger; the actor guard breaks the loop.',
    });
  }

  const lanes: WorkflowIR['lanes'] = [];
  for (const l of LANES) {
    if (usedLanes.has(l.id)) lanes.push({ id: l.id, label: l.label });
  }
  if (usedLanes.has('guards')) lanes.push({ id: 'guards', label: 'Guards', variant: 'exception' });

  const subtitleParts = [bp.meta.name, line.filename, opts.source].filter(Boolean);
  return {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: truncate(line.name, 60),
      subtitle: truncate(subtitleParts.join(' · '), 120),
      visual_preset: 'signal-flow',
      quality_profile: 'showcase',
      animation: 'trace',
      ...(views.length ? { views } : {}),
      legend: {
        mode: 'auto',
        entries: Object.fromEntries(Object.entries(LEGEND).map(([k, label]) => [k, { label }])),
      },
    },
    lanes,
    ...(main.length >= 2 ? { mainPath: main } : {}),
    nodes: irNodes,
    edges: irEdges,
  };
}

// ── architecture IR: one or more fleets ─────────────────────────────────────

export interface ArchitectureIROptions {
  /** Total component budget across all fleets (archify's "one story" guidance is ≤ 12). */
  cap?: number;
  title?: string;
}

const GRID = {
  cols: 4,
  cellW: 150,
  cellH: 64,
  gapX: 40,
  gapY: 72,
  origin: [40, 48] as [number, number],
};

/** The architecture-IR component id of one workflow — shared with the in-app map so a passport can find its workflow (specs/013). */
export function fleetComponentId(repo: string, workflowSlug: string): string {
  return safeId(`${safeId(repo)}--${workflowSlug}`);
}

function componentTypeForWorkflow(w: Fleet['workflows'][number]): ComponentType {
  if (w.hasAgent) return 'backend';
  if (w.sinks.includes('dispatch') || w.sinks.includes('cross_repo_issue')) return 'messagebus';
  if (w.sinks.includes('deploy')) return 'cloud';
  if (w.gate && w.sinks.length === 0) return 'security';
  if (w.sinks.length > 0) return 'frontend';
  return 'external';
}

/**
 * Compile one or more reverse-imported fleets to an archify architecture diagram: one
 * boundary per repo, workflows as components (ranked so the agent-bearing and belted ones
 * survive the cap; the remainder collapses into one "N more" component), belts as
 * connections. Grid layout, so nothing here depends on canvas positions.
 */
export function toArchitectureIR(
  input: Fleet | Fleet[],
  opts: ArchitectureIROptions = {},
): ArchitectureIR {
  const fleets = Array.isArray(input) ? input : [input];
  const cap = Math.max(1, opts.cap ?? 12);
  const perFleet = Math.max(1, Math.floor(cap / Math.max(1, fleets.length)));

  const components: ArchComponentIR[] = [];
  const boundaries: ArchitectureIR['boundaries'] = [];
  const connections: ArchConnectionIR[] = [];
  const views: GuidedView[] = [];
  const seenConn = new Set<string>();
  let row = 0;

  // external repo id → component id (shared across fleets; created lazily on the last rows)
  const externals = new Map<string, { id: string; label: string }>();

  for (const fleet of fleets) {
    const slug = repoSlug(fleet.repo);
    const prefix = safeId(slug);
    const touched = new Map<string, number>();
    for (const e of fleet.edges) {
      touched.set(e.from, (touched.get(e.from) ?? 0) + 1);
      touched.set(e.to, (touched.get(e.to) ?? 0) + 1);
    }
    const score = (w: Fleet['workflows'][number]) =>
      (w.hasAgent ? 4 : 0) +
      Math.min(3, touched.get(w.path) ?? 0) * 3 +
      (w.sinks.length ? 1 : 0) +
      (w.gate ? 1 : 0);
    const ranked = [...fleet.workflows].sort(
      (a, b) => score(b) - score(a) || a.path.localeCompare(b.path),
    );
    const budget = ranked.length > perFleet ? perFleet - 1 : perFleet;
    const kept = ranked.slice(0, budget);
    const dropped = ranked.slice(budget);

    const idFor = new Map<string, string>();
    const startRow = row;
    kept.forEach((w, i) => {
      const id = fleetComponentId(slug, w.slug);
      idFor.set(w.path, id);
      const trig = [...new Set(w.triggers.map((t) => t.kind))].join(', ');
      components.push({
        id,
        type: componentTypeForWorkflow(w),
        label: truncate(w.name, 18),
        ...(trig ? { sublabel: truncate(trig, 24) } : {}),
        row: startRow + Math.floor(i / GRID.cols),
        col: i % GRID.cols,
      });
    });
    let moreId: string | null = null;
    if (dropped.length) {
      moreId = safeId(`${prefix}--more`);
      const i = kept.length;
      components.push({
        id: moreId,
        type: 'external',
        label: `${dropped.length} more workflow${dropped.length === 1 ? '' : 's'}`,
        sublabel: 'not shown',
        row: startRow + Math.floor(i / GRID.cols),
        col: i % GRID.cols,
      });
      for (const w of dropped) idFor.set(w.path, moreId);
    }
    const wrapped = [...new Set([...idFor.values()])];
    row = startRow + Math.ceil(wrapped.length / GRID.cols);
    boundaries.push({ kind: 'region', label: truncate(slug, 40), wraps: wrapped });
    if (views.length < 5)
      views.push({ id: safeId(`repo-${slug}`), label: truncate(slug, 30), focus: wrapped });

    for (const e of fleet.edges) {
      const from = idFor.get(e.from);
      let to = idFor.get(e.to);
      if (!to && e.to.startsWith('ext:')) {
        const ownerName = e.to.slice(4);
        const known = fleets.find((f) => repoSlug(f.repo) === ownerName);
        if (known) continue; // drawn from the other fleet's own boundary; skip a dangling external
        const ext = externals.get(ownerName) ?? {
          id: safeId(`ext--${ownerName}`),
          label: truncate(ownerName, 18),
        };
        externals.set(ownerName, ext);
        to = ext.id;
      }
      if (!from || !to || from === to) continue;
      const key = `${from}>${to}`;
      if (seenConn.has(key)) continue;
      seenConn.add(key);
      connections.push({
        id: safeId(`c-${key}`),
        from,
        to,
        label: e.kind === 'workflow_run' ? 'after' : 'cross-repo',
        variant: e.kind === 'workflow_run' ? 'default' : 'dashed',
      });
    }
  }

  // External repos get their own row under everything else.
  if (externals.size) {
    const list = [...externals.values()];
    list.forEach((ext, i) => {
      components.push({
        id: ext.id,
        type: 'external',
        label: ext.label,
        sublabel: 'external repo',
        row: row + Math.floor(i / GRID.cols),
        col: i % GRID.cols,
      });
    });
    row += Math.ceil(list.length / GRID.cols);
  }

  const width = GRID.origin[0] * 2 + GRID.cols * GRID.cellW + (GRID.cols - 1) * GRID.gapX;
  const height = GRID.origin[1] * 2 + row * GRID.cellH + Math.max(0, row - 1) * GRID.gapY + 40;
  const title =
    opts.title ??
    (fleets.length === 1
      ? `${repoSlug(fleets[0].repo)} automation`
      : `Fleet · ${fleets.length} repos`);
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: truncate(title, 60),
      subtitle: `${components.length} workflows mapped · ${connections.length} belts`,
      visual_preset: 'signal-flow',
      quality_profile: 'showcase',
      ...(views.length ? { views } : {}),
      legend: {
        mode: 'auto',
        entries: {
          backend: { label: 'AI workflow' },
          frontend: { label: 'Writes (PR/issue/comment)' },
          messagebus: { label: 'Dispatch belt' },
          cloud: { label: 'Deploys' },
          security: { label: 'Gated only' },
          external: { label: 'Other / external' },
        },
      },
      viewBox: [Math.max(800, width), Math.max(400, height)],
    },
    layout: { mode: 'grid', ...GRID },
    components,
    boundaries,
    connections,
  };
}
