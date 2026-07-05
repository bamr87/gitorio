import './monitor.css';
import { useEffect, useMemo } from 'react';
import { assemblyLines } from '../compiler/compile';
import { ledForRun, latestBySlug, statsByLine } from '../github/telemetry';
import { nextRuns, firesPerDay } from '../utils/cron';
import { useFactoryStore } from '../state/store';
import { useGithubStore } from '../state/github';
import { useSettingsStore } from '../state/settings';
import { useMonitorStore } from '../state/monitor';
import { repoSlug, type FactoryRun, type RunConclusion } from '../github/types';

function durationSec(run: FactoryRun): number {
  const end = Date.parse(run.updatedAt);
  const start = Date.parse(run.runStartedAt ?? run.createdAt);
  return Number.isFinite(end) && Number.isFinite(start) ? Math.max(0, (end - start) / 1000) : 0;
}
const fmtDur = (sec: number | null): string => (sec === null ? '—' : sec < 90 ? `${Math.round(sec)}s` : `${Math.round(sec / 60)}m`);
const pct = (r: number | null): string => (r === null ? '—' : `${Math.round(r * 100)}%`);
function fmtAgo(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  return s < 5 ? 'just now' : s < 60 ? `${Math.round(s)}s ago` : `${Math.round(s / 60)}m ago`;
}
const STEP_MARK: Record<string, string> = { success: '✓', failure: '✗', skipped: '⊘', cancelled: '⊘' };
const stepMark = (c: RunConclusion, status: string): string =>
  status !== 'completed' ? '·' : (c && STEP_MARK[c]) || '✓';

export function MonitorPanel() {
  const login = useGithubStore((s) => s.login);
  const repo = useGithubStore((s) => s.repo);
  const nodes = useFactoryStore((s) => s.nodes);
  const edges = useFactoryStore((s) => s.edges);
  const meta = useFactoryStore((s) => s.meta);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  const pollMs = useSettingsStore((s) => s.pollMs);

  const runs = useMonitorStore((s) => s.runs);
  const stats = useMonitorStore((s) => s.stats);
  const polling = useMonitorStore((s) => s.polling);
  const lastPolledAt = useMonitorStore((s) => s.lastPolledAt);
  const error = useMonitorStore((s) => s.error);
  const flash = useMonitorStore((s) => s.flash);
  const jobsByRun = useMonitorStore((s) => s.jobsByRun);
  const expandedRunId = useMonitorStore((s) => s.expandedRunId);
  const filterSlug = useMonitorStore((s) => s.filterSlug);
  const { start, stop, poll, expand, dispatch, cancel, setFilter } = useMonitorStore.getState();

  // Poll only while the tab is mounted + connected.
  useEffect(() => {
    if (!login) return;
    start(pollMs);
    return () => stop();
  }, [login, pollMs, start, stop]);

  const lines = useMemo(() => {
    const bp = toBlueprint();
    const byId = new Map(bp.nodes.map((n) => [n.id, n]));
    const led = latestBySlug(runs);
    const perLineStats = new Map(statsByLine(runs).map((r) => [r.slug, r]));
    return assemblyLines(bp).map((line) => {
      const lineNodes = line.nodeIds.map((id) => byId.get(id)).filter(Boolean) as typeof bp.nodes;
      const crons = lineNodes.filter((n) => n.type === 'trigger.cron').map((n) => String(n.config.cron ?? '')).filter(Boolean);
      const manual = lineNodes.some((n) => n.type === 'trigger.manual');
      const next = crons.flatMap((c) => nextRuns(c, 1)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const perDay = crons.reduce((sum, c) => sum + firesPerDay(c), 0);
      const latest = led.get(line.slug);
      const inProgress = runs.find((r) => r.slug === line.slug && r.status !== 'completed');
      return {
        ...line,
        manual,
        crons,
        next,
        perDay,
        led: ledForRun(latest),
        stat: perLineStats.get(line.slug) ?? null,
        inProgress,
      };
    });
  }, [nodes, edges, meta, runs, toBlueprint]);

  // Overlap heuristic: two lines whose next-5 fire minutes collide.
  const overlaps = useMemo(() => {
    const stamps = new Map<string, string>(); // minute-key → first slug
    const collided = new Set<string>();
    for (const l of lines) {
      for (const c of l.crons) {
        for (const d of nextRuns(c, 5)) {
          const key = d.toISOString().slice(0, 16);
          const prev = stamps.get(key);
          if (prev && prev !== l.slug) {
            collided.add(l.slug);
            collided.add(prev);
          } else stamps.set(key, l.slug);
        }
      }
    }
    return collided;
  }, [lines]);

  const shownRuns = filterSlug ? runs.filter((r) => r.slug === filterSlug) : runs;
  const slugs = [...new Set(runs.map((r) => r.slug))].sort();

  if (!login) {
    return (
      <div className="tabpane monitor">
        <p className="tabpane__empty">Connect a repo (top bar) to monitor its factory runs.</p>
      </div>
    );
  }

  return (
    <div className="tabpane monitor">
      <div className="monitor__head">
        <span className={`led ${polling ? 'led--warn' : 'led--idle'}`} />
        <span className="monitor__title">📊 MONITOR</span>
        <span className="monitor__repo">{repo ? repoSlug(repo) : ''}</span>
        <span className="monitor__spacer" />
        <span className="monitor__ago">{error ? '' : `polled ${fmtAgo(lastPolledAt)}`}</span>
        <button type="button" className="btn btn--small" onClick={() => void poll()}>Refresh</button>
      </div>

      {error && <p className="diag diag--error">{error}</p>}
      {flash && <p className="diag diag--info">{flash}</p>}

      <div className="monitor__stats">
        <div className="stat"><span className="stat__num">{stats?.total ?? 0}</span><span className="stat__lbl">runs</span></div>
        <div className="stat"><span className="stat__num">{pct(stats?.successRate ?? null)}</span><span className="stat__lbl">success</span></div>
        <div className="stat"><span className="stat__num">{stats?.inProgress ?? 0}</span><span className="stat__lbl">running</span></div>
        <div className="stat"><span className="stat__num">{fmtDur(stats?.p50DurationSec ?? null)}</span><span className="stat__lbl">p50</span></div>
      </div>

      <div className="panel__eyebrow monitor__section">Assembly lines</div>
      <div className="monitor__lines">
        {lines.length === 0 && <p className="tabpane__empty">No assembly lines on the canvas yet — build one on the Build tab.</p>}
        {lines.map((l) => (
          <div key={l.slug} className="mline">
            <span className={`led led--${l.led}`} title={l.led} />
            <div className="mline__id">
              <span className="mline__name">{l.name}</span>
              <span className="mline__file">{l.filename}</span>
            </div>
            <div className="mline__stat">
              <span>{pct(l.stat?.successRate ?? null)} · {l.stat?.total ?? 0} runs · {fmtDur(l.stat?.p50DurationSec ?? null)}</span>
              <span className={`mline__sched${overlaps.has(l.slug) || l.perDay > 24 ? ' mline__sched--warn' : ''}`}>
                {l.crons.length
                  ? `${l.next ? `next ${l.next.toISOString().replace('T', ' ').slice(0, 16)}Z` : 'no upcoming run'} · ${l.perDay}/day${overlaps.has(l.slug) ? ' · overlaps another line' : ''}`
                  : l.manual ? 'manual only' : 'event-triggered'}
              </span>
            </div>
            <div className="mline__ctl">
              {l.inProgress ? (
                <button type="button" className="btn btn--small" onClick={() => void cancel(l.inProgress!.runId)} title="Cancel the in-progress run">✕ Cancel</button>
              ) : (
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={!l.manual}
                  title={l.manual ? 'workflow_dispatch this line' : 'Add a Manual lever to run this line on demand'}
                  onClick={() => void dispatch(l.filename)}
                >
                  ▶ Run now
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="panel__eyebrow monitor__section">Run history</div>
      <div className="monitor__filters">
        <button type="button" className={`chip${!filterSlug ? ' is-active' : ''}`} onClick={() => setFilter(null)}>all</button>
        {slugs.map((s) => (
          <button type="button" key={s} className={`chip${filterSlug === s ? ' is-active' : ''}`} onClick={() => setFilter(s)}>{s}</button>
        ))}
      </div>
      <div className="monitor__runs">
        {shownRuns.length === 0 && <p className="tabpane__empty">No runs yet. Deploy a line and trigger it (or ▶ Run now above).</p>}
        {shownRuns.slice(0, 40).map((r) => {
          const jobs = jobsByRun[r.runId];
          const open = expandedRunId === r.runId;
          return (
            <div key={r.runId} className="mrun">
              <button type="button" className="mrun__row" onClick={() => void expand(r.runId)}>
                <span className={`led led--${ledForRun(r)}`} />
                <span className="mrun__slug">{r.slug}</span>
                <span className="mrun__event">{r.event}</span>
                <span className="mrun__concl">{r.status === 'completed' ? r.conclusion ?? '—' : r.status}</span>
                <span className="mrun__dur">{r.status === 'completed' ? fmtDur(durationSec(r)) : '·'}</span>
                <span className="mrun__caret">{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <div className="mrun__jobs">
                  {jobs === 'loading' && <p className="tabpane__empty">Loading jobs…</p>}
                  {Array.isArray(jobs) && jobs.length === 0 && <p className="tabpane__empty">No jobs.</p>}
                  {Array.isArray(jobs) &&
                    jobs.map((j) => (
                      <div key={j.jobId} className="mjob">
                        <a className="mjob__name" href={j.htmlUrl} target="_blank" rel="noreferrer">
                          <span className={`led led--${j.conclusion === 'success' ? 'on' : j.status !== 'completed' ? 'warn' : j.conclusion ? 'bad' : 'idle'}`} /> {j.name} ↗
                        </a>
                        <div className="mjob__steps">
                          {j.steps.map((st) => (
                            <span key={st.number} className={`mstep${st.conclusion && st.conclusion !== 'success' && st.conclusion !== 'skipped' ? ' mstep--bad' : ''}`} title={st.name}>
                              {stepMark(st.conclusion, st.status)} {st.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  <a className="mrun__link btn btn--small" href={r.htmlUrl} target="_blank" rel="noreferrer">open run ↗</a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
