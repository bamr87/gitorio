import { MACHINES, type MachineCategory } from '../machines/registry';
import { DRAG_MIME } from '../canvas/FactoryCanvas';

const GROUPS: { category: MachineCategory; title: string }[] = [
  { category: 'trigger', title: 'Triggers' },
  { category: 'processor', title: 'Processors' },
  { category: 'sink', title: 'Sinks' },
];

export function Palette() {
  return (
    <aside className="palette" aria-label="Machine palette">
      <div className="panel__eyebrow">Machines</div>
      {GROUPS.map(({ category, title }) => (
        <section key={category} className="palette__group">
          <h2 className={`palette__title palette__title--${category}`}>{title}</h2>
          {MACHINES.filter((m) => m.category === category).map((m) => (
            <div
              key={m.type}
              className={`palette__item palette__item--${category}`}
              draggable
              title={m.blurb}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, m.type);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <span aria-hidden>{m.icon}</span>
              <span>{m.label}</span>
            </div>
          ))}
        </section>
      ))}
      <p className="palette__hint">Drag a machine onto the floor, then belt out → in.</p>
    </aside>
  );
}
