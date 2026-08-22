// WorkflowDrawer — the per-workflow management slide-over inside Fleet Command. Given one
// scanned workflow (its facts + latest run + metrics row + audit findings), it renders the
// full capability report the survey needs — triggers, the AI cost centre (runners incl. the
// agentic-engine, max-turns, the max-cost-usd ceiling), kill switches, guards, the wait-bound
// and dynamic-matrix "why is this expensive" flags — and exposes the maintain actions
// (dispatch / re-run last failure / cancel / arm-disarm kill switch / enable-disable the file),
// each gated behind an explicit confirm that names the repo, the workflow, and the consequence.
//
// Rendering is pure and declarative: every mutation goes through the fleetops store, which
// re-scans afterwards so the board reflects reality. No I/O here.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Archetype, WorkflowFacts } from '../fleet/types';
import { ledForRun } from '../github/telemetry';
import type { FactoryRun, LedState, RunConclusion, RunJob } from '../github/types';
import { busyKey, useFleetOpsStore, type FleetWorkflowMetrics, type RepoSnapshot } from '../state/fleetops';

/** Readable label per archetype — the taxonomy the districts/rankings share, spelled out. */
const ARCHETYPE_LABELS: Record<Archetype, string> = {
  'standard-ci-caller': 'Standard CI caller',
  'mention-handler': '@claude handler',
  'prose-kit': 'Prose kit',
  'ci-gate': 'CI gate',
  'pr-gate': 'PR gate',
  'pr-editor': 'PR editor (AI)',
  'reusable-library': 'Reusable library',
  'content-factory': 'Content factory',
  'issue-to-content': 'Issue → content',
  'agent-gatekeeper': 'Agent gatekeeper',
  'agentic-validator': 'Agentic validator',
  'perfection-loop': 'Perfection loop',
  'auto-merge-bot': 'Auto-merge bot',
  'self-repair': 'Self-repair loop',
  'issue-autopilot': 'Issue autopilot',
  'nightly-audit': 'Nightly audit',
  'autonomy-loop': 'Autonomy loop',
  'cross-repo-filer': 'Cross-repo filer',
  scout: 'Scout',
  'meta-loop': 'Meta loop',
  ledger: 'Ledger',
  'dispatch-hub': 'Dispatch hub',
  'generated-line': 'Generated line',
  release: 'Release',
  'security-gate': 'Security gate',
  deploy: 'Deploy',
  'data-sync': 'Data sync',
  'dependency-bot': 'Dependency bot',
  other: 'Other',
};

/** Human label for an archetype (falls back to the raw string for any not-yet-mapped member). */
export const archetypeLabel = (a: Archetype): string => ARCHETYPE_LABELS[a] ?? a;

const RETRYABLE: RunConclusion[] = ['failure', 'timed_out', 'startup_failure'];

const fmtMin = (min: number): string =>
  min >= 90 ? `${(min / 60).toFixed(1)}h` : `${Math.round(min)}m`;

const basename = (path: string): string => path.split('/').pop() ?? path;

function durationSec(run: FactoryRun): number {
  const end = Date.parse(run.updatedAt);
  const start = Date.parse(run.runStartedAt ?? run.createdAt);
  return Number.isFinite(end) && Number.isFinite(start) ? Math.max(0, (end - start) / 1000) : 0;
}
const fmtDur = (sec: number): string => (sec < 90 ? `${Math.round(sec)}s` : `${Math.round(sec / 60)}m`);

const ledWord = (led: LedState): string =>
  led === 'bad' ? 'failed' : led === 'warn' ? 'running' : led === 'on' ? 'ok' : 'idle';

const jobLed = (j: RunJob): LedState =>
  j.conclusion === 'success' ? 'on' : j.status !== 'completed' ? 'warn' : j.conclusion ? 'bad' : 'idle';

/** Newest run for a path, and whether one is currently in progress. */
function runState(runs: FactoryRun[], path: string): {
  latest: FactoryRun | null;
  inProgress: FactoryRun | null;
  hasFailed: boolean;
} {
  let latest: FactoryRun | null = null;
  let inProgress: FactoryRun | null = null;
  let hasFailed = false;
  for (const r of runs) {
    if (r.path !== path) continue;
    if (!latest || r.createdAt > latest.createdAt) latest = r;
    // The NEWEST non-completed run — the one Status shows — so Cancel targets it, not an
    // older concurrent run (runs may be newest-first, so an unconditional assign kept the oldest).
    if (r.status !== 'completed' && (!inProgress || r.createdAt > inProgress.createdAt)) inProgress = r;
    if (RETRYABLE.includes(r.conclusion)) hasFailed = true;
  }
  return { latest, inProgress, hasFailed };
}

/** One pending confirmation: what the maintainer is about to do, and the mutation to run. */
interface Pending {
  verb: string;
  consequence: string;
  act: () => void;
}

interface WorkflowDrawerProps {
  slug: string;
  facts: WorkflowFacts;
  snapshot: RepoSnapshot;
  metrics?: FleetWorkflowMetrics;
  onClose: () => void;
}

/** Definition-list row helper for the capability report. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wfdrawer__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function WorkflowDrawer({ slug, facts, snapshot, metrics, onClose }: WorkflowDrawerProps) {
  const actionBusy = useFleetOpsStore((s) => s.actionBusy);
  const jobsByRun = snapshot.jobsByRun;
  const [pending, setPending] = useState<Pending | null>(null);
  const [showJobs, setShowJobs] = useState(false);

  // Confirm-dialog focus management (aria-modal contract): when the confirm opens, move
  // focus into it (the Cancel button — the safe default for a destructive action), let
  // Escape dismiss it, and restore focus to whatever opened it when it closes.
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!pending) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    confirmCancelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPending(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnFocusRef.current?.focus?.();
    };
  }, [pending]);

  const { latest, inProgress, hasFailed } = useMemo(
    () => runState(snapshot.runs, facts.path),
    [snapshot.runs, facts.path],
  );
  const varsByName = useMemo(
    () => new Map((snapshot.variables ?? []).map((v) => [v.name, v.value])),
    [snapshot.variables],
  );
  const wfState = useMemo(
    () => snapshot.workflowStates.find((w) => w.path === facts.path) ?? null,
    [snapshot.workflowStates, facts.path],
  );
  const findings = useMemo(
    () => (snapshot.audit?.findings ?? []).filter((f) => f.path === facts.path),
    [snapshot.audit, facts.path],
  );

  const busy = (action: string): boolean => Boolean(actionBusy[busyKey(slug, action)]);
  const ai = facts.ai;
  const enabled = wfState?.state === 'active';

  // Read the store lazily at confirm time so a test can swap an action via setState.
  const store = () => useFleetOpsStore.getState();

  return (
    <div className="wfdrawer" role="dialog" aria-modal="true" aria-label={`Manage ${facts.name}`}>
      <div className="wfdrawer__scrim" onClick={onClose} aria-hidden />
      <div className="wfdrawer__panel">
        <header className="wfdrawer__head">
          <div className="wfdrawer__titles">
            <span className="wfdrawer__repo">{slug}</span>
            <span className="wfdrawer__name">{facts.name}</span>
            <code className="wfdrawer__path">{basename(facts.path)}</code>
          </div>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="wfdrawer__badges">
          <span className={`chip wfdrawer__arch wfdrawer__arch--${facts.dashType}`}>
            {archetypeLabel(facts.archetype)}
          </span>
          <span className="chip">{facts.dashType}</span>
          {ai.maxCostUsd != null && (
            <span className="flagchip flagchip--high-cost-low-value" title="Per-run dollar spend ceiling">
              ≤ ${ai.maxCostUsd}/run
            </span>
          )}
          {facts.waitBound && (
            <span
              className="flagchip flagchip--slow"
              title="Wait-bound — burns minutes polling; enable required checks + --auto"
            >
              ⏳ wait-bound
            </span>
          )}
          {facts.matrixDynamic && (
            <span className="flagchip flagchip--cron-heavy" title="Runtime-computed matrix — unknown fan-out width">
              ⛓ dynamic matrix
            </span>
          )}
        </div>

        <div className="wfdrawer__body">
          {/* ── Status / last run ── */}
          <section>
            <h3 className="panel__eyebrow">Status</h3>
            <div className="wfdrawer__status">
              <span className={`led led--${ledForRun(latest ?? undefined)}`} role="img" aria-label={ledWord(ledForRun(latest ?? undefined))} />
              {latest ? (
                <>
                  <span>
                    {latest.status === 'completed' ? latest.conclusion ?? '—' : latest.status}
                    {' · '}
                    {fmtDur(durationSec(latest))}
                  </span>
                  {latest.runAttempt > 1 && (
                    <span className="flagchip flagchip--rework-heavy" title="Run was re-attempted">
                      attempt {latest.runAttempt}
                    </span>
                  )}
                  <a className="wfdrawer__deeplink" href={latest.htmlUrl} target="_blank" rel="noreferrer">
                    open run ↗
                  </a>
                  <button
                    type="button"
                    className="btn btn--small"
                    aria-expanded={showJobs}
                    onClick={() => {
                      setShowJobs((v) => !v);
                      void store().loadRunJobs(slug, latest.runId);
                    }}
                  >
                    {showJobs ? 'Hide jobs' : 'Inspect jobs'}
                  </button>
                </>
              ) : (
                <span className="dim">never run in the window</span>
              )}
            </div>
            {showJobs && latest && (
              <div className="wfdrawer__jobs">
                {jobsByRun[latest.runId] === 'loading' && <p className="dim">Loading jobs…</p>}
                {Array.isArray(jobsByRun[latest.runId]) &&
                  (jobsByRun[latest.runId] as RunJob[]).map((j) => (
                    <a key={j.jobId} className="wfdrawer__job" href={j.htmlUrl} target="_blank" rel="noreferrer">
                      <span className={`led led--${jobLed(j)}`} /> {j.name}{' '}
                      <span className="dim">· {j.steps.length} steps ↗</span>
                    </a>
                  ))}
                {Array.isArray(jobsByRun[latest.runId]) &&
                  (jobsByRun[latest.runId] as RunJob[]).length === 0 && <p className="dim">No jobs.</p>}
              </div>
            )}
          </section>

          {/* ── Capabilities ── */}
          <section>
            <h3 className="panel__eyebrow">Capabilities</h3>
            <dl className="wfdrawer__dl">
              <Row label="Triggers">
                {facts.triggers.length
                  ? facts.triggers.map((t) => t.kind + (t.detail ? ` (${t.detail})` : '')).join(' · ')
                  : '—'}
              </Row>
              {(facts.crons.length > 0 || facts.dormantCrons.length > 0) && (
                <Row label="Schedule">
                  {facts.crons.map((c) => (
                    <code key={c} className="wfdrawer__cron">{c}</code>
                  ))}
                  {facts.dormantCrons.map((c) => (
                    <code key={`d-${c}`} className="wfdrawer__cron wfdrawer__cron--dormant" title="Commented-out / dormant">
                      💤 {c}
                    </code>
                  ))}
                </Row>
              )}
              {ai.present && (
                <Row label="AI engine">
                  <span className="wfdrawer__ai">
                    {ai.runners.map((r) => (
                      <span
                        key={r}
                        className={`flagchip${r === 'agentic-engine' ? ' flagchip--high-cost-low-value' : ''}`}
                        title={r === 'agentic-engine' ? 'The agentic quest engine — the fleet’s biggest AI cost centre' : undefined}
                      >
                        {r}
                      </span>
                    ))}
                  </span>
                  <span className="wfdrawer__aimeta">
                    {ai.models.length > 0 && <>models: {ai.models.join(', ')} · </>}
                    {ai.maxTurns != null && <>max-turns {ai.maxTurns} · </>}
                    {ai.maxCostUsd != null && <>≤ ${ai.maxCostUsd}/run · </>}
                    auth {ai.authMode}
                    {ai.agents.length > 0 && <> · agents: {ai.agents.join(', ')}</>}
                  </span>
                </Row>
              )}
              {facts.killSwitches.length > 0 && (
                <Row label="Kill switches">
                  {facts.killSwitches.map((k) => {
                    const armed = varsByName.get(k) === 'true';
                    return (
                      <span key={k} className={armed ? 'armed' : 'dim'} title={`vars.${k}`}>
                        {armed ? '⚡ ' : '○ '}
                        {k} {armed ? 'armed' : 'disarmed'}
                      </span>
                    );
                  })}
                </Row>
              )}
              {facts.guards.length > 0 && (
                <Row label="Guards">
                  <span className="wfdrawer__chips">
                    {facts.guards.map((g) => (
                      <span key={g} className="flagchip">{g}</span>
                    ))}
                  </span>
                </Row>
              )}
              {facts.waitBound && (
                <Row label="Wait-bound">
                  <span className="wfdrawer__warn">
                    Burns minutes polling — retire with required checks + <code>--auto</code>.
                  </span>
                </Row>
              )}
              <Row label="Permissions">
                {facts.permissions.writeScopes.length > 0 ? (
                  <>
                    write: {facts.permissions.writeScopes.join(', ')}
                    {facts.permissions.topLevelWrite && (
                      <span className="wfdrawer__warn"> · top-level write (prefer job-level)</span>
                    )}
                  </>
                ) : facts.permissions.topLevelRead ? (
                  'read-only'
                ) : (
                  '—'
                )}
              </Row>
              {facts.tokenChain.length > 0 && (
                <Row label="Token chain">{facts.tokenChain.join(' → ')}</Row>
              )}
            </dl>
          </section>

          {/* ── Cost & metrics ── */}
          <section>
            <h3 className="panel__eyebrow">Cost &amp; metrics · window</h3>
            {metrics ? (
              <div className="wfdrawer__metrics">
                <Metric label="runs" value={String(metrics.runs)} />
                <Metric label="burned" value={fmtMin(metrics.totalMin)} />
                <Metric label="waste" value={fmtMin(metrics.wasteMin)} alarm={metrics.wasteMin > 0} />
                <Metric label="p95" value={fmtMin(metrics.p95Min)} />
                <Metric label="rework" value={`${metrics.reworkPct}%`} />
                <Metric label="effective" value={`${metrics.effectivenessPct}%`} />
                {metrics.flags.length > 0 && (
                  <span className="wfdrawer__chips">
                    {metrics.flags.map((f) => (
                      <span key={f} className={`flagchip flagchip--${f}`}>{f}</span>
                    ))}
                  </span>
                )}
              </div>
            ) : (
              <p className="dim">No runs recorded for this workflow in the window.</p>
            )}
          </section>

          {/* ── Audit findings for this workflow ── */}
          {findings.length > 0 && (
            <section>
              <h3 className="panel__eyebrow">Audit findings</h3>
              <ul className="findings">
                {findings.map((f, i) => (
                  <li key={`${f.ruleId}:${i}`} className={`finding finding--${f.severity}`}>
                    <span className="finding__sev">
                      {f.severity === 'fail' ? '✗' : f.severity === 'warn' ? '!' : '·'}
                    </span>
                    <span className="finding__body">
                      {f.message}
                      <span className="finding__fix">Fix: {f.fix}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Management actions (each confirmed) ── */}
          <section>
            <h3 className="panel__eyebrow">Manage</h3>
            <div className="wfdrawer__actions">
              <button
                type="button"
                className="btn btn--small"
                disabled={busy('dispatch')}
                onClick={() =>
                  setPending({
                    verb: 'Run now',
                    consequence: `dispatch a fresh run of “${facts.name}” in ${slug} on its default branch`,
                    act: () => void store().dispatchWorkflowFile(slug, facts.path),
                  })
                }
              >
                ▶ Run now
              </button>
              <button
                type="button"
                className="btn btn--small"
                disabled={!hasFailed || busy('rerun')}
                title={hasFailed ? 'Re-run the newest failed run' : 'No failed run in the window'}
                onClick={() =>
                  setPending({
                    verb: 'Re-run last failure',
                    consequence: `re-run the newest failed run of “${facts.name}” in ${slug} (retries all jobs)`,
                    act: () => void store().rerunLatestFailed(slug, facts.path),
                  })
                }
              >
                ↻ Re-run last failure
              </button>
              {inProgress && (
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={busy('cancel')}
                  onClick={() =>
                    setPending({
                      verb: 'Cancel run',
                      consequence: `cancel the in-progress run of “${facts.name}” in ${slug}`,
                      act: () => void store().cancelRunById(slug, inProgress.runId),
                    })
                  }
                >
                  ✕ Cancel run
                </button>
              )}
              {facts.killSwitches.map((k) => {
                const armed = varsByName.get(k) === 'true';
                return (
                  <button
                    key={k}
                    type="button"
                    className="btn btn--small"
                    disabled={busy(`kill:${k}`)}
                    title={`vars.${k}`}
                    onClick={() =>
                      setPending({
                        verb: armed ? `Disarm ${k}` : `Arm ${k}`,
                        consequence: armed
                          ? `disarm vars.${k} in ${slug} — “${facts.name}” will short-circuit at its gate and stop doing work`
                          : `arm vars.${k} in ${slug} — “${facts.name}” will resume firing on its schedule/triggers`,
                        act: () => void store().setKillSwitch(slug, k, !armed),
                      })
                    }
                  >
                    {armed ? `○ Disarm ${k}` : `⚡ Arm ${k}`}
                  </button>
                );
              })}
              {wfState && (
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={busy(`enable:${wfState.id}`)}
                  onClick={() =>
                    setPending({
                      verb: enabled ? 'Disable workflow' : 'Enable workflow',
                      consequence: enabled
                        ? `disable “${facts.name}” in ${slug} — GitHub will stop triggering the file (running jobs unaffected)`
                        : `enable “${facts.name}” in ${slug} — GitHub will resume triggering the file`,
                      act: () => void store().setWorkflowEnabledById(slug, wfState.id, !enabled),
                    })
                  }
                >
                  {enabled ? '⏻ Disable workflow' : '⏻ Enable workflow'}
                </button>
              )}
            </div>
            <p className="wfdrawer__hint dim">
              Arm/disarm toggles the <code>vars.*_ENABLED</code> gate (the fleet convention);
              enable/disable stops GitHub from triggering the file entirely.
            </p>
          </section>
        </div>
      </div>

      {pending && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm action">
          <div className="modal__panel">
            <div className="modal__head">
              <span className="modal__title">Confirm · {pending.verb}</span>
              <button type="button" className="modal__x" onClick={() => setPending(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal__body">
              <p className="wfdrawer__confirm">
                This will <b>{pending.consequence}</b>.
              </p>
              <p className="modal__note">The board re-scans afterwards so it reflects reality.</p>
            </div>
            <div className="modal__foot">
              <button type="button" className="btn" ref={confirmCancelRef} onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  pending.act();
                  setPending(null);
                }}
              >
                {pending.verb}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One compact metric readout in the cost strip. */
function Metric({ label, value, alarm }: { label: string; value: string; alarm?: boolean }) {
  return (
    <span className="wfdrawer__metric">
      <span className={`wfdrawer__metricnum${alarm ? ' stat__num--alarm' : ''}`}>{value}</span>
      <span className="wfdrawer__metriclbl">{label}</span>
    </span>
  );
}
