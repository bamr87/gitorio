import './settings.css';
import { useState } from 'react';
import { ConnectDialog } from './ConnectDialog';
import { useGithubStore } from '../state/github';
import { useSettingsStore } from '../state/settings';
import { repoSlug, type PermState } from '../github/types';

const PERM_MARK: Record<PermState, string> = { ok: '✓', missing: '✗', unknown: '?' };
const PERM_ROWS: [keyof NonNullable<ReturnType<typeof useGithubStore.getState>['preflight']>, string][] = [
  ['contents', 'Contents (RW)'],
  ['workflows', 'Workflows (RW)'],
  ['issues', 'Issues (RW)'],
  ['pullRequests', 'Pull requests (RW)'],
  ['actions', 'Actions (R)'],
  ['secrets', 'Secrets (RW)'],
];
const POLL_OPTIONS = [10_000, 15_000, 30_000, 60_000];
const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'];

export function SettingsPanel() {
  const login = useGithubStore((s) => s.login);
  const repo = useGithubStore((s) => s.repo);
  const preflight = useGithubStore((s) => s.preflight);
  const disconnect = useGithubStore((s) => s.disconnect);
  const switchRepo = useGithubStore((s) => s.switchRepo);
  const connecting = useGithubStore((s) => s.connecting);

  const recentRepos = useSettingsStore((s) => s.recentRepos);
  const defaultDeployMode = useSettingsStore((s) => s.defaultDeployMode);
  const pollMs = useSettingsStore((s) => s.pollMs);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const { setDefaultDeployMode, setPollMs, setDefaultModel, removeRecentRepo } = useSettingsStore.getState();

  const [connectOpen, setConnectOpen] = useState(false);
  const current = repo ? repoSlug(repo) : null;

  return (
    <div className="tabpane settingspane">
      <div className="settings">
        {/* ── Session ── */}
        <section className="settings__sec">
          <div className="panel__eyebrow">Session</div>
          {login ? (
            <>
              <p className="settings__line">Connected as <b>{login}</b>{current && <> · <b>{current}</b></>}</p>
              <div className="settings__perms">
                {PERM_ROWS.map(([key, label]) => {
                  const state = (preflight?.[key] as PermState | undefined) ?? 'unknown';
                  return (
                    <span key={key} className={`perm perm--${state}`} title={state}>
                      {PERM_MARK[state]} {label}
                    </span>
                  );
                })}
              </div>
              {preflight && <p className="settings__note">{preflight.canDeploy ? '✓ can deploy (Contents + Workflows present)' : '✗ cannot deploy — needs Contents + Workflows (RW)'}</p>}
              <p className="settings__note">The PAT lives in <b>sessionStorage only</b> — closing the tab forgets it.</p>
              <button type="button" className="btn btn--small" onClick={disconnect}>Disconnect</button>
            </>
          ) : (
            <>
              <p className="settings__note">Not connected.</p>
              <button type="button" className="btn btn--small" onClick={() => setConnectOpen(true)}>Connect</button>
            </>
          )}
        </section>

        {/* ── Connections ── */}
        <section className="settings__sec">
          <div className="panel__eyebrow">Connections</div>
          {recentRepos.length === 0 ? (
            <p className="settings__note">No remembered repos yet. Connections persist <b>slugs only</b> (never tokens); switching reuses the session PAT.</p>
          ) : (
            <div className="settings__repos">
              {recentRepos.map((slug) => (
                <div key={slug} className={`settings__repo${slug === current ? ' is-current' : ''}`}>
                  <span className="settings__reposlug">{slug}{slug === current && ' · current'}</span>
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={!login || connecting || slug === current}
                    title={!login ? 'Connect first — switching reuses the session token' : 'Switch this session to that repo'}
                    onClick={() => void switchRepo(slug)}
                  >
                    Switch
                  </button>
                  <button type="button" className="iconbtn iconbtn--danger" title="Forget this repo" onClick={() => removeRecentRepo(slug)}>🗑</button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Preferences ── */}
        <section className="settings__sec">
          <div className="panel__eyebrow">Preferences</div>
          <div className="field">
            <span className="field__label">Default deploy mode</span>
            <div className="settings__radios">
              <label><input type="radio" name="deploymode" checked={defaultDeployMode === 'pr'} onChange={() => setDefaultDeployMode('pr')} /> Pull request</label>
              <label><input type="radio" name="deploymode" checked={defaultDeployMode === 'commit'} onChange={() => setDefaultDeployMode('commit')} /> Commit to default branch</label>
            </div>
            <span className="field__help">Prefills the Deploy modal.</span>
          </div>
          <label className="field">
            <span className="field__label">Telemetry poll interval</span>
            <select value={pollMs} onChange={(e) => setPollMs(Number(e.target.value))}>
              {POLL_OPTIONS.map((ms) => <option key={ms} value={ms}>{ms / 1000}s</option>)}
            </select>
            <span className="field__help">How often the Monitor / LED pollers refresh runs.</span>
          </label>
          <label className="field">
            <span className="field__label">Default agent model</span>
            <select value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="field__help">Prefilled on new Claude-agent machines.</span>
          </label>
        </section>

        {/* ── Maintenance ── */}
        <section className="settings__sec">
          <div className="panel__eyebrow">Maintenance</div>
          <div className="settings__radios">
            <button type="button" className="btn btn--small" onClick={() => recentRepos.forEach(removeRecentRepo)}>Forget all connections</button>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => { setDefaultDeployMode('pr'); setPollMs(15_000); setDefaultModel('claude-sonnet-4-6'); }}
            >
              Reset preferences
            </button>
          </div>
        </section>
      </div>
      {connectOpen && <ConnectDialog onClose={() => setConnectOpen(false)} />}
    </div>
  );
}
