// Build · Map mode (specs/013, FR-5): every assembly line on the floor, drawn as the archify
// map it compiles to — live, from the same `toWorkflowIR` the delivered maps use. Selection is
// shared with the floor: a machine selected there is the focused node here, a passport's
// "Edit on the floor" selects it back and returns to Floor mode. Telemetry LEDs and
// diagnostics ride on the nodes as evidence beacons; a delivered map is linked when the
// blueprint still hashes to what `npm run maps` rendered.

import { useEffect, useMemo, useRef, useState } from 'react';
import { safeId, toWorkflowIR } from '../archify/ir';
import { blueprintHash } from '../blueprint/types';
import { assemblyLines, compile } from '../compiler/compile';
import { describeTool, describeWorkflow } from '../compiler/describe';
import { machineDef } from '../machines/registry';
import { layoutWorkflow } from '../map/layout';
import { DELIVERED_MAPS, deliveredMapFor, deliveredMapUrl } from '../map/manifest';
import { MapView, type Beacon } from '../map/MapView';
import type { PassportSection } from '../map/Passport';
import { useBlueprintDiagnostics } from '../state/diagnostics';
import { useSettingsStore } from '../state/settings';
import { useFactoryStore } from '../state/store';
import { useTelemetryStore } from '../state/telemetry';
import { useUiStore } from '../state/ui';
import { Chip, Panel } from '../ui/primitives';

const AGENT_TYPES = new Set(['agent.claude', 'processor.feedback_controller']);
const LED_BEACON: Record<string, Beacon> = {
  on: { label: 'ok', tone: 'ok', title: 'Last run: success' },
  warn: { label: 'run', tone: 'warn', title: 'Run in progress' },
  bad: { label: 'fail', tone: 'bad', title: 'Last run: failed' },
};

export function LineMaps() {
  const nodes = useFactoryStore((s) => s.nodes);
  const edges = useFactoryStore((s) => s.edges);
  const meta = useFactoryStore((s) => s.meta);
  const selectedId = useFactoryStore((s) => s.selectedId);
  const setSelected = useFactoryStore((s) => s.setSelected);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  const setBuildMode = useUiStore((s) => s.setBuildMode);
  const theme = useSettingsStore((s) => s.theme);
  const statusByNode = useTelemetryStore((s) => s.statusByNode);
  const diags = useBlueprintDiagnostics();

  // eslint-disable-next-line react-hooks/exhaustive-deps -- toBlueprint reads the store; nodes/edges/meta are its inputs
  const bp = useMemo(() => toBlueprint(), [nodes, edges, meta, toBlueprint]);
  const hash = useMemo(() => blueprintHash(bp), [bp]);
  const compiled = useMemo(() => compile(bp), [bp]);
  const maps = useMemo(
    () =>
      assemblyLines(bp).map((line) => {
        const ir = toWorkflowIR(bp, line, { source: meta.repo || undefined });
        const irIds = new Set(ir.nodes.map((n) => n.id));
        // IR node id → blueprint node ids (a "+N more" node stands for several machines).
        const members = new Map<string, string[]>();
        for (const id of line.nodeIds) {
          const own = safeId(id);
          if (irIds.has(own)) members.set(own, [id]);
        }
        for (const n of ir.nodes) {
          if (members.has(n.id)) continue;
          const lane = n.lane;
          const rest = line.nodeIds.filter(
            (id) => !irIds.has(safeId(id)) && lanesMatch(bp, id, lane),
          );
          members.set(n.id, rest);
        }
        return { line, ir, geometry: layoutWorkflow(ir), members };
      }),
    [bp, meta.repo],
  );

  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  // Follow the floor's selection into the line that holds it; otherwise keep the last choice.
  const selectedLine = selectedId
    ? maps.find((m) => m.line.nodeIds.includes(selectedId))
    : undefined;
  const active = selectedLine ?? maps.find((m) => m.line.slug === activeSlug) ?? maps[0];
  useEffect(() => {
    if (active && active.line.slug !== activeSlug) setActiveSlug(active.line.slug);
  }, [active, activeSlug]);

  // Map focus is the floor's selection when a single machine stands behind the node; nodes
  // that are not machines (the compiler's guard, a collapsed "+N more") focus locally.
  // Effect order matters: a line change clears the focus first, then the selection (if it
  // lives in the new line) sets it — both run in the same commit, declaration order.
  const [focus, setFocusState] = useState<string | null>(null);
  const activeLineSlug = active?.line.slug ?? null;
  const prevLine = useRef(activeLineSlug);
  useEffect(() => {
    if (prevLine.current === activeLineSlug) return;
    prevLine.current = activeLineSlug;
    setFocusState(null);
  }, [activeLineSlug]);
  useEffect(() => {
    if (!active) return;
    if (selectedId && active.line.nodeIds.includes(selectedId)) {
      for (const [irId, ids] of active.members) if (ids.includes(selectedId)) setFocusState(irId);
    } else if (selectedId) {
      setFocusState(null);
    }
  }, [selectedId, active]);

  if (maps.length === 0) {
    return (
      <div className="tabpane linemaps">
        <Panel eyebrow="Map" title="No assembly line yet">
          <p className="tabpane__empty">
            Belt a trigger to a machine on the floor and it appears here as the map it compiles to.
          </p>
        </Panel>
      </div>
    );
  }
  if (!active) return null;

  const focusId = focus && active.geometry.nodes.some((n) => n.id === focus) ? focus : null;

  const beacons: Record<string, Beacon> = {};
  for (const [irId, ids] of active.members) {
    const led = ids.map((id) => statusByNode[id]).find((l) => l && l !== 'idle');
    if (led && LED_BEACON[led]) {
      beacons[irId] = LED_BEACON[led];
      continue;
    }
    const worst = ids.map((id) => diags.worstByNode.get(id)).find(Boolean);
    if (worst === 'error')
      beacons[irId] = { label: 'err', tone: 'bad', title: 'Compile error — open the passport' };
    else if (worst === 'warning')
      beacons[irId] = { label: 'warn', tone: 'warn', title: 'Compile warning — open the passport' };
  }

  const describe = (irId: string): PassportSection[] => {
    const ids = active.members.get(irId) ?? [];
    if (irId === 'guard-bot-actor') {
      return [
        {
          kind: 'note',
          text: 'The compiler’s bot-actor guard (ADR-009): the job runs only when the event’s sender is not a Bot, so the writes this line performs can never re-trigger it. Not a machine you placed — the YAML really carries it.',
        },
      ];
    }
    if (ids.length === 0) return [];
    if (ids.length > 1) {
      return [
        {
          kind: 'chips',
          title: `${ids.length} machines collapsed here`,
          chips: ids.map((id) => {
            const def = machineDef(nodes.find((n) => n.id === id)?.data.machineType ?? '');
            return {
              label: `${def?.icon ?? '◻'} ${def?.label ?? id}`,
              onClick: () => {
                setSelected(id);
                setBuildMode('floor');
              },
              title: 'Edit on the floor',
            };
          }),
        },
        {
          kind: 'note',
          text: 'A lane holds four nodes on the map; the rest collapse into this one. Every machine still compiles.',
        },
      ];
    }
    const id = ids[0];
    const node = nodes.find((n) => n.id === id);
    const def = node ? machineDef(node.data.machineType) : undefined;
    if (!node || !def) return [];
    const sections: PassportSection[] = [{ kind: 'note', text: def.blurb }];
    const dials = def.fields
      .map((f) => ({ label: f.label, value: node.data.config[f.key] }))
      .filter((d) => d.value !== undefined && d.value !== '' && d.value !== null)
      .map((d) => ({ label: d.label, value: String(d.value) }));
    if (dials.length) sections.push({ kind: 'facts', title: 'Dials', rows: dials });
    const nodeDiags = diags.byNode.get(id) ?? [];
    if (nodeDiags.length) {
      sections.push({
        kind: 'list',
        title: 'Diagnostics',
        tone: nodeDiags.some((d) => d.level === 'error') ? 'bad' : 'warn',
        items: nodeDiags.map((d) => `${d.level}: ${d.message}`),
      });
    }
    if (AGENT_TYPES.has(node.data.machineType)) {
      const wf = compiled.workflows.find((w) => w.filename === active.line.filename);
      const facts = wf ? describeWorkflow(wf.yaml) : null;
      if (facts?.agent) {
        sections.push({
          kind: 'facts',
          title: 'Capabilities · compiled',
          rows: [
            { label: 'model', value: facts.agent.model },
            ...(facts.agent.maxTurns
              ? [{ label: 'turns', value: String(facts.agent.maxTurns) }]
              : []),
            ...(facts.killSwitchVar
              ? [{ label: 'kill switch', value: `vars.${facts.killSwitchVar}` }]
              : []),
            ...(Object.keys(facts.permissions).length
              ? [
                  {
                    label: 'token',
                    value: Object.entries(facts.permissions)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(' '),
                  },
                ]
              : []),
          ],
        });
        sections.push({
          kind: 'list',
          title: 'This agent may',
          tone: 'ok',
          items: facts.agent.tools.length
            ? [...new Set(facts.agent.tools.map(describeTool))]
            : ['Read-only — no write tools granted.'],
        });
      }
    }
    const led = statusByNode[id];
    if (led && led !== 'idle') {
      sections.push({
        kind: 'facts',
        title: 'Telemetry',
        rows: [{ label: 'last run', value: LED_BEACON[led]?.title ?? led }],
      });
    }
    sections.push({
      kind: 'action',
      label: 'Edit on the floor',
      primary: true,
      onClick: () => {
        setSelected(id);
        setBuildMode('floor');
      },
    });
    return sections;
  };

  const delivered = deliveredMapFor(DELIVERED_MAPS, {
    type: 'workflow',
    slug: active.line.slug,
    hash,
  });

  return (
    <div className="tabpane linemaps">
      <div className="container">
        {maps.length > 1 && (
          <div className="linemaps__lines" role="group" aria-label="Assembly lines">
            {maps.map((m) => (
              <Chip
                key={m.line.slug}
                active={m.line.slug === active.line.slug}
                onClick={() => {
                  setActiveSlug(m.line.slug);
                  if (selectedId && !m.line.nodeIds.includes(selectedId)) setSelected(null);
                }}
                title={m.line.filename}
              >
                {m.line.name}
              </Chip>
            ))}
          </div>
        )}
        <MapView
          key={active.line.slug}
          geometry={active.geometry}
          beacons={beacons}
          describe={describe}
          focusId={focusId}
          onFocus={(irId) => {
            setFocusState(irId);
            const ids = irId ? (active.members.get(irId) ?? []) : [];
            setSelected(ids.length === 1 ? ids[0] : null);
          }}
          passportEyebrow="Machine passport"
          actions={
            delivered ? (
              <a
                href={deliveredMapUrl(delivered.slug, { theme })}
                target="_blank"
                rel="noreferrer"
                title="The map archify delivered for this exact blueprint — route probe, exports, presentation"
              >
                Open delivered map ↗
              </a>
            ) : undefined
          }
        />
        <p className="linemaps__note">
          Compiles to <code>{active.line.filename}</code>. Lanes are roles — what starts the line,
          what governs it, what thinks, what it emits — and the guard lane shows the actor check the
          YAML really carries.
          {!delivered &&
            ' A delivered map appears here once `npm run maps` has rendered this blueprint.'}
        </p>
      </div>
    </div>
  );
}

function lanesMatch(
  bp: ReturnType<typeof useFactoryStore.getState>['toBlueprint'] extends () => infer B ? B : never,
  id: string,
  lane: string,
): boolean {
  const node = bp.nodes.find((n) => n.id === id);
  if (!node) return false;
  const head = node.type.split('.')[0];
  const l =
    head === 'trigger'
      ? 'triggers'
      : head === 'sink'
        ? 'sinks'
        : head === 'gate' || head === 'rate' || head === 'filter'
          ? 'policy'
          : 'agent';
  return l === lane;
}
