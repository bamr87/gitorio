import { useTelemetryStore } from '../state/telemetry';
import { ledForRun } from '../github/telemetry';
import { useGithubStore } from '../state/github';
import { repoSlug, type FactoryRun } from '../github/types';

function durationSec(run: FactoryRun): number {
  const end = Date.parse(run.updatedAt);
  const start = Date.parse(run.runStartedAt ?? run.createdAt);
  return Number.isFinite(end) && Number.isFinite(start) ? Math.max(0, (end - start) / 1000) : 0;
}

function fmtDur(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 90) return `${Math.round(sec)}s`;
  return `${Math.round(sec / 60)}m`;
}

function fmtAgo(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${Math.round(s)}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

const pct = (r: number | null): string => (r === null ? '—' : `${Math.round(r * 100)}%`);

export function TelemetryPanel({ onClose }: { onClose: () => void }) {
  const runs = useTelemetryStore((s) => s.runs);
  const stats = useTelemetryStore((s) => s.stats);
  const polling = useTelemetryStore((s) => s.polling);
  const lastPolledAt = useTelemetryStore((s) => s.lastPolledAt);
  const error = useTelemetryStore((s) => s.error);
  const poll = useTelemetryStore((s) => s.poll);
  const repo = useGithubStore((s) => s.repo);

  return (
    <aside className="telemetry" aria-label="Telemetry">
      <div className="telemetry__head">
        <span className={`led ${polling ? 'led--warn' : 'led--idle'}`} />
        <span className="telemetry__title">📊 TELEMETRY</span>
        <span className="telemetry__repo">{repo ? repoSlug(repo) : ''}</span>
        <button type="button" className="modal__x" onClick={onClose} aria-label="Close telemetry">
          ×
        </button>
      </div>

      <div className="telemetry__stats">
        <div className="stat">
          <span className="stat__num">{stats?.total ?? 0}</span>
          <span className="stat__lbl">runs</span>
        </div>
        <div className="stat">
          <span className="stat__num">{pct(stats?.successRate ?? null)}</span>
          <span className="stat__lbl">success</span>
        </div>
        <div className="stat">
          <span className="stat__num">{stats?.inProgress ?? 0}</span>
          <span className="stat__lbl">running</span>
        </div>
        <div className="stat">
          <span className="stat__num">{fmtDur(stats?.p50DurationSec ?? null)}</span>
          <span className="stat__lbl">p50</span>
        </div>
      </div>

      <div className="telemetry__runs">
        {runs.length === 0 && (
          <p className="telemetry__empty">
            {polling ? 'No factory runs yet. Deploy a line and trigger it.' : 'Paused.'}
          </p>
        )}
        {runs.slice(0, 20).map((r) => (
          <a
            key={r.runId}
            className="run"
            href={r.htmlUrl}
            target="_blank"
            rel="noreferrer"
            title={`${r.status}${r.conclusion ? ` · ${r.conclusion}` : ''}`}
          >
            <span className={`led led--${ledForRun(r)}`} />
            <span className="run__slug">{r.slug}</span>
            <span className="run__event">{r.event}</span>
            <span className="run__concl">{r.status === 'completed' ? r.conclusion ?? '—' : r.status}</span>
            <span className="run__dur">{r.status === 'completed' ? fmtDur(durationSec(r)) : '·'}</span>
          </a>
        ))}
      </div>

      <div className="telemetry__foot">
        {error ? (
          <span className="telemetry__err">{error}</span>
        ) : (
          <span className="telemetry__ago">polled {fmtAgo(lastPolledAt)}</span>
        )}
        <button type="button" className="btn btn--small" onClick={() => void poll()}>
          Refresh
        </button>
      </div>
    </aside>
  );
}
