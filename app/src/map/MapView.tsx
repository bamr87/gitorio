// MapView (specs/013-archify-console, FR-2/FR-3) — GitFactory's own view of an archify map.
//
// Draws the positioned geometry from `layout.ts` as inline SVG in the Evidence Console
// vocabulary (the same `c-<type>` semantic classes the delivered maps use) and carries
// archify's reader model: focus opens the Semantic Passport, `/` opens the Node Finder,
// guided views keep a chapter strong while the rest recedes, authored reachability traces
// upstream (violet) / downstream (green), and a bottom-right nav zooms. Everything textual
// is a React text node (golden rule #9); every action has a keyboard path.
//
// Not a port of archify's renderer (ADR-034 D-1): route probe, exports, presentation and
// story playback stay in the delivered HTML, which hosts link to.

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import './map.css';
import type { ComponentType } from '../archify/vocabulary';
import { Finder } from './Finder';
import { Passport, type PassportSection } from './Passport';
import {
  reach as computeReach,
  type MapEdge,
  type MapGeometry,
  type MapNode,
  type Reach,
} from './layout';

export interface Beacon {
  /** ≤ 5 characters — the capsule is 34 px wide. */
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  title?: string;
}

export interface MapViewProps {
  geometry: MapGeometry;
  /** Evidence beacons by node id (telemetry LEDs, diagnostics) — text-labelled, never colour alone. */
  beacons?: Record<string, Beacon>;
  /** Host-supplied passport sections for a node (config, capabilities, runs…). */
  describe?: (nodeId: string) => PassportSection[];
  /** Controlled focus — omit for the map to own its focus state. */
  focusId?: string | null;
  onFocus?: (id: string | null) => void;
  /** Extra controls for the nav (e.g. "Open delivered map ↗"). */
  actions?: ReactNode;
  /** Hide the title block (stacked line maps carry their own header). */
  compact?: boolean;
  passportEyebrow?: string;
  ariaLabel?: string;
}

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

const LABEL_SIZE = (label: string, preferred: number, min: number, fit: number) =>
  label.length <= fit ? preferred : Math.max(min, preferred - Math.ceil((label.length - fit) / 2));

export function MapView({
  geometry,
  beacons = {},
  describe,
  focusId,
  onFocus,
  actions,
  compact = false,
  passportEyebrow,
  ariaLabel,
}: MapViewProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const controlled = focusId !== undefined;
  const [innerFocus, setInnerFocus] = useState<string | null>(null);
  const focus = controlled ? (focusId ?? null) : innerFocus;
  const [finderOpen, setFinderOpen] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [reachState, setReachState] = useState<Reach | null>(null);
  const [zoomIndex, setZoomIndex] = useState(3);

  const byId = useMemo(() => new Map(geometry.nodes.map((n) => [n.id, n])), [geometry]);
  const legendLabel = useMemo(
    () => new Map(geometry.legend.map((l) => [l.kind, l.label])),
    [geometry],
  );
  const kindLabel = useCallback((n: MapNode) => legendLabel.get(n.type) ?? n.type, [legendLabel]);

  const setFocus = useCallback(
    (id: string | null) => {
      if (!controlled) setInnerFocus(id);
      onFocus?.(id);
      setReachState(null);
    },
    [controlled, onFocus],
  );

  // A focus the host set on a node that no longer exists (a rerender) clears itself.
  useEffect(() => {
    if (focus && !byId.has(focus)) setFocus(null);
  }, [focus, byId, setFocus]);

  const focused = focus ? (byId.get(focus) ?? null) : null;

  // What stays strong: an active reach, else the active guided view, else the focused
  // node with its direct relationships. Nothing active → nothing recedes.
  const strong = useMemo(() => {
    if (reachState) {
      const nodes = new Set(reachState.nodes);
      nodes.add(reachState.origin);
      return { nodes, edges: reachState.edges, mode: reachState.direction as string };
    }
    const chapter = view ? geometry.views.find((v) => v.id === view) : undefined;
    if (chapter) {
      const nodes = new Set(chapter.focus);
      const edges = new Set(
        geometry.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)).map((e) => e.id),
      );
      return { nodes, edges, mode: 'view' };
    }
    if (focused) {
      const nodes = new Set<string>([focused.id]);
      const edges = new Set<string>();
      for (const e of geometry.edges) {
        if (e.from === focused.id || e.to === focused.id) {
          edges.add(e.id);
          nodes.add(e.from);
          nodes.add(e.to);
        }
      }
      return { nodes, edges, mode: 'focus' };
    }
    return null;
  }, [reachState, view, geometry, focused]);

  const onRootKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      setFinderOpen(true);
    } else if (e.key === 'Escape') {
      if (finderOpen) setFinderOpen(false);
      else if (reachState) setReachState(null);
      else if (focus) setFocus(null);
      else if (view) setView(null);
    } else if ((e.key === '+' || e.key === '=') && !typing) {
      setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1));
    } else if (e.key === '-' && !typing) {
      setZoomIndex((i) => Math.max(0, i - 1));
    } else if (e.key === '0' && !typing) {
      setZoomIndex(3);
    }
  };

  const zoom = ZOOMS[zoomIndex];
  const sections = focused && describe ? describe(focused.id) : [];

  return (
    <div
      className={`map map--${geometry.kind}${compact ? ' map--compact' : ''}`}
      tabIndex={0}
      onKeyDown={onRootKey}
      aria-label={ariaLabel ?? geometry.title}
    >
      {!compact && (
        <div className="map__head">
          <span className="map__pulse" aria-hidden />
          <div>
            <h3 className="map__title">{geometry.title}</h3>
            {geometry.subtitle && <p className="map__subtitle">{geometry.subtitle}</p>}
          </div>
        </div>
      )}

      {geometry.views.length > 0 && (
        <div className="map__views" role="group" aria-label="Guided views">
          <span className="map__viewslabel">Views</span>
          {geometry.views.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`chip${view === v.id ? ' is-active' : ''}`}
              aria-pressed={view === v.id}
              title={v.note}
              onClick={() => {
                setView(view === v.id ? null : v.id);
                setReachState(null);
              }}
            >
              {v.label}
            </button>
          ))}
          {view && (
            <button type="button" className="chip" onClick={() => setView(null)}>
              Show all
            </button>
          )}
        </div>
      )}

      <div className="map__panel">
        <div className="map__stage">
          <svg
            className={`map__svg${strong ? ` is-lensing is-${strong.mode}` : ''}`}
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            style={{ width: `${zoom * 100}%` }}
            role="group"
            aria-label={`${geometry.title} map`}
          >
            <defs>
              {(['default', 'main', 'security', 'dashed'] as const).map((m) => (
                <marker
                  key={m}
                  id={`${uid}-arrow-${m}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className={`map-arrow map-arrow--${m}`} />
                </marker>
              ))}
            </defs>

            {geometry.frames.map((f) => (
              <g key={f.id} className={`map-frame map-frame--${f.kind}`}>
                <rect
                  x={f.x}
                  y={f.y}
                  width={f.w}
                  height={f.h}
                  rx={f.kind === 'boundary' ? 12 : f.kind === 'exception' ? 8 : 10}
                />
                {f.kind !== 'exception' && (
                  <text
                    x={f.x + 14}
                    y={f.y + (f.kind === 'boundary' ? 18 : 22)}
                    className="map-frame__label"
                  >
                    {f.prefix ? `${f.prefix} / ${f.label}` : f.label}
                  </text>
                )}
              </g>
            ))}

            {geometry.edges.map((e) => (
              <EdgeView
                key={e.id}
                edge={e}
                uid={uid}
                dim={!!strong && !strong.edges.has(e.id)}
                strongMode={strong?.mode}
              />
            ))}

            {geometry.nodes.map((n) => {
              const b = beacons[n.id];
              const isFocus = focus === n.id;
              const dim = !!strong && !strong.nodes.has(n.id);
              const reachTone =
                reachState && reachState.nodes.has(n.id)
                  ? reachState.direction === 'upstream'
                    ? ' is-reach-up'
                    : ' is-reach-down'
                  : '';
              return (
                <g
                  key={n.id}
                  className={`map-node c-${n.type}${isFocus ? ' is-focus' : ''}${dim ? ' is-dim' : ''}${reachTone}`}
                  role="button"
                  tabIndex={0}
                  data-id={n.id}
                  aria-pressed={isFocus}
                  aria-label={`${n.label}${n.sublabel ? `, ${n.sublabel}` : ''}${b ? `, ${b.title ?? b.label}` : ''}`}
                  onClick={() => setFocus(isFocus ? null : n.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setFocus(isFocus ? null : n.id);
                    }
                  }}
                >
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} className="c-mask" />
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} className="map-node__box" />
                  <text
                    x={n.x + n.w / 2}
                    y={n.y + (n.sublabel ? n.h / 2 - 3 : n.h / 2 + 4)}
                    className="map-node__label"
                    fontSize={LABEL_SIZE(n.label, 11, 8, 13)}
                    textAnchor="middle"
                  >
                    {n.label}
                  </text>
                  {n.sublabel && (
                    <text
                      x={n.x + n.w / 2}
                      y={n.y + n.h / 2 + 11}
                      className="map-node__sublabel"
                      fontSize={LABEL_SIZE(n.sublabel, 8, 6, 16)}
                      textAnchor="middle"
                    >
                      {n.sublabel}
                    </text>
                  )}
                  {b && (
                    <g className={`map-beacon map-beacon--${b.tone}`}>
                      <title>{b.title ?? b.label}</title>
                      <rect x={n.x + n.w - 30} y={n.y - 7} width={34} height={12} rx={6} />
                      <text x={n.x + n.w - 13} y={n.y + 2} textAnchor="middle" fontSize={7}>
                        {b.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {finderOpen && (
          <Finder
            nodes={geometry.nodes}
            kindLabel={kindLabel}
            onSelect={(id) => {
              setFinderOpen(false);
              setFocus(id);
            }}
            onClose={() => setFinderOpen(false)}
          />
        )}

        {focused && !finderOpen && (
          <Passport
            node={focused}
            geometry={geometry}
            kindLabel={kindLabel(focused)}
            sections={sections}
            reach={reachState}
            onReach={(d) => setReachState(d ? computeReach(geometry, focused.id, d) : null)}
            onSelect={(id) => setFocus(id)}
            onClose={() => setFocus(null)}
            eyebrow={passportEyebrow}
          />
        )}

        <div className="map__nav" role="toolbar" aria-label="Map controls">
          {actions}
          <button
            type="button"
            aria-label="Find a node"
            title="Find a node (/)"
            aria-pressed={finderOpen}
            onClick={() => setFinderOpen((o) => !o)}
          >
            ⌕ Find
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out (−)"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            title="Reset zoom (0)"
            onClick={() => setZoomIndex(3)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in (+)"
            disabled={zoomIndex === ZOOMS.length - 1}
            onClick={() => setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1))}
          >
            +
          </button>
        </div>
      </div>

      {geometry.legend.length > 0 && (
        <ul className="map__legend" aria-label="Legend">
          {geometry.legend.map((l) => (
            <li key={l.kind} className="map__legenditem">
              <span className={`tone-dot tone-dot--${l.kind}`} aria-hidden />
              {l.label}
            </li>
          ))}
          {geometry.mainPath.length > 1 && (
            <li className="map__legenditem">
              <span className="map__legendmain" aria-hidden />
              main path
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function EdgeView({
  edge: e,
  uid,
  dim,
  strongMode,
}: {
  edge: MapEdge;
  uid: string;
  dim: boolean;
  strongMode?: string;
}) {
  const reachClass =
    !dim && strongMode === 'upstream'
      ? ' is-reach-up'
      : !dim && strongMode === 'downstream'
        ? ' is-reach-down'
        : '';
  const labelW = e.label ? e.label.length * 5 + 10 : 0;
  return (
    <g
      className={`map-edge map-edge--${e.marker} map-edge--role-${e.role}${dim ? ' is-dim' : ''}${reachClass}`}
    >
      <path d={e.d} markerEnd={`url(#${uid}-arrow-${e.marker})`} />
      {e.label && (
        <g className="map-edge__label">
          <rect
            x={e.lx - labelW / 2}
            y={e.ly - 7}
            width={labelW}
            height={14}
            rx={3}
            className="c-mask"
          />
          <text x={e.lx} y={e.ly + 3} textAnchor="middle" fontSize={8}>
            {e.label}
          </text>
        </g>
      )}
    </g>
  );
}

/** The legend word for a component kind, for hosts that build passports outside MapView. */
export function kindWord(geometry: MapGeometry, type: ComponentType): string {
  return geometry.legend.find((l) => l.kind === type)?.label ?? type;
}
