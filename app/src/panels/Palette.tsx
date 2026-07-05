import { useState } from 'react';
import { MACHINES, type MachineCategory } from '../machines/registry';
import { DRAG_MIME } from '../canvas/FactoryCanvas';
import { useFactoryStore } from '../state/store';

const GROUPS: { category: MachineCategory; title: string }[] = [
  { category: 'trigger', title: 'Triggers' },
  { category: 'processor', title: 'Processors' },
  { category: 'sink', title: 'Sinks' },
];

export function Palette() {
  const addMachineAuto = useFactoryStore((s) => s.addMachineAuto);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = (m: (typeof MACHINES)[number]) =>
    !q || m.label.toLowerCase().includes(q) || m.type.includes(q) || m.blurb.toLowerCase().includes(q);
  return (
    <aside className="palette" aria-label="Machine palette">
      <div className="panel__eyebrow">Machines</div>
      <input
        className="palette__search"
        type="search"
        placeholder="Filter machines…"
        aria-label="Filter machines"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {GROUPS.map(({ category, title }) => (
        <section key={category} className="palette__group">
          <h2 className={`palette__title palette__title--${category}`}>{title}</h2>
          {MACHINES.filter((m) => m.category === category && matches(m)).map((m) => (
            <button
              key={m.type}
              type="button"
              className={`palette__item palette__item--${category}`}
              draggable
              title={`${m.blurb}\n\nClick to add · or drag onto the floor`}
              onClick={() => addMachineAuto(m.type)}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, m.type);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <span aria-hidden>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </section>
      ))}
      <p className="palette__hint">Click a machine to drop it, or drag it onto the floor. Then belt out → in.</p>
    </aside>
  );
}
