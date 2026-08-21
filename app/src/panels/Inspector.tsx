import { useMemo, useState } from 'react';
import { machineDef, type FieldDef } from '../machines/registry';
import { useFactoryStore, type MachineNodeType } from '../state/store';
import { useBlueprintDiagnostics } from '../state/diagnostics';
import { useTelemetryStore } from '../state/telemetry';
import { assemblyLines, compile } from '../compiler/compile';
import { describeWorkflow, describeTool } from '../compiler/describe';
import type { Diagnostic } from '../compiler/compile';
import type { LedState } from '../github/types';

const AGENT_TYPES = new Set(['agent.claude', 'processor.feedback_controller']);

const DIAG_MARK: Record<Diagnostic['level'], string> = { error: '✗', warning: '⚠', info: 'ℹ' };
const LED_LABEL: Record<LedState, string> = { on: 'last run: success', warn: 'running', bad: 'last run: failed', idle: 'no recent run' };

function NumberInput({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  value: unknown;
  placeholder?: string;
  onChange: (v: unknown) => void;
}) {
  // Keep the raw string while editing so the field can be blanked (Number('') === 0 would
  // otherwise snap it back to 0). Blank commits undefined → the compiler's default applies.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      value={draft ?? String(value ?? '')}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw === '') onChange(undefined);
        else if (Number.isFinite(Number(raw))) onChange(Number(raw));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function Field({
  field,
  value,
  invalid,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  invalid?: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = `f-${field.key}`;
  return (
    <label className={`field${invalid ? ' field--invalid' : ''}`} htmlFor={id}>
      <span className="field__label">{field.label}</span>
      {field.kind === 'textarea' ? (
        <textarea id={id} rows={3} value={String(value ?? '')} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === 'select' ? (
        <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.kind === 'number' ? (
        <NumberInput id={id} value={value} placeholder={field.placeholder} onChange={onChange} />
      ) : (
        <input id={id} type="text" value={String(value ?? '')} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.help && <span className="field__help">{field.help}</span>}
    </label>
  );
}

function ConnRow({
  label,
  ids,
  nodes,
  onSelect,
  emptyHint,
}: {
  label: string;
  ids: string[];
  nodes: MachineNodeType[];
  onSelect: (id: string) => void;
  emptyHint: string;
}) {
  return (
    <div className="conn">
      <span className="conn__label">{label}</span>
      {ids.length === 0 ? (
        <span className="conn__empty">— {emptyHint}</span>
      ) : (
        <span className="conn__chips">
          {ids.map((id) => {
            const def = machineDef(nodes.find((n) => n.id === id)?.data.machineType ?? '');
            return (
              <button key={id} type="button" className="chip" onClick={() => onSelect(id)} title={`Select ${def?.label ?? id}`}>
                <span aria-hidden>{def?.icon ?? '◻'}</span> {id}
              </button>
            );
          })}
        </span>
      )}
    </div>
  );
}

export function Inspector() {
  const selectedId = useFactoryStore((s) => s.selectedId);
  const nodes = useFactoryStore((s) => s.nodes);
  const edges = useFactoryStore((s) => s.edges);
  const meta = useFactoryStore((s) => s.meta);
  const setMeta = useFactoryStore((s) => s.setMeta);
  const setSelected = useFactoryStore((s) => s.setSelected);
  const updateNodeConfig = useFactoryStore((s) => s.updateNodeConfig);
  const deleteNode = useFactoryStore((s) => s.deleteNode);
  const duplicateNode = useFactoryStore((s) => s.duplicateNode);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);

  const diags = useBlueprintDiagnostics();
  const statusByNode = useTelemetryStore((s) => s.statusByNode);
  const runs = useTelemetryStore((s) => s.runs);

  const lines = useMemo(() => assemblyLines(toBlueprint()), [nodes, edges, meta, toBlueprint]);
  const compiled = useMemo(() => compile(toBlueprint()), [nodes, edges, meta, toBlueprint]);

  const nodeItem = nodes.find((n) => n.id === selectedId);
  const def = nodeItem ? machineDef(nodeItem.data.machineType) : undefined;

  // ── Factory overview (nothing selected) ──────────────────────────────
  if (!nodeItem || !def) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="panel__eyebrow">Factory</div>
        <Field field={{ key: 'name', label: 'Name', kind: 'text', placeholder: 'Issue Triage Line' }} value={meta.name} onChange={(v) => setMeta({ name: String(v) })} />
        <Field
          field={{ key: 'repo', label: 'Target repo', kind: 'text', placeholder: 'owner/name', help: 'Metadata only. Use Connect (top bar) to load/deploy against a live repo.' }}
          value={meta.repo}
          onChange={(v) => setMeta({ repo: String(v) })}
        />
        <Field field={{ key: 'description', label: 'Description', kind: 'textarea' }} value={meta.description} onChange={(v) => setMeta({ description: String(v) })} />

        <div className="inspector__section">
          <div className="inspector__eyebrow">Overview</div>
          <p className="inspector__blurb">
            {nodes.length} machines · {edges.length} belts · {lines.length} assembly line{lines.length === 1 ? '' : 's'}
          </p>
          {diags.errorCount > 0 || diags.warningCount > 0 ? (
            <p className={`diag diag--${diags.errorCount > 0 ? 'error' : 'warning'}`}>
              {diags.errorCount} error{diags.errorCount === 1 ? '' : 's'} · {diags.warningCount} warning{diags.warningCount === 1 ? '' : 's'} — select a flagged machine to fix it
            </p>
          ) : (
            <p className="diag diag--info">✓ compiles clean</p>
          )}
        </div>
        <p className="inspector__blurb">Select a machine to view its properties, diagnostics, connections, and runs. Click a palette item to drop one on the floor.</p>
      </aside>
    );
  }

  const nodeDiags = diags.byNode.get(nodeItem.id) ?? [];
  const upstream = edges.filter((e) => e.target === nodeItem.id).map((e) => e.source);
  const downstream = edges.filter((e) => e.source === nodeItem.id).map((e) => e.target);
  const led = statusByNode[nodeItem.id] ?? 'idle';
  const line = lines.find((l) => l.nodeIds.includes(nodeItem.id));
  const latestRun = line ? runs.find((r) => r.slug === line.slug) : undefined;

  // Drill-down: what this agent is ACTUALLY granted, parsed from the compiled workflow.
  const isAgent = AGENT_TYPES.has(nodeItem.data.machineType);
  const facts =
    isAgent && line
      ? describeWorkflow(compiled.workflows.find((w) => w.filename === line.filename)?.yaml ?? '')
      : null;

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="panel__eyebrow">Machine · {nodeItem.id}</div>
      <div className="inspector__titlerow">
        <h2 className="inspector__title">
          <span aria-hidden>{def.icon}</span> {def.label}
        </h2>
        <div className="inspector__actions">
          <button type="button" className="iconbtn" title="Duplicate machine" onClick={() => duplicateNode(nodeItem.id)}>
            ⧉
          </button>
          <button type="button" className="iconbtn iconbtn--danger" title="Delete machine" onClick={() => deleteNode(nodeItem.id)}>
            🗑
          </button>
        </div>
      </div>
      <p className="inspector__blurb">{def.blurb}</p>

      {nodeDiags.length > 0 && (
        <div className="inspector__section">
          <div className="inspector__eyebrow">Diagnostics</div>
          {nodeDiags.map((d, i) => (
            <p key={i} className={`diag diag--${d.level}`}>
              {DIAG_MARK[d.level]} {d.message}
            </p>
          ))}
        </div>
      )}

      <div className="inspector__section">
        <div className="inspector__eyebrow">Properties</div>
        {def.fields.length === 0 && <p className="inspector__blurb">No dials on this one.</p>}
        {def.fields.map((f) => (
          <Field key={f.key} field={f} value={nodeItem.data.config[f.key]} onChange={(v) => updateNodeConfig(nodeItem.id, f.key, v)} />
        ))}
      </div>

      {facts?.agent && (
        <div className="inspector__section">
          <div className="inspector__eyebrow">Capabilities · compiled</div>
          <p className="inspector__blurb">
            {facts.agent.model}
            {facts.agent.maxTurns ? ` · ${facts.agent.maxTurns} turns` : ''}
            {facts.killSwitchVar && (
              <> · <span className="cap-kill" title="default-OFF until the repo variable is true">🔌 {facts.killSwitchVar}</span></>
            )}
          </p>
          {facts.agent.tools.length > 0 ? (
            <>
              <div className="caps__label">This agent may:</div>
              <ul className="caps">
                {[...new Set(facts.agent.tools.map(describeTool))].map((c) => (
                  <li key={c} className="cap">{c}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="inspector__blurb">Read-only — no write tools granted.</p>
          )}
          {Object.keys(facts.permissions).length > 0 && (
            <p className="caps__perms">
              token: {Object.entries(facts.permissions).map(([k, v]) => `${k}:${v}`).join('  ')}
            </p>
          )}
          {facts.agent.obligations.length > 0 && (
            <details className="caps__oblig">
              <summary>{facts.agent.obligations.length} obligation{facts.agent.obligations.length === 1 ? '' : 's'}</summary>
              <ol>
                {facts.agent.obligations.map((o, i) => (
                  <li key={i}>{o.replace(/^\[[^\]]+\]\s*/, '')}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}

      <div className="inspector__section">
        <div className="inspector__eyebrow">Connections</div>
        <ConnRow label="Feeds from" ids={upstream} nodes={nodes} onSelect={setSelected} emptyHint={def.category === 'trigger' ? 'a trigger — starts the line' : 'nothing upstream yet'} />
        <ConnRow label="Feeds into" ids={downstream} nodes={nodes} onSelect={setSelected} emptyHint={def.category === 'sink' ? 'a sink — ends the line' : 'nothing downstream yet'} />
      </div>

      <div className="inspector__section">
        <div className="inspector__eyebrow">Monitor</div>
        <div className="inspector__monitor">
          <span className={`led led--${led}`} />
          <span className="inspector__monitorlbl">{LED_LABEL[led]}</span>
          {latestRun && (
            <a className="btn btn--small" href={latestRun.htmlUrl} target="_blank" rel="noreferrer">
              open run ↗
            </a>
          )}
        </div>
        {line ? (
          <p className="inspector__blurb">
            line: <code>{line.filename}</code>
            {!latestRun && ' · turn on 📊 LEDs (Build toolbar) to poll runs'}
          </p>
        ) : (
          <p className="inspector__blurb">Not on an assembly line yet — belt it to a trigger.</p>
        )}
      </div>
    </aside>
  );
}
