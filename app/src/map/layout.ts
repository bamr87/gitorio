// archify IR → positioned map geometry (specs/013-archify-console, FR-1).
//
// A third pure consumer of GitFactory's data model, beside the compiler and the IR compiler:
// the workflow / architecture IR that `app/src/archify/ir.ts` emits (the same JSON the
// vendored renderer turns into the delivered maps) becomes positioned lanes, nodes, and
// orthogonal edge paths that `MapView` draws as inline SVG. The constants are archify's own
// (vendor/archify/renderers/{workflow,architecture}) so the in-app map and the delivered map
// share one coordinate frame. No I/O, no globals, deterministic (golden rule #3).

import type {
  ArchitectureIR,
  GuidedView,
  Variant,
  WorkflowEdgeIR,
  WorkflowIR,
} from '../archify/ir';
import type { ComponentType } from '../archify/vocabulary';

// ── output types ────────────────────────────────────────────────────────────

export interface MapNode {
  id: string;
  type: ComponentType;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lane (workflow) or boundary (architecture) the node sits in, when any. */
  frame?: string;
}

export interface MapFrame {
  id: string;
  label: string;
  kind: 'lane' | 'exception' | 'boundary';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lane index prefix ("01", "EX") — archify's lane header convention. */
  prefix?: string;
}

export type EdgeRole = 'main' | 'branch' | 'async' | 'return' | 'error' | 'default';
export type EdgeMarker = 'main' | 'security' | 'dashed' | 'default';

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  /** SVG path data (orthogonal polyline). */
  d: string;
  role: EdgeRole;
  variant: Variant;
  marker: EdgeMarker;
  label?: string;
  /** Label anchor — the midpoint of the route's middle segment. */
  lx: number;
  ly: number;
}

export interface MapLegendEntry {
  kind: ComponentType;
  label: string;
}

export interface MapGeometry {
  kind: 'workflow' | 'architecture';
  title: string;
  subtitle?: string;
  width: number;
  height: number;
  frames: MapFrame[];
  nodes: MapNode[];
  edges: MapEdge[];
  mainPath: string[];
  legend: MapLegendEntry[];
  views: GuidedView[];
}

// ── archify's constants ─────────────────────────────────────────────────────

/** vendor/archify/renderers/workflow/render-workflow.mjs `layout`. */
export const WORKFLOW_LAYOUT = {
  laneX: 40,
  laneY: 52,
  laneW: 640,
  laneH: 104,
  laneGap: 20,
  laneTitleH: 30,
  colXs: [88, 220, 300, 430, 500, 625],
  nodeW: 92,
  nodeH: 52,
} as const;

/** vendor/archify/renderers/architecture/{grid,render-architecture}.mjs. */
export const ARCHITECTURE_LAYOUT = {
  defaultW: 120,
  defaultH: 60,
  margin: 40,
  boundaryPad: 30,
  boundaryExtraBottom: 20,
  boundaryLabelBaseline: 18,
  boundaryLabelClearance: 4,
  legendH: 28,
} as const;

const DEFAULT_GRID = {
  origin: [40, 80] as [number, number],
  cols: 4,
  gapX: 30,
  gapY: 40,
  cellW: 130,
  cellH: 64,
};

const DEFAULT_LEGEND: Record<ComponentType, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Database',
  cloud: 'Cloud',
  security: 'Security',
  messagebus: 'Message bus',
  external: 'External',
};

const LEGEND_ORDER: ComponentType[] = [
  'external',
  'security',
  'backend',
  'database',
  'frontend',
  'messagebus',
  'cloud',
];

// ── routing ─────────────────────────────────────────────────────────────────

type Side = 'left' | 'right' | 'top' | 'bottom';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which sides an edge leaves and enters, from the endpoints' relative position. */
function sidesFor(a: Rect, b: Rect): [Side, Side] {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  // A clear horizontal gap wins (lane-mates, grid neighbours); otherwise go vertical.
  const horizontalGap = dx > 0 ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
  const verticalGap = dy > 0 ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
  if (horizontalGap >= 8 && (horizontalGap >= verticalGap || Math.abs(dy) < a.h)) {
    return dx > 0 ? ['right', 'left'] : ['left', 'right'];
  }
  if (verticalGap >= 8) return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  // Overlapping projections in both axes (should not happen on a placed IR): fall back.
  return Math.abs(dx) >= Math.abs(dy)
    ? dx >= 0
      ? ['right', 'left']
      : ['left', 'right']
    : dy >= 0
      ? ['bottom', 'top']
      : ['top', 'bottom'];
}

function anchor(r: Rect, side: Side, offset: number): { x: number; y: number } {
  switch (side) {
    case 'left':
      return { x: r.x, y: r.y + r.h / 2 + offset };
    case 'right':
      return { x: r.x + r.w, y: r.y + r.h / 2 + offset };
    case 'top':
      return { x: r.x + r.w / 2 + offset, y: r.y };
    case 'bottom':
      return { x: r.x + r.w / 2 + offset, y: r.y + r.h };
  }
}

const PORT_SPREAD = 10;

interface RoutedEdge {
  d: string;
  lx: number;
  ly: number;
}

/** Orthogonal route between two anchors on the given sides; label at the middle segment. */
function route(
  s: { x: number; y: number },
  t: { x: number; y: number },
  from: Side,
  to: Side,
): RoutedEdge {
  const horizontal = from === 'left' || from === 'right';
  const r = (v: number) => Math.round(v * 10) / 10;
  if (horizontal) {
    if (Math.abs(s.y - t.y) < 0.5) {
      return {
        d: `M ${r(s.x)} ${r(s.y)} L ${r(t.x)} ${r(t.y)}`,
        lx: r((s.x + t.x) / 2),
        ly: r(s.y),
      };
    }
    const mx = (s.x + t.x) / 2;
    return {
      d: `M ${r(s.x)} ${r(s.y)} H ${r(mx)} V ${r(t.y)} H ${r(t.x)}`,
      lx: r(mx),
      ly: r((s.y + t.y) / 2),
    };
  }
  if (Math.abs(s.x - t.x) < 0.5) {
    return { d: `M ${r(s.x)} ${r(s.y)} L ${r(t.x)} ${r(t.y)}`, lx: r(s.x), ly: r((s.y + t.y) / 2) };
  }
  const my = (s.y + t.y) / 2;
  const ret: RoutedEdge = {
    d: `M ${r(s.x)} ${r(s.y)} V ${r(my)} H ${r(t.x)} V ${r(t.y)}`,
    lx: r((s.x + t.x) / 2),
    ly: r(my),
  };
  void to;
  return ret;
}

interface RawEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  variant?: Variant;
  role?: WorkflowEdgeIR['role'];
}

function markerFor(role: EdgeRole, variant: Variant): EdgeMarker {
  if (variant === 'security') return 'security';
  if (variant === 'dashed') return 'dashed';
  if (role === 'main' || variant === 'emphasis') return 'main';
  return 'default';
}

/**
 * Route every edge. Edges sharing a node side are spread along it (archify's Automatic
 * Port Spread, simplified): ordered by the far endpoint so routes never cross at the port.
 */
function routeEdges(raw: RawEdge[], rects: Map<string, Rect>, mainPairs: Set<string>): MapEdge[] {
  const planned = raw
    .filter((e) => rects.has(e.from) && rects.has(e.to) && e.from !== e.to)
    .map((e) => {
      const a = rects.get(e.from)!;
      const b = rects.get(e.to)!;
      const [fromSide, toSide] = sidesFor(a, b);
      return { e, a, b, fromSide, toSide };
    });

  // Port occupancy: key = node + side → edges, sorted by where the other end is.
  const ports = new Map<string, { index: number; key: 'out' | 'in' }[]>();
  const portKey = (id: string, side: Side) => `${id}:${side}`;
  const sortKey = (p: (typeof planned)[number], end: 'out' | 'in') => {
    const other = end === 'out' ? p.b : p.a;
    const side = end === 'out' ? p.fromSide : p.toSide;
    return side === 'left' || side === 'right' ? other.y + other.h / 2 : other.x + other.w / 2;
  };
  planned.forEach((p, index) => {
    const out = portKey(p.e.from, p.fromSide);
    const inn = portKey(p.e.to, p.toSide);
    ports.set(out, [...(ports.get(out) ?? []), { index, key: 'out' }]);
    ports.set(inn, [...(ports.get(inn) ?? []), { index, key: 'in' }]);
  });
  const offsetOf = new Map<string, number>(); // `${index}:${end}` → px offset
  for (const list of ports.values()) {
    const sorted = [...list].sort(
      (u, v) => sortKey(planned[u.index], u.key) - sortKey(planned[v.index], v.key),
    );
    sorted.forEach((slot, i) => {
      offsetOf.set(`${slot.index}:${slot.key}`, (i - (sorted.length - 1) / 2) * PORT_SPREAD);
    });
  }

  return planned.map((p, index) => {
    const s = anchor(p.a, p.fromSide, offsetOf.get(`${index}:out`) ?? 0);
    const t = anchor(p.b, p.toSide, offsetOf.get(`${index}:in`) ?? 0);
    const routed = route(s, t, p.fromSide, p.toSide);
    const role: EdgeRole =
      p.e.role ?? (mainPairs.has(`${p.e.from}>${p.e.to}`) ? 'main' : 'default');
    const variant: Variant = p.e.variant ?? 'default';
    return {
      id: p.e.id,
      from: p.e.from,
      to: p.e.to,
      d: routed.d,
      role,
      variant,
      marker: markerFor(role, variant),
      ...(p.e.label ? { label: p.e.label } : {}),
      lx: routed.lx,
      ly: routed.ly,
    };
  });
}

function legendFor(
  nodes: MapNode[],
  entries: Partial<Record<ComponentType, { label: string }>> | undefined,
): MapLegendEntry[] {
  const present = new Set(nodes.map((n) => n.type));
  return LEGEND_ORDER.filter((k) => present.has(k)).map((kind) => ({
    kind,
    label: entries?.[kind]?.label ?? DEFAULT_LEGEND[kind],
  }));
}

// ── workflow ────────────────────────────────────────────────────────────────

/** Lay out one assembly line's workflow IR in archify's lane frame (680 px wide). */
export function layoutWorkflow(ir: WorkflowIR): MapGeometry {
  const L = WORKFLOW_LAYOUT;
  const laneIndex = new Map(ir.lanes.map((l, i) => [l.id, i]));
  const laneTop = (lane: string) => L.laneY + (laneIndex.get(lane) ?? 0) * (L.laneH + L.laneGap);

  const frames: MapFrame[] = [];
  ir.lanes.forEach((lane, index) => {
    const y = laneTop(lane.id);
    const exception = lane.variant === 'exception';
    frames.push({
      id: `lane-${lane.id}`,
      label: lane.label,
      kind: 'lane',
      x: L.laneX,
      y,
      w: L.laneW,
      h: L.laneH,
      prefix: exception ? 'EX' : String(index + 1).padStart(2, '0'),
    });
    if (exception) {
      frames.push({
        id: `lane-${lane.id}-exception`,
        label: `${lane.label} exception`,
        kind: 'exception',
        x: L.laneX + 6,
        y: y + 6,
        w: L.laneW - 12,
        h: L.laneH - 12,
      });
    }
  });

  const contentH = L.laneH - L.laneTitleH;
  const nodes: MapNode[] = ir.nodes.map((n) => {
    const col = Math.min(L.colXs.length - 1, Math.max(0, n.col));
    const cx = L.colXs[col];
    return {
      id: n.id,
      type: n.type,
      label: n.label,
      ...(n.sublabel ? { sublabel: n.sublabel } : {}),
      x: cx - L.nodeW / 2,
      y: laneTop(n.lane) + L.laneTitleH + (contentH - L.nodeH) / 2,
      w: L.nodeW,
      h: L.nodeH,
      frame: `lane-${n.lane}`,
    };
  });

  const rects = new Map<string, Rect>(nodes.map((n) => [n.id, n]));
  const main = ir.mainPath ?? [];
  const mainPairs = new Set(main.slice(1).map((id, i) => `${main[i]}>${id}`));
  const edges = routeEdges(ir.edges, rects, mainPairs);

  const laneCount = Math.max(1, ir.lanes.length);
  const height = L.laneY + laneCount * L.laneH + (laneCount - 1) * L.laneGap + 24;

  return {
    kind: 'workflow',
    title: ir.meta.title,
    ...(ir.meta.subtitle ? { subtitle: ir.meta.subtitle } : {}),
    width: L.laneX + L.laneW,
    height,
    frames,
    nodes,
    edges,
    mainPath: main.filter((id) => rects.has(id)),
    legend: legendFor(nodes, ir.meta.legend?.entries),
    views: ir.meta.views ?? [],
  };
}

// ── architecture ────────────────────────────────────────────────────────────

/** Lay out a fleet's architecture IR on its grid (archify's cell math, boundary padding). */
export function layoutArchitecture(ir: ArchitectureIR): MapGeometry {
  const A = ARCHITECTURE_LAYOUT;
  const grid = { ...DEFAULT_GRID, ...(ir.layout ?? {}) };
  const stepX = grid.cellW + grid.gapX;
  const stepY = grid.cellH + grid.gapY;

  const nodes: MapNode[] = ir.components.map((c) => ({
    id: c.id,
    type: c.type,
    label: c.label,
    ...(c.sublabel ? { sublabel: c.sublabel } : {}),
    x: grid.origin[0] + c.col * stepX,
    y: grid.origin[1] + c.row * stepY,
    w: A.defaultW,
    h: A.defaultH,
  }));
  const rects = new Map<string, Rect>(nodes.map((n) => [n.id, n]));

  const frames: MapFrame[] = [];
  ir.boundaries.forEach((b, i) => {
    const members = b.wraps.map((id) => rects.get(id)).filter((r): r is Rect => !!r);
    if (!members.length) return;
    const minX = Math.min(...members.map((m) => m.x));
    const minY = Math.min(...members.map((m) => m.y));
    const maxX = Math.max(...members.map((m) => m.x + m.w));
    const maxY = Math.max(...members.map((m) => m.y + m.h));
    const pad = A.boundaryPad;
    const topPad = Math.max(pad, A.boundaryLabelBaseline + A.boundaryLabelClearance);
    const id = `boundary-${i}`;
    frames.push({
      id,
      label: b.label,
      kind: 'boundary',
      x: minX - pad,
      y: minY - topPad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + topPad + A.boundaryExtraBottom,
    });
    for (const n of nodes) if (b.wraps.includes(n.id) && !n.frame) n.frame = id;
  });

  const edges = routeEdges(ir.connections, rects, new Set());

  const extentX = Math.max(
    ...nodes.map((n) => n.x + n.w),
    ...frames.map((f) => f.x + f.w),
    grid.origin[0],
  );
  const extentY = Math.max(
    ...nodes.map((n) => n.y + n.h),
    ...frames.map((f) => f.y + f.h),
    grid.origin[1],
  );
  const [vbW, vbH] = ir.meta.viewBox ?? [0, 0];
  const width = Math.max(vbW, Math.ceil(extentX + A.margin));
  const height = Math.max(vbH, Math.ceil(extentY + A.margin));

  return {
    kind: 'architecture',
    title: ir.meta.title,
    ...(ir.meta.subtitle ? { subtitle: ir.meta.subtitle } : {}),
    width,
    height,
    frames,
    nodes,
    edges,
    mainPath: [],
    legend: legendFor(nodes, ir.meta.legend?.entries),
    views: ir.meta.views ?? [],
  };
}

// ── authored reachability (DESIGN.md: Upstream / Downstream over authored edges) ──

export interface Reach {
  direction: 'upstream' | 'downstream';
  origin: string;
  nodes: Set<string>;
  edges: Set<string>;
  maxHops: number;
}

/** Everything reachable from `origin` over authored edges, following them forward or backward. */
export function reach(
  geometry: Pick<MapGeometry, 'edges'>,
  origin: string,
  direction: Reach['direction'],
): Reach {
  const next = new Map<string, MapEdge[]>();
  for (const e of geometry.edges) {
    const key = direction === 'downstream' ? e.from : e.to;
    next.set(key, [...(next.get(key) ?? []), e]);
  }
  const nodes = new Set<string>();
  const edges = new Set<string>();
  let frontier = [origin];
  let hops = 0;
  let maxHops = 0;
  const seen = new Set<string>([origin]);
  while (frontier.length) {
    const following: string[] = [];
    for (const id of frontier) {
      for (const e of next.get(id) ?? []) {
        const other = direction === 'downstream' ? e.to : e.from;
        edges.add(e.id);
        if (!seen.has(other)) {
          seen.add(other);
          nodes.add(other);
          following.push(other);
        }
      }
    }
    if (following.length) {
      hops += 1;
      maxHops = hops;
    }
    frontier = following;
  }
  return { direction, origin, nodes, edges, maxHops };
}
