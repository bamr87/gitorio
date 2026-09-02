// One `fleet/v1` lane, rendered the same everywhere (specs/014, FR-7): the Blueprint
// passport on the floor, the workflow passport in Fleet Observe, and the Harness tab.
// Presentation only — a lane is data the hub and GitFactory both commit.

import './harness.css';
import { Beacon, Chip } from '../ui/primitives';
import type { FleetLane } from './lanes';

export type SwitchState = 'armed' | 'disarmed' | 'unknown';

const KIND_TONE: Record<FleetLane['kind'], 'external' | 'security' | 'backend' | 'database' | 'frontend' | 'messagebus' | 'cloud' | 'idle'> = {
  mention: 'external',
  triage: 'frontend',
  review: 'frontend',
  content: 'backend',
  maintenance: 'backend',
  analysis: 'database',
  orchestrator: 'messagebus',
  fanout: 'cloud',
  other: 'idle',
};

function triggerWord(t: FleetLane['triggers'][number]): string {
  if (t.kind === 'schedule') return `schedule ${t.cron}`.trim();
  if (t.kind === 'dispatch') return 'dispatch';
  return t.events.length ? `on ${t.events.join(', ')}` : 'event';
}

export function HarnessCard({
  lane,
  switchState,
  compact = false,
}: {
  lane: FleetLane;
  /** The kill switch's live state when a repo variable was read; omit when unknown. */
  switchState?: SwitchState;
  compact?: boolean;
}) {
  const tone = KIND_TONE[lane.kind] ?? 'idle';
  return (
    <article className={`lane${compact ? ' lane--compact' : ''}`} aria-label={`Lane ${lane.id}`}>
      <header className="lane__head">
        <code className="lane__id">{lane.id}</code>
        <Chip tone={tone}>{lane.kind}</Chip>
        <Chip tone={lane.harness === 'claude-code-action' ? 'backend' : 'idle'}>{lane.harness}</Chip>
      </header>
      {!compact && lane.description && <p className="lane__desc">{lane.description}</p>}
      <dl className="lane__facts">
        <div className="lane__fact">
          <dt>triggers</dt>
          <dd>{lane.triggers.length ? lane.triggers.map(triggerWord).join(' · ') : '—'}</dd>
        </div>
        <div className="lane__fact">
          <dt>switch</dt>
          <dd>
            {lane.switch ? (
              <>
                <code>{lane.switch}</code>{' '}
                <Beacon
                  label={switchState === 'armed' ? 'armed' : switchState === 'disarmed' ? 'off' : 'switch'}
                  tone={switchState === 'armed' ? 'ok' : switchState === 'disarmed' ? 'idle' : 'warn'}
                  title={
                    switchState === 'armed'
                      ? 'The repo variable is true — the lane runs'
                      : switchState === 'disarmed'
                        ? 'The repo variable is unset or false — the lane idles'
                        : 'A kill switch guards this lane; its state was not read'
                  }
                />
              </>
            ) : (
              <span className="lane__none">none — runs whenever triggered</span>
            )}
          </dd>
        </div>
        <div className="lane__fact">
          <dt>tokens</dt>
          <dd>
            {lane.uses_tokens.length ? (
              <span className="lane__chips">
                {lane.uses_tokens.map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </span>
            ) : (
              <span className="lane__none">GITHUB_TOKEN only</span>
            )}
          </dd>
        </div>
        <div className="lane__fact">
          <dt>guardrails</dt>
          <dd>
            <span className="lane__chips">
              <Chip tone={lane.guardrails.never_merges ? 'ok' : 'bad'}>
                {lane.guardrails.never_merges ? 'never merges' : 'may merge'}
              </Chip>
              {lane.guardrails.opens_pull_requests !== undefined && (
                <Chip tone={lane.guardrails.opens_pull_requests ? 'frontend' : 'idle'}>
                  {lane.guardrails.opens_pull_requests ? 'opens PRs' : 'no PRs'}
                </Chip>
              )}
              {lane.guardrails.writable_paths?.length ? (
                <Chip tone="database">writes {lane.guardrails.writable_paths.join(', ')}</Chip>
              ) : null}
              {lane.guardrails.max_writes_per_run !== undefined && (
                <Chip>≤ {lane.guardrails.max_writes_per_run} writes/run</Chip>
              )}
            </span>
          </dd>
        </div>
        {!compact && lane.implementation && (
          <div className="lane__fact">
            <dt>file</dt>
            <dd>
              <code>{lane.implementation}</code>
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}
