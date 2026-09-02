// The floor's passports (specs/013, FR-5). The Inspector used to be a permanent right-hand
// column; archify's DESIGN.md names that shape as the anti-pattern ("don't create another
// permanent panel when the Semantic Passport … can carry the capability"), so the same
// content — properties, diagnostics, compiled capabilities, connections, monitor — now opens
// as one floating Semantic Passport when a machine is selected and closes on × / Escape.
// The blueprint's own metadata is a second passport, opened from the toolbar title.

import { useMemo, useState } from 'react';
import { machineDef, type FieldDef } from '../machines/registry';
import { machineTone } from '../archify/vocabulary';
import { useFactoryStore, type MachineNodeType } from '../state/store';
import { useBlueprintDiagnostics } from '../state/diagnostics';
import { useTelemetryStore } from '../state/telemetry';
import { useUiStore } from '../state/ui';
import { assemblyLines, compile } from '../compiler/compile';
import { describeWorkflow, describeTool } from '../compiler/describe';
import type { Diagnostic } from '../compiler/compile';
import type { LedState } from '../github/types';

const AGENT_TYPES = new Set(['agent.claude', 'processor.feedback_controller']);

const DIAG_MARK: Record<Diagnostic['level'], string> = { error: '✗', warning: '⚠', info: 'ℹ' };
const LED_LABEL: Record<LedState, string> = {
  on: 'last run: success',
  warn: 'running',
  bad: 'last run: failed',
  idle: 'no recent run',
};

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

export function Field({
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
        <textarea
          id={id}
          rows={3}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
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
        <input
          id={id}
          type="text"
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
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
    <div className="passport__rel">
      <span className="passport__relkey">{label}</span>
      {ids.length === 0 ? (
        <span className="conn__empty">— {emptyHint}</span>
      ) : (
        <span className="passport__chips">
          {ids.map((id) => {
            const type = nodes.find((n) => n.id === id)?.data.machineType ?? '';
            const def = machineDef(type);
            return (
              <button
                key={id}
                type="button"
                className={`chip chip--${machineTone(type).slice(2)}`}
                onClick={() => onSelect(id)}
                title={`Select ${def?.label ?? id}`}
              >
                <span aria-hidden>{def?.icon ?? '◻'}</span> {def?.label ?? id}
              </button>
            );
          })}
        </span>
      )}
    </div>
  );
}

/** Which passport the floor shows: the selected machine's, the blueprint's, or none. */
export function Inspector() {
  const selectedId = useFactoryStore((s) => s.selectedId);
  const blueprintOpen = useUiStore((s) => s.blueprintPassportOpen);
  if (selectedId) return <MachinePassport id={selectedId} />;
  if (blueprintOpen) return <BlueprintPassport />;
  return null;
}

export function BlueprintPassport() {
  const nodes = useFactoryStore((s) => s.nodes);
  const edges = useFactoryStore((s) => s.edges);
  const meta = useFactoryStore((s) => s.meta);
  const setMeta = useFactoryStore((s) => s.setMeta);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  const close = useUiStore((s) => s.setBlueprintPassportOpen);
  const diags = useBlueprintDiagnostics();
  // toBlueprint reads the store; nodes/edges/meta are its real inputs, so they stay as deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lines = useMemo(() => assemblyLines(toBlueprint()), [nodes, edges, meta, toBlueprint]);
  return (
    <aside
      className="passport passport--floor"
      role="region"
      aria-label="Blueprint passport"
      data-tone="accent"
    >
      <div className="passport__head">
        <div className="passport__copy">
          <span className="passport__eyebrow">Blueprint passport</span>
          <strong className="passport__title">{meta.name || 'Untitled factory'}</strong>
          <div className="passport__meta">
            <span className="chip chip--accent">
              {nodes.length} machine{nodes.length === 1 ? '' : 's'}
            </span>
            <span className="chip">
              {edges.length} belt{edges.length === 1 ? '' : 's'}
            </span>
            <span className="chip">
              {lines.length} line{lines.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="passport__actions">
          <button
            type="button"
            className="passport__x"
            aria-label="Close passport"
            onClick={() => close(false)}
          >
            ×
          </button>
        </div>
      </div>
      <div className="passport__section">
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
      </div>
      <div className="passport__section">
        <span className="passport__label">Compile status</span>
        {diags.errorCount > 0 || diags.warningCount > 0 ? (
          <p className={`diag diag--${diags.errorCount > 0 ? 'error' : 'warning'}`}>
            {diags.errorCount} error{diags.errorCount === 1 ? '' : 's'} · {diags.warningCount}{' '}
            warning
            {diags.warningCount === 1 ? '' : 's'} — select a flagged machine to fix it
          </p>
        ) : (
          <p className="diag diag--info">✓ compiles clean</p>
        )}
        <p className="passport__note">
          Select a machine for its passport. Press <kbd className="kbd">/</kbd> to find a machine to
          add.
        </p>
      </div>
    </aside>
  );
}

export function MachinePassport({ id }: { id: string }) {
  const nodes = useFactoryStore((s) => s.nodes);
  const edges = useFactoryStore((s) => s.edges);
  const meta = useFactoryStore((s) => s.meta);
  const setSelected = useFactoryStore((s) => s.setSelected);
  const updateNodeConfig = useFactoryStore((s) => s.updateNodeConfig);
  const deleteNode = useFactoryStore((s) => s.deleteNode);
  const duplicateNode = useFactoryStore((s) => s.duplicateNode);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  const setBuildMode = useUiStore((s) => s.setBuildMode);

  const diags = useBlueprintDiagnostics();
  const statusByNode = useTelemetryStore((s) => s.statusByNode);
  const runs = useTelemetryStore((s) => s.runs);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- toBlueprint reads the store; nodes/edges/meta are its inputs
  const lines = useMemo(() => assemblyLines(toBlueprint()), [nodes, edges, meta, toBlueprint]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- same
  const compiled = useMemo(() => compile(toBlueprint()), [nodes, edges, meta, toBlueprint]);

  const nodeItem = nodes.find((n) => n.id === id);
  const def = nodeItem ? machineDef(nodeItem.data.machineType) : undefined;
  if (!nodeItem || !def) return null;

  const tone = machineTone(def.type).slice(2);
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
    <aside
      className="passport passport--floor"
      role="region"
      aria-label={`Machine passport: ${def.label}`}
      data-tone={tone}
    >
      <div className="passport__head">
        <div className="passport__copy">
          <span className="passport__eyebrow">Machine passport</span>
          <strong className="passport__title">
            <span aria-hidden>{def.icon}</span> {def.label}
          </strong>
          <div className="passport__meta">
            <span className={`chip chip--tone chip--${tone}`}>{def.category}</span>
            <code className="passport__id">{nodeItem.id}</code>
          </div>
        </div>
        <div className="passport__actions">
          <button
            type="button"
            className="iconbtn"
            title="View on the map"
            aria-label="View on the map"
            onClick={() => setBuildMode('map')}
          >
            🗺
          </button>
          <button
            type="button"
            className="iconbtn"
            title="Duplicate machine"
            aria-label="Duplicate machine"
            onClick={() => duplicateNode(nodeItem.id)}
          >
            ⧉
          </button>
          <button
            type="button"
            className="iconbtn iconbtn--danger"
            title="Delete machine"
            aria-label="Delete machine"
            onClick={() => deleteNode(nodeItem.id)}
          >
            🗑
          </button>
          <button
            type="button"
            className="passport__x"
            aria-label="Close passport"
            onClick={() => setSelected(null)}
          >
            ×
          </button>
        </div>
      </div>
      <p className="passport__note">{def.blurb}</p>

      {nodeDiags.length > 0 && (
        <div className="passport__section">
          <span className="passport__label">Diagnostics</span>
          {nodeDiags.map((d, i) => (
            <p key={i} className={`diag diag--${d.level}`}>
              {DIAG_MARK[d.level]} {d.message}
            </p>
          ))}
        </div>
      )}

      <div className="passport__section">
        <span className="passport__label">Properties</span>
        {def.fields.length === 0 && <p className="passport__note">No dials on this one.</p>}
        {def.fields.map((f) => (
          <Field
            key={f.key}
            field={f}
            value={nodeItem.data.config[f.key]}
            onChange={(v) => updateNodeConfig(nodeItem.id, f.key, v)}
          />
        ))}
      </div>

      {facts?.agent && (
        <div className="passport__section">
          <span className="passport__label">Capabilities · compiled</span>
          <p className="passport__note">
            {facts.agent.model}
            {facts.agent.maxTurns ? ` · ${facts.agent.maxTurns} turns` : ''}
            {facts.killSwitchVar && (
              <>
                {' '}
                ·{' '}
                <span className="cap-kill" title="default-OFF until the repo variable is true">
                  🔌 {facts.killSwitchVar}
                </span>
              </>
            )}
          </p>
          {facts.agent.tools.length > 0 ? (
            <>
              <div className="caps__label">This agent may:</div>
              <ul className="caps">
                {[...new Set(facts.agent.tools.map(describeTool))].map((c) => (
                  <li key={c} className="cap">
                    {c}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="passport__note">Read-only — no write tools granted.</p>
          )}
          {Object.keys(facts.permissions).length > 0 && (
            <p className="caps__perms">
              token:{' '}
              {Object.entries(facts.permissions)
                .map(([k, v]) => `${k}:${v}`)
                .join('  ')}
            </p>
          )}
          {facts.agent.obligations.length > 0 && (
            <details className="caps__oblig">
              <summary>
                {facts.agent.obligations.length} obligation
                {facts.agent.obligations.length === 1 ? '' : 's'}
              </summary>
              <ol>
                {facts.agent.obligations.map((o, i) => (
                  <li key={i}>{o.replace(/^\[[^\]]+\]\s*/, '')}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}

      <div className="passport__section">
        <span className="passport__label">Relations</span>
        <ConnRow
          label="← from"
          ids={upstream}
          nodes={nodes}
          onSelect={setSelected}
          emptyHint={
            def.category === 'trigger' ? 'a trigger — starts the line' : 'nothing upstream yet'
          }
        />
        <ConnRow
          label="→ to"
          ids={downstream}
          nodes={nodes}
          onSelect={setSelected}
          emptyHint={def.category === 'sink' ? 'a sink — ends the line' : 'nothing downstream yet'}
        />
      </div>

      <div className="passport__section">
        <span className="passport__label">Monitor</span>
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
          <p className="passport__note">
            line: <code>{line.filename}</code>
            {!latestRun && ' · turn on 📊 LEDs (Build toolbar) to poll runs'}
          </p>
        ) : (
          <p className="passport__note">Not on an assembly line yet — belt it to a trigger.</p>
        )}
      </div>
    </aside>
  );
}
