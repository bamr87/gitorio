// The Harness tab (specs/014, FR-5): the hub's /harness/ page — "Agent = Model + Harness",
// the KPI row, the snapshot line, the trip wires, the scorecard, the illustrated loops — with
// the same numbers, vocabulary, thresholds and statuses, drawn in the Evidence Console's
// tokens rather than Bootstrap's. Two sources: Hub (the health file the hub committed, read
// back and re-derived in-app by the ported engine) and Live (the six wires evaluated over a
// Fleet Ops scan). Below the hub's anatomy: design readiness for the blueprint on the floor
// and the fleet/v1 lanes it compiles to — what GitFactory adds as the design tool.

import '../harness/harness.css';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { isDemoActive } from '../demo/seed';
import { HarnessCard } from '../harness/HarnessCard';
import {
  harnessHealth,
  SCORECARD_KEYS,
  SIGNAL_NAMES,
  type HarnessConfig,
  type HarnessHealth,
  type Metric,
} from '../harness/health';
import { toFleetLanes } from '../harness/lanes';
import { blueprintReadiness, type LayerStatus } from '../harness/readiness';
import { liveSignals, type LiveScan } from '../harness/signals';
import { DiagramFrame } from '../map/DiagramFrame';
import { useFactoryStore } from '../state/store';
import { useFleetOpsStore, type RepoSnapshot } from '../state/fleetops';
import { useGithubStore } from '../state/github';
import {
  HUB_DIAGRAMS,
  HUB_PATHS,
  hubDiagramUrl,
  hubFileUrl,
  hubPagesUrl,
  useHubStore,
  type HubSnapshot,
} from '../state/hub';
import { useSettingsStore } from '../state/settings';
import { useUiStore } from '../state/ui';
import { Beacon, Chip, Kbd, PageHeader, Panel, type Tone } from '../ui/primitives';
import { ConnectDialog } from './ConnectDialog';
import { DemoInvite } from './DemoBanner';

type Source = 'hub' | 'live';

const LEAD =
  'The model reasons; everything else — guides, sensors, bounded loops, memory, permissions, observability — is the harness. GitFactory designs it; the hub presents and monitors it. Same engine, same thresholds, same numbers.';

const DIRECTION_WORD: Record<Metric['direction'], string> = {
  up: '↑ higher',
  down: '↓ lower',
  steady: '→ steady',
};
const LAYER_TONE: Record<LayerStatus, Tone> = { ok: 'ok', warn: 'warn', missing: 'bad', 'n/a': 'idle' };
const metricValue = (m: Metric): string => (m.value === null ? '—' : String(m.value));

/** GitFactory's delivered maps stand in for the hub's diagrams when the hub has no Pages (the demo). */
const DEMO_DIAGRAMS = [
  { slug: 'demo--fleet', title: 'The demo fleet — three repos, as archify delivers it' },
  { slug: 'docs-gardener', title: 'docs-gardener — the governed content line, as delivered' },
  { slug: 'gitorio-factory-1', title: 'gitorio-factory-1 — a compiled GitFactory line, as delivered' },
];

/** A Fleet Ops scan as the live adapter's input — null until the roster has been scanned. */
function liveScanOf(
  snapshots: Record<string, RepoSnapshot>,
  rollup: LiveScan['rollup'] | null,
  workflows: LiveScan['workflows'],
): LiveScan | null {
  if (!rollup) return null;
  const repos = Object.values(snapshots);
  const scannedAtMs = Math.max(0, ...repos.map((s) => s.scannedAt ?? 0));
  if (!scannedAtMs) return null;
  return { rollup, workflows, repos, scannedAt: new Date(scannedAtMs) };
}

export function HarnessPanel() {
  const client = useGithubStore((s) => s.client);
  const login = useGithubStore((s) => s.login);
  const hubSlug = useHubStore((s) => s.hubSlug);
  const hubStatus = useHubStore((s) => s.status);
  const hubError = useHubStore((s) => s.error);
  const snapshot = useHubStore((s) => s.snapshot);
  const refresh = useHubStore((s) => s.refresh);
  const setView = useUiStore((s) => s.setView);
  const [source, setSource] = useState<Source>('hub');
  const [connectOpen, setConnectOpen] = useState(false);
  const demo = !!client && isDemoActive();

  // The hub is read when the tab opens and whenever the slug changes; Refresh is manual after that.
  useEffect(() => {
    if (client && hubStatus === 'idle') void refresh();
  }, [client, hubStatus, refresh]);

  if (!login) {
    return (
      <div className="tabpane harness">
        <PageHeader eyebrow="🧬 Harness" title="Agent = Model + Harness" subtitle={LEAD} />
        <p className="tabpane__empty">
          Connect a token to read the hub’s harness health, or explore the demo.{' '}
          <button type="button" className="btn btn--small" onClick={() => setConnectOpen(true)}>
            Connect
          </button>
        </p>
        <DemoInvite />
        {connectOpen && <ConnectDialog onClose={() => setConnectOpen(false)} />}
      </div>
    );
  }

  const config = snapshot?.config;
  const hubUrl = hubPagesUrl(hubSlug);
  return (
    <div className="tabpane harness">
      <PageHeader
        eyebrow="🧬 Harness"
        title="Agent = Model + Harness"
        subtitle={LEAD}
        live={hubStatus === 'loading'}
      >
        <div className="harness__src" role="group" aria-label="Source">
          <Chip active={source === 'hub'} onClick={() => setSource('hub')} title={`The health file ${hubSlug} committed`}>
            Hub
          </Chip>
          <Chip active={source === 'live'} onClick={() => setSource('live')} title="The six wires over a Fleet Ops scan">
            Live
          </Chip>
        </div>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => void refresh()}
          disabled={hubStatus === 'loading'}
          title={`Re-read ${hubSlug}`}
        >
          {hubStatus === 'loading' ? 'Reading…' : 'Refresh'}
        </button>
      </PageHeader>

      <p className="harness__snapshot">
        Hub <code>{hubSlug}</code>
        {snapshot?.pulseCron ? (
          <>
            {' '}
            · pulse <code>{snapshot.pulseCron}</code>
          </>
        ) : null}
        {snapshot ? (
          <>
            {' '}
            · thresholds{' '}
            {snapshot.found[HUB_PATHS.config] ? (
              <code>{HUB_PATHS.config}</code>
            ) : (
              <span>defaults (no {HUB_PATHS.config})</span>
            )}
          </>
        ) : null}
        {' · '}
        <button type="button" className="btn btn--small" onClick={() => setView('settings')} title="Change the hub in Settings">
          Change
        </button>
        {!demo && hubUrl && (
          <>
            {' · '}
            <a href={hubUrl} target="_blank" rel="noreferrer">
              Open on the hub ↗
            </a>
          </>
        )}
        {demo && <> · a fictional hub; the real one is bamr87/bamr87</>}
      </p>

      {source === 'hub' ? (
        <HubSource hubSlug={hubSlug} status={hubStatus} error={hubError} snapshot={snapshot} />
      ) : (
        <LiveSource config={config} />
      )}

      <Illustrated demo={demo} hubSlug={hubSlug} />
      <Readiness />
      <Lanes snapshot={snapshot} demo={demo} />
    </div>
  );
}

function HubSource({
  hubSlug,
  status,
  error,
  snapshot,
}: {
  hubSlug: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  snapshot: HubSnapshot | null;
}) {
  if (status === 'error') {
    return (
      <Panel tone="security" eyebrow="Hub">
        <p className="harness__note harness__note--bad">{error}</p>
      </Panel>
    );
  }
  if (!snapshot) {
    return (
      <Panel eyebrow="Hub">
        <p className="harness__lead">Reading {hubSlug}…</p>
      </Panel>
    );
  }
  const anySignal = SIGNAL_NAMES.some((n) => !!snapshot.signals[n]);
  if (!snapshot.committed && !anySignal) {
    return (
      <Panel eyebrow="Hub">
        <p className="harness__lead">
          <code>{hubSlug}</code> has no <code>{HUB_PATHS.health}</code> and no fleet signals under{' '}
          <code>_data/</code> to derive one from. Point Settings at a hub that runs{' '}
          <code>dash-gen harness</code>, or flip the source to Live.
        </p>
      </Panel>
    );
  }
  const health = snapshot.committed ?? snapshot.recomputed;
  let parity: ReactNode;
  if (!snapshot.committed) {
    parity = (
      <p className="harness__note harness__note--warn">
        Derived in-app from the hub’s committed signals — the hub has not published{' '}
        <code>{HUB_PATHS.health}</code> yet.
      </p>
    );
  } else if (snapshot.parity.length === 0) {
    parity = (
      <p className="harness__note harness__note--ok">
        ✓ Re-derived in-app by the ported engine over the hub’s committed signals: every value,
        status and wire matches the file the hub published.
      </p>
    );
  } else {
    parity = (
      <p className="harness__note harness__note--warn">
        ⚠ {snapshot.parity.length} difference{snapshot.parity.length === 1 ? '' : 's'} between the
        committed file and the in-app recomputation —{' '}
        {snapshot.parity
          .slice(0, 3)
          .map((d) => `${d.where}: ${d.committed} → ${d.recomputed}`)
          .join('; ')}
        {snapshot.parity.length > 3 ? '; …' : ''}. The hub’s signals moved since its pulse, or the
        thresholds differ.
      </p>
    );
  }
  return (
    <>
      <HealthView health={health} config={snapshot.config} />
      {parity}
    </>
  );
}

function LiveSource({ config }: { config: HarnessConfig | undefined }) {
  const totals = useFleetOpsStore((s) => s.totals);
  const fleetMetrics = useFleetOpsStore((s) => s.fleetMetrics);
  const snapshots = useFleetOpsStore((s) => s.snapshots);
  const roster = useFleetOpsStore((s) => s.roster);
  const scanning = useFleetOpsStore((s) => s.scanning);
  const scanFleet = useFleetOpsStore((s) => s.scanFleet);
  const setView = useUiStore((s) => s.setView);
  const health = useMemo(() => {
    const scan = liveScanOf(snapshots, totals, fleetMetrics);
    return scan ? harnessHealth(liveSignals(scan), config, scan.scannedAt) : null;
  }, [snapshots, totals, fleetMetrics, config]);

  if (!health) {
    return (
      <Panel eyebrow="Live">
        <p className="harness__lead">
          The six wires evaluated over a Fleet Ops scan of your roster — no hub needed.{' '}
          {roster.length ? 'Scan the roster to evaluate it.' : 'Build a roster in Fleet › Command first.'}
        </p>
        <div className="harness__links">
          {roster.length > 0 ? (
            <button type="button" className="btn btn--small" disabled={scanning} onClick={() => void scanFleet()}>
              {scanning ? 'Scanning…' : 'Scan fleet'}
            </button>
          ) : (
            <button type="button" className="btn btn--small" onClick={() => setView('fleet')}>
              Open Fleet
            </button>
          )}
        </div>
      </Panel>
    );
  }
  return (
    <>
      <HealthView health={health} config={health ? (config ?? null) : null} />
      <p className="harness__note">
        Live reads what a scan can see — Actions runs. The issue pipeline and token rotation are
        hub loops, so their sources read as missing here and <code>stale-data</code> trips by
        design; the hub’s committed signals carry them.
      </p>
    </>
  );
}

function Stat({ num, label, tone }: { num: string; label: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className={`harness__stat${tone ? ` harness__stat--${tone}` : ''}`}>
      <span className="harness__num">{num}</span>
      <span className="harness__lbl">{label}</span>
    </div>
  );
}

function DetailLine({ d }: { d: Record<string, unknown> }) {
  if (typeof d.source === 'string') {
    const age = d.age_days;
    return (
      <>
        <code>{d.source}</code>
        {age === null || age === undefined ? ' — missing' : ` — ${String(age)}d old`}
      </>
    );
  }
  const repo = typeof d.repo === 'string' ? d.repo : null;
  const wf = typeof d.workflow === 'string' ? d.workflow : null;
  if (repo || wf) {
    const avg = d.avg_min;
    return (
      <>
        {repo}
        {repo && wf ? ' · ' : ''}
        {wf && <code>{wf}</code>}
        {avg !== null && avg !== undefined ? ` — ${String(avg)} min avg over ${String(d.runs ?? '?')} runs` : ''}
      </>
    );
  }
  return (
    <>
      {Object.entries(d)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(' · ')}
    </>
  );
}

/** The hub's page body: KPI row, snapshot line, trip wires, scorecard — shared by both sources. */
function HealthView({ health, config }: { health: HarnessHealth; config: HarnessConfig | null }) {
  const tripped = health.trip_wires.filter((w) => w.tripped);
  const sc = health.scorecard;
  const floor = (m: Metric, fallback: number | undefined): string =>
    String(m.threshold ?? fallback ?? '—');
  return (
    <>
      <div className="harness__hud" role="group" aria-label="Harness KPIs">
        <Stat
          num={`${tripped.length} / ${health.trip_wires.length}`}
          label="Trip wires tripped"
          tone={tripped.length > 0 ? 'bad' : 'ok'}
        />
        <Stat
          num={`${metricValue(sc.completion_rate_pct)}%`}
          label={`Completion rate (floor ${floor(sc.completion_rate_pct, config?.scorecard.completion_rate_min_pct)})`}
        />
        <Stat
          num={`${metricValue(sc.effectiveness_pct)}%`}
          label={`Effectiveness (floor ${floor(sc.effectiveness_pct, config?.scorecard.effectiveness_min_pct)})`}
        />
        <Stat num={metricValue(sc.standing_failures)} label="Standing failures" />
      </div>

      <p className="harness__snapshot">
        Snapshot {health.generated_at} · inputs:
        {SIGNAL_NAMES.map((n) => {
          const s = health.sources[n];
          return (
            <span key={n}>
              {' '}
              <code>{n}</code>
              {s.present ? ` (${s.age_days ?? '?'}d)` : <span className="harness__missing"> missing</span>}
            </span>
          );
        })}
        .
      </p>

      <Panel eyebrow="Trip wires">
        <p className="harness__lead">
          A tripped wire is an <strong>attention item, not an action</strong> — the doctor, issue
          pipeline, and rotation loops own the fixes. Every wire is listed, armed or tripped, so a
          quiet panel is distinguishable from a lost one.
        </p>
        <div className="harness__tablewrap">
          <table className="harness__table" aria-label="Trip wires">
            <thead>
              <tr>
                <th>State</th>
                <th>Wire</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {health.trip_wires.map((w) => (
                <tr key={w.id} className={w.tripped ? 'is-tripped' : undefined}>
                  <td>
                    <Beacon label={w.tripped ? 'TRIPPED' : 'armed'} tone={w.tripped ? 'bad' : 'ok'} />
                  </td>
                  <td>
                    <code>{w.id}</code>
                  </td>
                  <td>
                    {w.summary}
                    {w.detail && w.detail.length > 0 ? (
                      <ul>
                        {w.detail.slice(0, 8).map((d, i) => (
                          <li key={i}>
                            <DetailLine d={d} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel eyebrow="Scorecard">
        <div className="harness__tablewrap">
          <table className="harness__table" aria-label="Scorecard">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Value</th>
                <th>Better</th>
                <th>Threshold</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {SCORECARD_KEYS.map((k) => {
                const m = sc[k];
                return (
                  <tr key={k} className={m.status === 'warn' ? 'is-breach' : undefined}>
                    <td>
                      <code>{k}</code>
                    </td>
                    <td className="num">{metricValue(m)}</td>
                    <td>{DIRECTION_WORD[m.direction]}</td>
                    <td>{m.threshold ?? '—'}</td>
                    <td>{m.status ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/** "How it runs — illustrated": the hub's five archify diagrams, or GitFactory's delivered maps in the demo. */
function Illustrated({ demo, hubSlug }: { demo: boolean; hubSlug: string }) {
  const theme = useSettingsStore((s) => s.theme);
  const query = `?embed=1${theme !== 'system' ? `&theme=${theme}` : ''}`;
  return (
    <Panel eyebrow="How it runs — illustrated" title={demo ? 'GitFactory’s delivered maps' : `${hubSlug}’s diagrams`}>
      <p className="harness__lead">
        {demo
          ? 'The demo hub has no Pages site, so GitFactory’s own delivered maps stand in — the same archify renderer the hub compiles its diagrams with.'
          : 'Interactive diagrams authored as typed JSON in the hub’s diagrams/ and compiled by the vendored archify skill. Each opens standalone with search, focus, route tracing, dark/light theme, and export. Guided chapters are in the ▶ views menu.'}
      </p>
      {demo
        ? DEMO_DIAGRAMS.map((d, i) => (
            <details key={d.slug} className="harness__diagram" open={i === 0}>
              <summary>{d.title}</summary>
              <DiagramFrame slug={d.slug} caption={d.title} height={520} />
            </details>
          ))
        : HUB_DIAGRAMS.map((d, i) => {
            const url = hubDiagramUrl(hubSlug, d.file);
            if (!url) return null;
            return (
              <details key={d.file} className="harness__diagram" open={i === 0}>
                <summary>
                  {d.title}
                  <a className="btn btn--small" href={url} target="_blank" rel="noreferrer">
                    Open standalone ↗
                  </a>
                </summary>
                <iframe src={`${url}${query}`} title={d.title} loading="lazy" />
              </details>
            );
          })}
    </Panel>
  );
}

/** The six layers and the twelve-row checklist, read off the blueprint on the floor (FR-8). */
function Readiness() {
  const nodes = useFactoryStore((s) => s.nodes);
  const edges = useFactoryStore((s) => s.edges);
  const meta = useFactoryStore((s) => s.meta);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  const setView = useUiStore((s) => s.setView);
  // toBlueprint reads the store; nodes/edges/meta are its real inputs, so they stay as deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const r = useMemo(() => blueprintReadiness(toBlueprint()), [nodes, edges, meta, toBlueprint]);
  return (
    <Panel
      eyebrow="Design readiness"
      title={`${meta.name || 'Untitled factory'} — ${r.score}/100`}
      actions={
        <button type="button" className="btn btn--small" onClick={() => setView('build')}>
          Edit on the floor
        </button>
      }
    >
      <p className="harness__lead">
        The hub’s six layers — guides, sensors, bounded loop, memory, permissions, observability —
        read off the blueprint on the floor, and its twelve-row production-readiness checklist.
        Deterministic lines are not harnesses; their agent-only layers read n/a.
      </p>
      {r.lines.length === 0 ? (
        <p className="harness__note">
          The floor is empty — press <Kbd>/</Kbd> on Build to add machines.
        </p>
      ) : (
        <div className="harness__readiness">
          {r.lines.map((l) => (
            <details key={l.line.filename} className="harness__line">
              <summary>
                <strong>{l.line.filename}</strong>
                {!l.hasAgent && <Chip tone="idle">deterministic</Chip>}
                <span className="harness__layers">
                  {l.layers.map((x) => (
                    <Chip key={x.id} tone={LAYER_TONE[x.status]} title={[...x.evidence, ...x.gaps].join('\n')}>
                      {x.label} · {x.status}
                    </Chip>
                  ))}
                </span>
                <span className="harness__score">{l.hasAgent ? `${l.score}/100` : 'n/a'}</span>
              </summary>
              <ul className="harness__layerlist">
                {l.layers.map((x) => (
                  <li key={x.id}>
                    <span>{x.label}</span>
                    <span>
                      {x.evidence.length > 0 && <span className="harness__evidence">{x.evidence.join(' · ')}</span>}
                      {x.gaps.map((g) => (
                        <div key={g} className="harness__gap">
                          → {g}
                        </div>
                      ))}
                      {x.evidence.length === 0 && x.gaps.length === 0 && (
                        <span className="harness__evidence">
                          {x.status === 'n/a' ? 'not applicable — no agent on this line' : '—'}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
      <div className="harness__tablewrap">
        <table className="harness__table" aria-label="Production-readiness checklist">
          <thead>
            <tr>
              <th>#</th>
              <th>Requirement</th>
              <th>Status</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {r.checklist.map((c) => (
              <tr key={c.n} className={c.status === 'missing' ? 'is-breach' : undefined}>
                <td className="num">{c.n}</td>
                <td>{c.requirement}</td>
                <td>
                  <Beacon label={c.status} tone={c.status === 'ok' ? 'ok' : c.status === 'warn' ? 'warn' : 'bad'} />
                </td>
                <td>{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const HUB_LANES_SHOWN = 8;

/** The blueprint's lanes as fleet/v1 records, plus the lanes the hub itself records (FR-6/FR-7). */
function Lanes({ snapshot, demo }: { snapshot: HubSnapshot | null; demo: boolean }) {
  const nodes = useFactoryStore((s) => s.nodes);
  const edges = useFactoryStore((s) => s.edges);
  const meta = useFactoryStore((s) => s.meta);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lanes = useMemo(() => toFleetLanes(toBlueprint()), [nodes, edges, meta, toBlueprint]);
  const hubLanes = snapshot?.manifest?.lanes ?? [];
  return (
    <Panel eyebrow="Lanes · fleet/v1" title="What the manifest records">
      <p className="harness__lead">
        Each compiled line as the lane <code>fleet.manifest.yml</code> records — id, kind,
        harness, triggers, switch, tokens, guardrails — the shape the hub reads to present a
        repo’s harnesses.
      </p>
      {lanes.length > 0 ? (
        <div className="lanes">
          {lanes.map((l) => (
            <HarnessCard key={l.id} lane={l} />
          ))}
        </div>
      ) : (
        <p className="harness__note">No lines on the floor yet.</p>
      )}
      {snapshot && hubLanes.length > 0 && (
        <>
          <h4 className="harness__sub">
            {snapshot.slug} records {hubLanes.length} lane{hubLanes.length === 1 ? '' : 's'}
          </h4>
          <div className="lanes">
            {hubLanes.slice(0, HUB_LANES_SHOWN).map((l) => (
              <HarnessCard key={l.id} lane={l} compact />
            ))}
          </div>
          {hubLanes.length > HUB_LANES_SHOWN && (
            <p className="harness__more">
              +{hubLanes.length - HUB_LANES_SHOWN} more
              {!demo && (
                <>
                  {' '}
                  in{' '}
                  <a href={hubFileUrl(snapshot.slug, HUB_PATHS.manifest)} target="_blank" rel="noreferrer">
                    {HUB_PATHS.manifest} ↗
                  </a>
                </>
              )}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
