// The Machine Finder (specs/013, FR-5) — the palette re-homed as archify's Node Finder: a
// floating panel over the floor, opened with `/` or "+ Machine", docked open while the floor
// is empty. Search, tone-grouped machines, keyboard to add, drag still works.

import { useEffect, useMemo, useRef, useState } from 'react';
import { machineTone } from '../archify/vocabulary';
import { DRAG_MIME } from '../canvas/FactoryCanvas';
import { MACHINES, type MachineCategory, type MachineDef } from '../machines/registry';
import { useFactoryStore } from '../state/store';

const GROUPS: { category: MachineCategory; title: string }[] = [
  { category: 'trigger', title: 'Triggers' },
  { category: 'processor', title: 'Processors' },
  { category: 'sink', title: 'Sinks' },
];

export function MachineFinder({ onClose }: { onClose: () => void }) {
  const addMachineAuto = useFactoryStore((s) => s.addMachineAuto);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: MACHINES.filter(
          (m) =>
            m.category === g.category &&
            (!q ||
              m.label.toLowerCase().includes(q) ||
              m.type.includes(q) ||
              m.blurb.toLowerCase().includes(q)),
        ),
      })).filter((g) => g.items.length > 0),
    [q],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const indexOf = useMemo(() => new Map(flat.map((m, i) => [m.type, i])), [flat]);
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));

  const add = (m: MachineDef) => addMachineAuto(m.type);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = flat[activeIndex];
      if (hit) add(hit);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <aside
      className="finder finder--machines"
      role="dialog"
      aria-label="Machine finder"
      onKeyDown={onKey}
    >
      <div className="finder__head">
        <strong>Machine finder</strong>
        <button
          type="button"
          className="finder__close"
          aria-label="Close machine finder"
          onClick={onClose}
        >
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
          placeholder="Find a machine…"
          aria-label="Filter machines"
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
      <div
        className="finder__results finder__results--grouped"
        role="listbox"
        aria-label="Machines"
      >
        {groups.map((g) => (
          <div key={g.category} className="finder__group">
            <span className={`eyebrow finder__grouptitle finder__grouptitle--${g.category}`}>
              {g.title}
            </span>
            {g.items.map((m) => {
              const i = indexOf.get(m.type) ?? 0;
              const tone = machineTone(m.type).slice(2);
              return (
                <button
                  key={m.type}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`finder__result${i === activeIndex ? ' is-active' : ''}`}
                  draggable
                  title={`${m.blurb}\n\nClick or Enter to add · drag onto the floor`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add(m)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, m.type);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  <span className="finder__label">
                    <span className={`tone-dot tone-dot--${tone}`} aria-hidden />
                    <span aria-hidden>{m.icon}</span> {m.label}
                  </span>
                  <span className="finder__meta">{m.type}</span>
                </button>
              );
            })}
          </div>
        ))}
        {flat.length === 0 && <p className="finder__empty">No machine matches “{query}”.</p>}
      </div>
      <p className="finder__status">
        {flat.length} of {MACHINES.length} · Enter adds · drag onto the floor · Esc closes
      </p>
    </aside>
  );
}
