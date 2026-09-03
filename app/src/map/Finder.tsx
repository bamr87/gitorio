// The Node Finder (specs/013, FR-3) — archify's `/` search over labels and stable ids, as a
// floating panel over a map. Pure presentation: the host owns what "select" means.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapNode } from './layout';

export interface FinderProps {
  nodes: MapNode[];
  /** Human word for a node's kind (the legend label), for the result's meta line. */
  kindLabel: (node: MapNode) => string;
  onSelect: (id: string) => void;
  onClose: () => void;
  placeholder?: string;
  title?: string;
}

export function Finder({
  nodes,
  kindLabel,
  onSelect,
  onClose,
  placeholder = 'Find a machine by name or id…',
  title = 'Node finder',
}: FinderProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes.slice(0, 12);
    return nodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q) ||
          (n.sublabel ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [nodes, query]);

  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[activeIndex];
      if (hit) onSelect(hit.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="finder" role="dialog" aria-label={title} onKeyDown={onKey}>
      <div className="finder__head">
        <strong>{title}</strong>
        <button type="button" className="finder__close" aria-label="Close finder" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="finder__search">
        <span aria-hidden>⌕</span>
        <input
          ref={inputRef}
          className="finder__input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-label="Search nodes"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        <kbd className="kbd" aria-hidden>
          /
        </kbd>
      </div>
      <div className="finder__results" role="listbox" aria-label="Results">
        {results.map((n, i) => (
          <button
            key={n.id}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            className={`finder__result${i === activeIndex ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onSelect(n.id)}
          >
            <span className="finder__label">
              <span className={`tone-dot tone-dot--${n.type}`} aria-hidden />
              {n.label}
              {n.sublabel && <small> · {n.sublabel}</small>}
            </span>
            <span className="finder__meta">
              {kindLabel(n)} <code>{n.id}</code>
            </span>
          </button>
        ))}
      </div>
      {results.length === 0 && <p className="finder__empty">No node matches “{query}”.</p>}
      <p className="finder__status" aria-live="polite">
        {results.length} of {nodes.length} · ↑↓ to move · Enter to focus · Esc to close
      </p>
    </div>
  );
}
