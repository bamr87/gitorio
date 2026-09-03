// The Semantic Passport (specs/013, FR-4) — one focused node opens one compact proof surface:
// stable id, kind, authored metadata, authored reachability (Upstream / Downstream over the
// map's own edges), and whatever evidence the host adds through `sections`. Archify's rule:
// this is the single destination for details; new capabilities route here before anyone
// proposes another panel. Presentation only — no store access.

import type { ReactNode } from 'react';
import type { ComponentType } from '../archify/vocabulary';
import type { MapGeometry, MapNode, Reach } from './layout';

export type PassportTone = ComponentType | 'ok' | 'warn' | 'bad' | 'idle';

export type PassportSection =
  | { kind: 'facts'; title?: string; rows: { label: string; value: ReactNode }[] }
  | {
      kind: 'chips';
      title?: string;
      chips: { label: string; tone?: PassportTone; title?: string; onClick?: () => void }[];
    }
  | { kind: 'list'; title?: string; items: ReactNode[]; tone?: 'ok' | 'warn' | 'bad' }
  | { kind: 'note'; title?: string; text: ReactNode; level?: 'info' | 'warning' | 'error' }
  | { kind: 'action'; label: string; onClick?: () => void; href?: string; primary?: boolean }
  | { kind: 'custom'; title?: string; node: ReactNode };

export interface PassportProps {
  node: MapNode;
  geometry: MapGeometry;
  kindLabel: string;
  sections?: PassportSection[];
  reach: Reach | null;
  onReach: (direction: Reach['direction'] | null) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Eyebrow text — "Semantic passport" by default; hosts may say "Machine passport". */
  eyebrow?: string;
}

export function Passport({
  node,
  geometry,
  kindLabel,
  sections = [],
  reach,
  onReach,
  onSelect,
  onClose,
  eyebrow = 'Semantic passport',
}: PassportProps) {
  const byId = new Map(geometry.nodes.map((n) => [n.id, n]));
  const upstream = geometry.edges.filter((e) => e.to === node.id).map((e) => byId.get(e.from));
  const downstream = geometry.edges.filter((e) => e.from === node.id).map((e) => byId.get(e.to));
  const up = upstream.filter((n): n is MapNode => !!n);
  const down = downstream.filter((n): n is MapNode => !!n);

  const reachOn = (d: Reach['direction']) => reach?.direction === d && reach.origin === node.id;

  return (
    <aside
      className="passport"
      role="region"
      aria-label={`${eyebrow}: ${node.label}`}
      data-tone={node.type}
    >
      <div className="passport__head">
        <div className="passport__copy">
          <span className="passport__eyebrow">{eyebrow}</span>
          <strong className="passport__title">{node.label}</strong>
          {node.sublabel && <span className="passport__detail">{node.sublabel}</span>}
          <div className="passport__meta" aria-label="Metadata">
            <span className={`chip chip--tone chip--${node.type}`}>{kindLabel}</span>
            <code className="passport__id">{node.id}</code>
          </div>
        </div>
        <div className="passport__actions">
          <button
            type="button"
            className="passport__x"
            aria-label="Close passport"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      <div className="passport__reach">
        <span className="passport__label">Authored reach</span>
        <div className="passport__reachbtns" role="group" aria-label="Trace reachability">
          <button
            type="button"
            className="passport__reachbtn passport__reachbtn--up"
            aria-pressed={reachOn('upstream')}
            disabled={up.length === 0 && !reachOn('upstream')}
            onClick={() => onReach(reachOn('upstream') ? null : 'upstream')}
          >
            <span>Upstream</span>
            <strong>{up.length}</strong>
          </button>
          <button
            type="button"
            className="passport__reachbtn passport__reachbtn--down"
            aria-pressed={reachOn('downstream')}
            disabled={down.length === 0 && !reachOn('downstream')}
            onClick={() => onReach(reachOn('downstream') ? null : 'downstream')}
          >
            <span>Downstream</span>
            <strong>{down.length}</strong>
          </button>
        </div>
        {reach && reach.origin === node.id && (
          <small className="passport__receipt" aria-live="polite">
            {reach.direction} · {reach.nodes.size} node{reach.nodes.size === 1 ? '' : 's'} ·{' '}
            {reach.edges.size} link{reach.edges.size === 1 ? '' : 's'} · {reach.maxHops} hop
            {reach.maxHops === 1 ? '' : 's'} max
          </small>
        )}
      </div>

      {(up.length > 0 || down.length > 0) && (
        <div className="passport__section">
          <span className="passport__label">Relations</span>
          {up.length > 0 && (
            <div className="passport__rel">
              <span className="passport__relkey">← from</span>
              <span className="passport__chips">
                {up.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`chip chip--${n.type}`}
                    onClick={() => onSelect(n.id)}
                    title={`Focus ${n.label}`}
                  >
                    {n.label}
                  </button>
                ))}
              </span>
            </div>
          )}
          {down.length > 0 && (
            <div className="passport__rel">
              <span className="passport__relkey">→ to</span>
              <span className="passport__chips">
                {down.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`chip chip--${n.type}`}
                    onClick={() => onSelect(n.id)}
                    title={`Focus ${n.label}`}
                  >
                    {n.label}
                  </button>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

      {sections.map((s, i) => (
        <PassportSectionView key={i} section={s} />
      ))}
    </aside>
  );
}

export function PassportSectionView({ section: s }: { section: PassportSection }) {
  switch (s.kind) {
    case 'facts':
      return (
        <div className="passport__section">
          {s.title && <span className="passport__label">{s.title}</span>}
          <dl className="passport__facts">
            {s.rows.map((r, i) => (
              <div key={i} className="passport__fact">
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case 'chips':
      return (
        <div className="passport__section">
          {s.title && <span className="passport__label">{s.title}</span>}
          <span className="passport__chips">
            {s.chips.map((c, i) =>
              c.onClick ? (
                <button
                  key={i}
                  type="button"
                  className={`chip${c.tone ? ` chip--${c.tone}` : ''}`}
                  title={c.title}
                  onClick={c.onClick}
                >
                  {c.label}
                </button>
              ) : (
                <span key={i} className={`chip${c.tone ? ` chip--${c.tone}` : ''}`} title={c.title}>
                  {c.label}
                </span>
              ),
            )}
          </span>
        </div>
      );
    case 'list':
      return (
        <div className="passport__section">
          {s.title && <span className="passport__label">{s.title}</span>}
          <ul className={`passport__list${s.tone ? ` passport__list--${s.tone}` : ''}`}>
            {s.items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      );
    case 'note':
      return (
        <div className="passport__section">
          {s.title && <span className="passport__label">{s.title}</span>}
          <p className={`passport__note passport__note--${s.level ?? 'info'}`}>{s.text}</p>
        </div>
      );
    case 'action':
      return (
        <div className="passport__section passport__section--action">
          {s.href ? (
            <a
              className={`btn${s.primary ? ' btn--primary' : ''}`}
              href={s.href}
              target="_blank"
              rel="noreferrer"
              onClick={s.onClick}
            >
              {s.label}
            </a>
          ) : (
            <button
              type="button"
              className={`btn${s.primary ? ' btn--primary' : ''}`}
              onClick={s.onClick}
            >
              {s.label}
            </button>
          )}
        </div>
      );
    case 'custom':
      return (
        <div className="passport__section">
          {s.title && <span className="passport__label">{s.title}</span>}
          {s.node}
        </div>
      );
  }
}
