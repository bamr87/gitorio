import { useState } from 'react';
import { useGithubStore } from '../state/github';
import { repoSlug, type PermState, type Preflight } from '../github/types';

const CHECKS: { key: keyof Preflight; label: string; hint: string }[] = [
  { key: 'contents', label: 'Contents', hint: 'RW — blueprint & prompts' },
  { key: 'workflows', label: 'Workflows', hint: 'RW — push factory--*.yml' },
  { key: 'issues', label: 'Issues', hint: 'RW — issue sinks' },
  { key: 'pullRequests', label: 'Pull requests', hint: 'RW — PR mode & sinks' },
  { key: 'actions', label: 'Actions', hint: 'R — telemetry' },
  { key: 'secrets', label: 'Secrets', hint: 'RW — power hookup' },
];

function ledClass(state: PermState): string {
  if (state === 'ok') return 'led led--on';
  if (state === 'missing') return 'led led--bad';
  return 'led led--warn';
}

export function ConnectDialog({ onClose }: { onClose: () => void }) {
  const { connect, disconnect, loadFactory, connecting, error, preflight, login, repo, power } = useGithubStore();
  const [token, setToken] = useState('');
  const [repoInput, setRepoInput] = useState(() => (repo ? repoSlug(repo) : ''));

  const loadFromRepo = async () => {
    if (await loadFactory()) onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await connect(token, repoInput);
    if (ok) setToken(''); // don't keep the PAT in a React field longer than needed
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Connect a repository">
      <div className="modal__panel">
        <div className="modal__head">
          <span className="modal__title">⚡ Connect repository</span>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form className="modal__body" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Fine-grained PAT</span>
            <input
              type="password"
              value={token}
              autoComplete="off"
              placeholder={login ? '•••••••• (connected)' : 'github_pat_…'}
              onChange={(e) => setToken(e.target.value)}
            />
            <span className="field__help">
              Held in sessionStorage only, this tab, wiped on disconnect. Needs Contents + Workflows (RW).
            </span>
          </label>

          <label className="field">
            <span className="field__label">Repository</span>
            <input
              type="text"
              value={repoInput}
              placeholder="owner/name"
              onChange={(e) => setRepoInput(e.target.value)}
            />
          </label>

          <button className="btn btn--primary" type="submit" disabled={connecting}>
            {connecting ? 'Connecting…' : login ? 'Reconnect / preflight' : 'Connect & preflight'}
          </button>

          {error && <p className="modal__err">{error}</p>}

          {preflight && (
            <>
              <ul className="preflight" aria-label="Permission preflight">
                {CHECKS.map((c) => (
                  <li key={c.key} className="preflight__row">
                    <span className={ledClass(preflight[c.key] as PermState)} />
                    {c.label}
                    <span className="dim">{c.hint}</span>
                  </li>
                ))}
              </ul>
              <p className="modal__note">
                {preflight.canDeploy
                  ? `✓ ${login} can deploy to ${repo ? repoSlug(repo) : ''}. Power: ${power}.`
                  : '✗ Contents (RW) is required before you can deploy. Grant it on the token and reconnect.'}
              </p>
              <button type="button" className="btn" onClick={loadFromRepo}>
                ↓ Load blueprint from repo
              </button>
            </>
          )}
        </form>

        <div className="modal__foot">
          {login && (
            <button type="button" className="btn" onClick={disconnect}>
              Disconnect
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {preflight?.canDeploy ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
