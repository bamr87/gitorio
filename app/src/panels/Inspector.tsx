import { machineDef, type FieldDef } from '../machines/registry';
import { useFactoryStore } from '../state/store';

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const common = { id: `f-${field.key}` };
  return (
    <label className="field" htmlFor={common.id}>
      <span className="field__label">{field.label}</span>
      {field.kind === 'textarea' ? (
        <textarea
          {...common}
          rows={3}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.kind === 'select' ? (
        <select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={field.kind === 'number' ? 'number' : 'text'}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) =>
            onChange(field.kind === 'number' ? Number(e.target.value) : e.target.value)
          }
        />
      )}
      {field.help && <span className="field__help">{field.help}</span>}
    </label>
  );
}

export function Inspector() {
  const selectedId = useFactoryStore((s) => s.selectedId);
  const nodes = useFactoryStore((s) => s.nodes);
  const meta = useFactoryStore((s) => s.meta);
  const setMeta = useFactoryStore((s) => s.setMeta);
  const updateNodeConfig = useFactoryStore((s) => s.updateNodeConfig);

  const nodeItem = nodes.find((n) => n.id === selectedId);
  const def = nodeItem ? machineDef(nodeItem.data.machineType) : undefined;

  return (
    <aside className="inspector" aria-label="Inspector">
      {nodeItem && def ? (
        <>
          <div className="panel__eyebrow">Machine · {nodeItem.id}</div>
          <h2 className="inspector__title">
            <span aria-hidden>{def.icon}</span> {def.label}
          </h2>
          <p className="inspector__blurb">{def.blurb}</p>
          {def.fields.length === 0 && <p className="inspector__blurb">No dials on this one.</p>}
          {def.fields.map((f) => (
            <Field
              key={f.key}
              field={f}
              value={nodeItem.data.config[f.key]}
              onChange={(v) => updateNodeConfig(nodeItem.id, f.key, v)}
            />
          ))}
        </>
      ) : (
        <>
          <div className="panel__eyebrow">Factory</div>
          <Field
            field={{ key: 'name', label: 'Name', kind: 'text', placeholder: 'Issue Triage Line' }}
            value={meta.name}
            onChange={(v) => setMeta({ name: String(v) })}
          />
          <Field
            field={{
              key: 'repo',
              label: 'Target repo',
              kind: 'text',
              placeholder: 'owner/name',
              help: 'Metadata only. Use Connect (top bar) to load/deploy against a live repo.',
            }}
            value={meta.repo}
            onChange={(v) => setMeta({ repo: String(v) })}
          />
          <Field
            field={{ key: 'description', label: 'Description', kind: 'textarea' }}
            value={meta.description}
            onChange={(v) => setMeta({ description: String(v) })}
          />
          <p className="inspector__blurb">Select a machine to tune its dials.</p>
        </>
      )}
    </aside>
  );
}
