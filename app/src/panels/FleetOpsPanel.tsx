// Fleet Command — the game-like multi-repo cockpit inside the Fleet tab. Four boards
// over one scanned fleet: Districts (repo cards with LED walls + certification grades),
// Rankings (offender/hall-of-fame leaderboards from the ported dash metrics), Audit
// (alignment findings with one-click work-order filing), and Schedule (the fleet-wide
// cron timetable + dormant automation + kill-switch armament).
//
// All numbers come from the pure engines (fleet/facts, fleet/audit, fleet/metrics) via
// the fleetops store; this file only renders and dispatches actions.

import './fleetops.css';
import { useMemo, useState } from 'react';
import type { AuditFinding, Grade, WorkflowFacts } from '../fleet/types';
import { AUDIT_RULES } from '../fleet/audit';
import { ledForRun } from '../github/telemetry';
import type { FactoryRun, LedState } from '../github/types';
import { useFleetOpsStore, type FleetWorkflowMetrics, type RepoSnapshot } from '../state/fleetops';
import { parseCron } from '../utils/cron';
import { archetypeLabel, WorkflowDrawer } from './WorkflowDrawer';

type Board = 'districts' | 'rankings' | 'workflows' | 'audit' | 'schedule';

const BOARDS: { id: Board; label: string }[] = [
  { id: 'districts', label: '🏭 Districts' },
  { id: 'rankings', label: '🏆 Rankings' },
  { id: 'workflows', label: '🔧 Workflows' },
  { id: 'audit', label: '📋 Audit' },
  { id: 'schedule', label: '⏱ Schedule' },
];

/** The workflow a maintainer has opened in the drawer. */
interface Selected {
  slug: string;
  path: string;
}

const fmtMin = (min: number): string =>
  min >= 90 ? `${(min / 60).toFixed(1)}h` : `${Math.round(min)}m`;

const basename = (path: string): string => path.split('/').pop() ?? path;

/** Newest run per workflow path — the LED wall's data. */
function latestByPath(runs: FactoryRun[]): Map<string, FactoryRun> {
  const m = new Map<string, FactoryRun>();
  for (const r of runs) {
    const cur = m.get(r.path);
    if (!cur || r.createdAt > cur.createdAt) m.set(r.path, r);
  }
  return m;
}

/** Human word for a LED state — so run status is conveyed by text, not colour alone (WCAG 1.4.1). */
const ledWord = (led: LedState): string =>
  led === 'bad' ? 'failed' : led === 'warn' ? 'running' : led === 'on' ? 'ok' : 'idle';

function GradeBadge({ grade }: { grade: Grade | null }) {
  if (!grade) return <span className="grade grade--none">–</span>;
  return <span className={`grade grade--${grade.toLowerCase()}`}>{grade}</span>;
}

function FlagChips({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <span className="flagchips">
      {flags.map((f) => (
        <span key={f} className={`flagchip flagchip--${f}`}>{f}</span>
      ))}
    </span>
  );
}

export function FleetOpsPanel({ onDrill }: { onDrill: (slug: string) => void }) {
  const roster = useFleetOpsStore((s) => s.roster);
  const snapshots = useFleetOpsStore((s) => s.snapshots);
  const scanning = useFleetOpsStore((s) => s.scanning);
  const progress = useFleetOpsStore((s) => s.progress);
  const rateRemaining = useFleetOpsStore((s) => s.rateRemaining);
  const error = useFleetOpsStore((s) => s.error);
  const totals = useFleetOpsStore((s) => s.totals);
  const byType = useFleetOpsStore((s) => s.byType);
  const fleetMetrics = useFleetOpsStore((s) => s.fleetMetrics);
  const windowDays = useFleetOpsStore((s) => s.windowDays);
  const hubSlug = useFleetOpsStore((s) => s.hubSlug);
  const { addRepos, removeRepo, importFromHub, scanFleet, scanRepo, setWindowDays } =
    useFleetOpsStore.getState();

  const [board, setBoard] = useState<Board>('districts');
  const [hubInput, setHubInput] = useState(hubSlug || '');
  const [addInput, setAddInput] = useState('');
  const [selected, setSelected] = useState<Selected | null>(null);

  const ready = Object.values(snapshots).filter((s) => s.status === 'ready');
  // Resolve the open drawer's live data — dropping it if a rescan removed the workflow.
  const drawer = useMemo(() => {
    if (!selected) return null;
    const snap = snapshots[selected.slug];
    const facts = snap?.facts.find((f) => f.path === selected.path);
    if (!snap || !facts) return null;
    const metrics = fleetMetrics.find(
      (m) => m.repo === selected.slug && m.displayPath === selected.path,
    );
    return { snap, facts, metrics };
  }, [selected, snapshots, fleetMetrics]);
  const alarms = useMemo(() => {
    const metricAlarms = fleetMetrics.filter(
      (m) => m.flags.includes('failing') || m.flags.includes('high-cost-low-value'),
    ).length;
    const auditFails = ready.reduce(
      (n, s) => n + (s.audit?.findings.filter((f) => f.severity === 'fail').length ?? 0),
      0,
    );
    return { metricAlarms, auditFails, total: metricAlarms + auditFails };
  }, [fleetMetrics, ready]);

  return (
    <div className="fleetops">
      <div className="fleetops__bar">
        <span className="fleetops__label">⌘ Fleet Command</span>
        <input
          className="palette__search fleetops__input"
          placeholder="hub owner/name (.gitmodules)…"
          aria-label="Import fleet roster from a hub repo"
          value={hubInput}
          onChange={(e) => setHubInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hubInput.trim()) void importFromHub(hubInput.trim());
          }}
        />
        <button
          type="button"
          className="btn btn--small"
          disabled={!hubInput.trim()}
          onClick={() => void importFromHub(hubInput.trim())}
        >
          Import fleet
        </button>
        <input
          className="palette__search fleetops__input"
          placeholder="add repos: owner/a owner/b…"
          aria-label="Add repos to the roster"
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && addInput.trim()) {
              addRepos(addInput);
              setAddInput('');
            }
          }}
        />
        <span className="fleetops__spacer" />
        <label className="fleetops__window">
          window{' '}
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            aria-label="Metrics window in days"
          >
            <option value={7}>7d</option>
            <option value={14}>14d</option>
            <option value={30}>30d</option>
          </select>
        </label>
        <button
          type="button"
          className="btn btn--primary btn--small"
          disabled={scanning || roster.length === 0}
          onClick={() => void scanFleet()}
        >
          {scanning && progress ? `Scanning ${progress.done}/${progress.total}…` : '⟳ Scan fleet'}
        </button>
        {rateRemaining !== null && (
          <span className="fleetops__rate" title="GitHub API rate budget remaining">
            api {rateRemaining}
          </span>
        )}
      </div>

      {error && <div className="banner banner--drift">{error}</div>}

      {roster.length === 0 ? (
        <p className="tabpane__empty">
          Build a roster to command a fleet: import a monorepo hub&apos;s <code>.gitmodules</code>{' '}
          (e.g. <code>bamr87/bamr87</code>) or add repos by hand — then <b>Scan fleet</b>.
        </p>
      ) : (
        <>
          <div className="fleetops__hud">
            <div className="stat">
              <span className="stat__num">{ready.length}/{roster.length}</span>
              <span className="stat__lbl">repos scanned</span>
            </div>
            <div className="stat">
              <span className="stat__num">{totals ? totals.runs : '–'}</span>
              <span className="stat__lbl">runs · {windowDays}d</span>
            </div>
            <div className="stat">
              <span className="stat__num">{totals ? fmtMin(totals.totalMin) : '–'}</span>
              <span className="stat__lbl">compute burned</span>
            </div>
            <div className="stat">
              <span className={`stat__num${totals && totals.wasteMin > 0 ? ' stat__num--alarm' : ''}`}>
                {totals ? fmtMin(totals.wasteMin) : '–'}
              </span>
              <span className="stat__lbl">waste</span>
            </div>
            <div className="stat">
              <span className="stat__num">{totals ? `${totals.effectivenessPct}%` : '–'}</span>
              <span className="stat__lbl">effectiveness</span>
            </div>
            <div className="stat">
              <span className="stat__num">{totals ? `${totals.successRatePct}%` : '–'}</span>
              <span className="stat__lbl">success rate</span>
            </div>
            <div className="stat">
              <span className="stat__num">{totals ? `${totals.reworkPct}%` : '–'}</span>
              <span className="stat__lbl">rework</span>
            </div>
            <div className="stat">
              <span className={`stat__num${alarms.total > 0 ? ' stat__num--alarm' : ''}`}>
                {alarms.total}
              </span>
              <span className="stat__lbl">alarms</span>
            </div>
          </div>

          {byType.length > 0 && (
            <div className="fleetops__types" aria-label="Compute share by workflow type">
              {byType.map((t) => (
                <span key={t.type} className={`typebar typebar--${t.type}`} style={{ flexGrow: Math.max(t.sharePct, 2) }} title={`${t.type}: ${fmtMin(t.totalMin)} (${t.sharePct}%) · ${t.effectivenessPct}% effective`}>
                  {t.sharePct >= 8 ? `${t.type} ${t.sharePct}%` : ''}
                </span>
              ))}
            </div>
          )}

          <nav className="fleetops__boards" aria-label="Fleet boards">
            {BOARDS.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`chip${board === b.id ? ' is-active' : ''}`}
                aria-pressed={board === b.id}
                onClick={() => setBoard(b.id)}
              >
                {b.label}
              </button>
            ))}
          </nav>

          {board === 'districts' && (
            <DistrictsBoard
              roster={roster.map((e) => e.slug)}
              snapshots={snapshots}
              fleetMetrics={fleetMetrics}
              onDrill={onDrill}
              onRescan={(slug) => void scanRepo(slug)}
              onRemove={removeRepo}
            />
          )}
          {board === 'rankings' && <RankingsBoard rows={fleetMetrics} />}
          {board === 'workflows' && (
            <WorkflowsBoard
              snapshots={ready}
              fleetMetrics={fleetMetrics}
              onManage={(slug, path) => setSelected({ slug, path })}
            />
          )}
          {board === 'audit' && <AuditBoard snapshots={ready} />}
          {board === 'schedule' && <ScheduleBoard snapshots={ready} />}
        </>
      )}

      {drawer && selected && (
        <WorkflowDrawer
          slug={selected.slug}
          facts={drawer.facts}
          snapshot={drawer.snap}
          metrics={drawer.metrics}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ── Workflows (per-workflow management table across the fleet) ────────────────

interface WorkflowRow {
  slug: string;
  facts: WorkflowFacts;
  led: LedState;
  metrics?: FleetWorkflowMetrics;
}

function WorkflowsBoard({
  snapshots,
  fleetMetrics,
  onManage,
}: {
  snapshots: RepoSnapshot[];
  fleetMetrics: FleetWorkflowMetrics[];
  onManage: (slug: string, path: string) => void;
}) {
  const rows = useMemo<WorkflowRow[]>(() => {
    const out: WorkflowRow[] = [];
    for (const snap of snapshots) {
      const latest = latestByPath(snap.runs);
      const byPath = new Map(
        fleetMetrics.filter((m) => m.repo === snap.slug).map((m) => [m.displayPath, m]),
      );
      for (const f of snap.facts) {
        out.push({ slug: snap.slug, facts: f, led: ledForRun(latest.get(f.path)), metrics: byPath.get(f.path) });
      }
    }
    // Costliest lines first (survey triage order): burned minutes, then priority.
    return out.sort(
      (a, b) =>
        (b.metrics?.totalMin ?? 0) - (a.metrics?.totalMin ?? 0) ||
        (b.metrics?.priority ?? 0) - (a.metrics?.priority ?? 0),
    );
  }, [snapshots, fleetMetrics]);

  if (rows.length === 0) {
    return <p className="tabpane__empty">No workflows scanned yet — scan the fleet first.</p>;
  }
  return (
    <div className="wfboard">
      <table className="rank__table">
        <thead>
          <tr>
            <th>repo</th>
            <th>workflow</th>
            <th>archetype</th>
            <th></th>
            <th>runs</th>
            <th>burned</th>
            <th>waste</th>
            <th>p95</th>
            <th>cost cap</th>
            <th>signals</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const m = r.metrics;
            return (
              <tr key={`${r.slug}:${r.facts.path}`}>
                <td className="rank__repo">{r.slug}</td>
                <td className="rank__wf" title={r.facts.path}>{r.facts.name}</td>
                <td className="wfboard__arch">{archetypeLabel(r.facts.archetype)}</td>
                <td>
                  <span
                    className={`led led--${r.led}`}
                    role="img"
                    aria-label={`${basename(r.facts.path)} — ${ledWord(r.led)}`}
                    title={`${basename(r.facts.path)} — ${ledWord(r.led)}`}
                  />
                </td>
                <td className="rank__num">{m ? m.runs : '–'}</td>
                <td className="rank__num">{m ? fmtMin(m.totalMin) : '–'}</td>
                <td className={`rank__num${m && m.wasteMin > 0 ? ' auditboard__fail' : ''}`}>
                  {m ? fmtMin(m.wasteMin) : '–'}
                </td>
                <td className="rank__num">{m ? fmtMin(m.p95Min) : '–'}</td>
                <td className="rank__num">
                  {r.facts.ai.maxCostUsd != null ? (
                    <span className="wfboard__cap">≤ ${r.facts.ai.maxCostUsd}</span>
                  ) : r.facts.waitBound ? (
                    <span className="wfboard__wait" title="Wait-bound — burns wall-clock minutes polling">⏳ wait</span>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </td>
                <td><FlagChips flags={m?.flags ?? []} /></td>
                <td>
                  <button
                    type="button"
                    className="btn btn--small"
                    title={`Manage ${r.facts.name}`}
                    onClick={() => onManage(r.slug, r.facts.path)}
                  >
                    Manage
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Districts ────────────────────────────────────────────────────────────────

function DistrictsBoard({
  roster,
  snapshots,
  fleetMetrics,
  onDrill,
  onRescan,
  onRemove,
}: {
  roster: string[];
  snapshots: Record<string, RepoSnapshot>;
  fleetMetrics: FleetWorkflowMetrics[];
  onDrill: (slug: string) => void;
  onRescan: (slug: string) => void;
  onRemove: (slug: string) => void;
}) {
  const maxMin = Math.max(1, ...roster.map((slug) =>
    fleetMetrics.filter((m) => m.repo === slug).reduce((n, m) => n + m.totalMin, 0),
  ));
  return (
    <div className="districts">
      {roster.map((slug) => {
        const snap = snapshots[slug];
        const rows = fleetMetrics.filter((m) => m.repo === slug);
        const totalMin = rows.reduce((n, m) => n + m.totalMin, 0);
        const wasteMin = rows.reduce((n, m) => n + m.wasteMin, 0);
        const leds: [string, LedState][] = snap?.fleet
          ? (() => {
              const latest = latestByPath(snap.runs);
              return snap.fleet.workflows.map(
                (w) => [w.path, ledForRun(latest.get(w.path))] as [string, LedState],
              );
            })()
          : [];
        const aiCount = snap?.facts.filter((f) => f.ai.present).length ?? 0;
        const fails = snap?.audit?.findings.filter((f) => f.severity === 'fail').length ?? 0;
        const flags = [...new Set(rows.flatMap((m) => m.flags))].slice(0, 3);
        return (
          <div key={slug} className={`district${snap?.status === 'error' ? ' district--error' : ''}`}>
            <div className="district__head">
              <button type="button" className="district__name" title={`Open ${slug} on the observe map`} onClick={() => onDrill(slug)}>
                {slug}
              </button>
              <GradeBadge grade={snap?.audit?.grade ?? null} />
            </div>
            {snap?.status === 'ready' ? (
              <>
                <div className="district__leds" aria-label={`${leds.length} workflows`}>
                  {leds.map(([path, led]) => (
                    <span
                      key={path}
                      className={`led led--${led}`}
                      role="img"
                      aria-label={`${basename(path)} — ${ledWord(led)}`}
                      title={`${basename(path)} — ${ledWord(led)}`}
                    />
                  ))}
                </div>
                <div className="district__meta">
                  {snap.fleet?.workflows.length ?? 0} machines · {aiCount} AI
                  {fails > 0 && <span className="district__alarm"> · {fails} ⚠</span>}
                </div>
                <div className="district__minutes" title={`${fmtMin(totalMin)} burned · ${fmtMin(wasteMin)} wasted`}>
                  <span className="district__minbar" style={{ width: `${(totalMin / maxMin) * 100}%` }}>
                    <span
                      className="district__wastebar"
                      style={{ width: totalMin > 0 ? `${(wasteMin / totalMin) * 100}%` : '0%' }}
                    />
                  </span>
                  <span className="district__minlbl">{fmtMin(totalMin)}</span>
                </div>
                <FlagChips flags={flags} />
              </>
            ) : snap?.status === 'loading' ? (
              <div className="district__meta">scanning…</div>
            ) : snap?.status === 'error' ? (
              <div className="district__meta district__alarm">{snap.error}</div>
            ) : (
              <div className="district__meta">not scanned</div>
            )}
            <div className="district__actions">
              <button type="button" className="btn btn--small" onClick={() => onDrill(slug)}>Map</button>
              <button type="button" className="btn btn--small" onClick={() => onRescan(slug)} disabled={snap?.status === 'loading'}>
                Rescan
              </button>
              <button type="button" className="iconbtn iconbtn--danger" title={`Remove ${slug} from the roster`} onClick={() => onRemove(slug)}>
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Rankings ─────────────────────────────────────────────────────────────────

function RankTable({
  title,
  rows,
  cols,
}: {
  title: string;
  rows: FleetWorkflowMetrics[];
  cols: { label: string; value: (m: FleetWorkflowMetrics) => string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="rank">
      <h3 className="panel__eyebrow">{title}</h3>
      <table className="rank__table">
        <thead>
          <tr>
            <th>repo</th>
            <th>workflow</th>
            {cols.map((c) => (
              <th key={c.label}>{c.label}</th>
            ))}
            <th>signals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.path}>
              <td className="rank__repo">{m.repo}</td>
              <td className="rank__wf" title={m.displayPath}>{m.name}</td>
              {cols.map((c) => (
                <td key={c.label} className="rank__num">{c.value(m)}</td>
              ))}
              <td><FlagChips flags={m.flags} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RankingsBoard({ rows }: { rows: FleetWorkflowMetrics[] }) {
  const active = rows.filter((m) => m.runs > 0);
  const offenders = active.filter((m) => m.priority > 0).slice(0, 12);
  const slow = [...active].sort((a, b) => b.p95Min - a.p95Min).slice(0, 8);
  const rework = active
    .filter((m) => m.reworkRuns > 0)
    .sort((a, b) => b.reworkPct - a.reworkPct)
    .slice(0, 8);
  const fame = active
    .filter((m) => m.effectivenessPct >= 85 && m.runs >= 5)
    .sort((a, b) => b.totalMin - a.totalMin)
    .slice(0, 8);
  if (active.length === 0) {
    return <p className="tabpane__empty">No runs in the window yet — scan the fleet first.</p>;
  }
  return (
    <div className="rankings">
      <RankTable
        title="⚠ Priority offenders — waste + ineffective minutes (triage order)"
        rows={offenders}
        cols={[
          { label: 'runs', value: (m) => String(m.runs) },
          { label: 'burned', value: (m) => fmtMin(m.totalMin) },
          { label: 'waste', value: (m) => fmtMin(m.wasteMin) },
          { label: 'effective', value: (m) => `${m.effectivenessPct}%` },
          { label: 'priority', value: (m) => String(m.priority) },
        ]}
      />
      <RankTable
        title="🐌 Slowest lines (p95)"
        rows={slow}
        cols={[
          { label: 'p95', value: (m) => fmtMin(m.p95Min) },
          { label: 'avg', value: (m) => fmtMin(m.avgMin) },
          { label: 'runs', value: (m) => String(m.runs) },
        ]}
      />
      <RankTable
        title="🔁 Rework — re-run attempts"
        rows={rework}
        cols={[
          { label: 'reruns', value: (m) => String(m.reworkRuns) },
          { label: 'rework', value: (m) => `${m.reworkPct}%` },
          { label: 'success', value: (m) => `${m.successRatePct}%` },
        ]}
      />
      <RankTable
        title="🏅 Hall of fame — heavy AND effective"
        rows={fame}
        cols={[
          { label: 'burned', value: (m) => fmtMin(m.totalMin) },
          { label: 'effective', value: (m) => `${m.effectivenessPct}%` },
          { label: 'success', value: (m) => `${m.successRatePct}%` },
        ]}
      />
    </div>
  );
}

// ── Audit ────────────────────────────────────────────────────────────────────

// The index disambiguates SIBLING findings that share (slug, path, ruleId) — e.g. a
// repo missing two of the standard trio (both path:null, ruleId:'standard-trio'), or a
// file with two branch-pinned actions (both pin-branch). Without it, the shared key
// would collide React keys AND cross-wire the filed-work-order state (filing one flips
// its siblings to "filed" pointing at the wrong issue).
function findingKey(slug: string, f: AuditFinding, index: number): string {
  return `${slug}:${f.path ?? 'repo'}:${f.ruleId}:${index}`;
}

function AuditBoard({ snapshots }: { snapshots: RepoSnapshot[] }) {
  const filed = useFleetOpsStore((s) => s.filedWorkOrders);
  const { fileWorkOrder } = useFleetOpsStore.getState();
  const [open, setOpen] = useState<string | null>(null);
  const ruleTitle = useMemo(
    () => new Map(AUDIT_RULES.map((r) => [r.id, r.title])),
    [],
  );
  const audited = snapshots.filter((s) => s.audit);
  if (audited.length === 0) {
    return <p className="tabpane__empty">Nothing audited yet — scan the fleet first.</p>;
  }
  const sorted = [...audited].sort((a, b) => (a.audit?.score ?? 0) - (b.audit?.score ?? 0));
  return (
    <div className="auditboard">
      <table className="rank__table">
        <thead>
          <tr>
            <th>repo</th><th>grade</th><th>score</th><th>✗ fail</th><th>! warn</th><th>· info</th><th>passed</th><th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((snap) => {
            const a = snap.audit;
            if (!a) return null;
            const fails = a.findings.filter((f) => f.severity === 'fail').length;
            const warns = a.findings.filter((f) => f.severity === 'warn').length;
            const infos = a.findings.filter((f) => f.severity === 'info').length;
            const isOpen = open === snap.slug;
            return (
              <tr key={snap.slug} className={isOpen ? 'is-open' : ''}>
                <td className="rank__repo">{snap.slug}</td>
                <td><GradeBadge grade={a.grade} /></td>
                <td className="rank__num">{a.score}</td>
                <td className={`rank__num${fails ? ' auditboard__fail' : ''}`}>{fails}</td>
                <td className="rank__num">{warns}</td>
                <td className="rank__num">{infos}</td>
                <td className="rank__num">{a.passedRules.length}</td>
                <td>
                  <button type="button" className="btn btn--small" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : snap.slug)}>
                    {isOpen ? 'Close' : 'Findings'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {open && (() => {
        const snap = audited.find((s) => s.slug === open);
        if (!snap?.audit) return null;
        return (
          <div className="auditboard__detail">
            <h3 className="panel__eyebrow">{snap.slug} — findings</h3>
            {snap.audit.findings.length === 0 && <p>Fully certified — no findings. 🏅</p>}
            <ul className="findings">
              {snap.audit.findings.map((f, i) => {
                const key = findingKey(snap.slug, f, i);
                const filedUrl = filed[key];
                return (
                  <li key={key} className={`finding finding--${f.severity}`}>
                    <span className="finding__sev">{f.severity === 'fail' ? '✗' : f.severity === 'warn' ? '!' : '·'}</span>
                    <span className="finding__body">
                      <b>{ruleTitle.get(f.ruleId) ?? f.ruleId}</b>
                      {f.path ? <code className="finding__path">{basename(f.path)}</code> : <em className="finding__path">repo</em>}
                      — {f.message}
                      <span className="finding__fix">Fix: {f.fix}</span>
                    </span>
                    {filedUrl ? (
                      <a className="btn btn--small" href={filedUrl} target="_blank" rel="noreferrer">filed ↗</a>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--small"
                        title="File this finding as a work-order issue in the repo"
                        onClick={() =>
                          void fileWorkOrder(
                            snap.slug,
                            key,
                            // Include the message so sibling findings (same rule+path) get
                            // distinct issue titles, not three identical ones.
                            `[fleet-audit] ${f.ruleId}${f.path ? ` · ${basename(f.path)}` : ''}: ${f.message.slice(0, 70)}`,
                            `**Finding** (${f.severity}): ${f.message}\n\n**Fix**: ${f.fix}\n\n_Filed from the GitFactory Fleet Command audit board._`,
                          )
                        }
                      >
                        File issue
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}
    </div>
  );
}

// ── Schedule ─────────────────────────────────────────────────────────────────

interface CronRow {
  repo: string;
  facts: WorkflowFacts;
  cron: string;
  hours: number[];
  armed: boolean | null;
}

function ScheduleBoard({ snapshots }: { snapshots: RepoSnapshot[] }) {
  const rows: CronRow[] = [];
  const dormant: { repo: string; path: string; name: string; cron: string }[] = [];
  for (const snap of snapshots) {
    const varsByName = new Map(snap.variables.map((v) => [v.name, v.value]));
    for (const f of snap.facts) {
      for (const cron of f.crons) {
        const spec = parseCron(cron);
        const armed =
          f.killSwitches.length === 0
            ? null
            : f.killSwitches.some((k) => varsByName.get(k) === 'true');
        rows.push({ repo: snap.slug, facts: f, cron, hours: spec ? [...spec.hour] : [], armed });
      }
      for (const cron of f.dormantCrons) {
        dormant.push({ repo: snap.slug, path: f.path, name: f.name, cron });
      }
    }
  }
  const histogram = Array.from({ length: 24 }, (_, h) =>
    rows.reduce((n, r) => n + (r.hours.includes(h) ? 1 : 0), 0),
  );
  const peak = Math.max(1, ...histogram);
  if (rows.length === 0 && dormant.length === 0) {
    return <p className="tabpane__empty">No schedules found — scan the fleet first.</p>;
  }
  return (
    <div className="schedboard">
      <h3 className="panel__eyebrow">Fleet timetable — workflows firing per UTC hour</h3>
      <div className="schedboard__histogram" role="img" aria-label="Cron congestion by hour">
        {histogram.map((n, h) => (
          <div key={h} className="schedboard__col" title={`${String(h).padStart(2, '0')}:00 UTC — ${n} workflow${n === 1 ? '' : 's'}`}>
            <div
              className={`schedboard__fill${n >= 4 ? ' schedboard__fill--hot' : ''}`}
              style={{ height: `${(n / peak) * 100}%` }}
            />
            <span className="schedboard__hour">{h}</span>
          </div>
        ))}
      </div>
      <h3 className="panel__eyebrow">Scheduled lines</h3>
      <table className="rank__table">
        <thead>
          <tr><th>repo</th><th>workflow</th><th>cron</th><th>AI</th><th>kill switch</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.repo}:${r.facts.path}:${r.cron}:${i}`}>
              <td className="rank__repo">{r.repo}</td>
              <td className="rank__wf">{r.facts.name}</td>
              <td><code>{r.cron}</code></td>
              <td>{r.facts.ai.present ? '🤖' : ''}</td>
              <td>
                {r.armed === null ? (
                  <span className="dim">none</span>
                ) : r.armed ? (
                  <span className="armed">⚡ armed</span>
                ) : (
                  <span className="dim">○ disarmed</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {dormant.length > 0 && (
        <>
          <h3 className="panel__eyebrow">💤 Dormant automation — commented-out schedules</h3>
          <ul className="schedboard__dormant">
            {dormant.map((d, i) => (
              <li key={`${d.repo}:${d.path}:${d.cron}:${i}`}>
                <span className="rank__repo">{d.repo}</span> · {d.name} — <code>{d.cron}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
