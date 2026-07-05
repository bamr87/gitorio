import { useEffect, useRef, useState } from 'react';
import { useFactoryStore } from '../state/store';
import { useGithubStore } from '../state/github';
import { repoSlug, type DeployPlan, type DriftItem } from '../github/types';
import { buildDeployPlan, detectDrift } from '../github/deploy';
import { gatherRepoState, executePlan, type DeployOutcome } from '../github/execute';
import { sealSecret } from '../github/crypto';
import { useSettingsStore } from '../state/settings';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function DeployModal({ onClose }: { onClose: () => void }) {
  const client = useGithubStore((s) => s.client);
  const repo = useGithubStore((s) => s.repo);
  const power = useGithubStore((s) => s.power);
  const setPower = useGithubStore((s) => s.setPower);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  const meta = useFactoryStore((s) => s.meta);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [plan, setPlan] = useState<DeployPlan | null>(null);
  const [drift, setDrift] = useState<DriftItem[]>([]);
  const [prMode, setPrMode] = useState(useSettingsStore.getState().defaultDeployMode === 'pr');
  const [deploying, setDeploying] = useState(false);
  const [outcome, setOutcome] = useState<DeployOutcome | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  const keyRef = useRef<HTMLInputElement>(null);
  const [powerSecret, setPowerSecret] = useState<'CLAUDE_CODE_OAUTH_TOKEN' | 'ANTHROPIC_API_KEY'>(
    'CLAUDE_CODE_OAUTH_TOKEN',
  );
  const [powerBusy, setPowerBusy] = useState(false);
  const [powerMsg, setPowerMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !repo) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const bp = toBlueprint();
        const state = await gatherRepoState(client, repo);
        if (cancelled) return;
        setPlan(buildDeployPlan(bp, state));
        setDrift(detectDrift(state.workflowFiles, bp).filter((d) => d.drifted));
      } catch (e) {
        if (!cancelled) setLoadError(errMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, repo, toBlueprint]);

  const changes = plan ? plan.writes.length + plan.deletes.length : 0;

  const deploy = async () => {
    if (!client || !repo || !plan) return;
    setDeploying(true);
    setDeployError(null);
    try {
      setOutcome(await executePlan(client, repo, plan, { mode: prMode ? 'pr' : 'commit', meta }));
    } catch (e) {
      setDeployError(errMessage(e));
    } finally {
      setDeploying(false);
    }
  };

  const connectPower = async () => {
    if (!client || !repo) return;
    const key = keyRef.current?.value ?? '';
    if (!key.trim()) {
      setPowerMsg(`Paste a ${powerSecret} value.`);
      return;
    }
    setPowerBusy(true);
    setPowerMsg(null);
    try {
      const pk = await client.getActionsPublicKey(repo);
      const encrypted = sealSecret(pk.key, key.trim());
      await client.putSecret(repo, powerSecret, encrypted, pk.keyId);
      if (keyRef.current) keyRef.current.value = ''; // never retain plaintext
      setPower('on');
      setPowerMsg(`Power connected ⚡ — ${powerSecret} set. The factory can run.`);
    } catch (e) {
      setPowerMsg(errMessage(e));
    } finally {
      setPowerBusy(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Deploy factory">
      <div className="modal__panel modal__panel--wide">
        <div className="modal__head">
          <span className="modal__title">🚀 Deploy {repo ? `→ ${repoSlug(repo)}` : ''}</span>
          <button className="modal__x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal__body">
          {loading && <p className="modal__note">Computing deploy plan…</p>}
          {loadError && <p className="modal__err">{loadError}</p>}

          {!loading && !loadError && plan && (
            <>
              {drift.length > 0 && (
                <p className="modal__note" style={{ color: 'var(--copper)' }}>
                  ⚠ Manual edits detected in {drift.length} deployed workflow
                  {drift.length > 1 ? 's' : ''} — deploying will overwrite them with the current blueprint.
                </p>
              )}

              <div className="plan">
                {changes === 0 && <p className="plan__empty">Nothing to deploy — the repo already matches the canvas.</p>}
                {plan.writes.map((w) => (
                  <div key={w.path} className="plan__row plan__row--write">
                    <span className="plan__mark">＋</span>
                    {w.path}
                    <span className="plan__reason">{w.sha ? 'update' : 'create'} · {w.reason}</span>
                  </div>
                ))}
                {plan.deletes.map((d) => (
                  <div key={d.path} className="plan__row plan__row--del">
                    <span className="plan__mark">－</span>
                    {d.path}
                    <span className="plan__reason">delete</span>
                  </div>
                ))}
              </div>

              {plan.warnings.map((w, i) => (
                <p key={i} className="diag diag--warning" style={{ margin: '8px 0 0' }}>
                  {w}
                </p>
              ))}

              <label className="check">
                <input type="checkbox" checked={prMode} onChange={(e) => setPrMode(e.target.checked)} />
                Propose changes as a pull request (instead of committing to the default branch)
              </label>

              <div className="power-hookup">
                <div className="power-hookup__title">
                  <span className={`led led--${power === 'on' ? 'on' : power === 'off' ? 'bad' : 'warn'}`} /> Power ·{' '}
                  {power === 'on' ? 'connected' : power === 'off' ? 'not set' : 'unknown'}
                </div>
                <div className="power-hookup__choice">
                  <label>
                    <input
                      type="radio"
                      name="powerSecret"
                      checked={powerSecret === 'CLAUDE_CODE_OAUTH_TOKEN'}
                      onChange={() => setPowerSecret('CLAUDE_CODE_OAUTH_TOKEN')}
                    />
                    Claude Code OAuth <span className="dim">default</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="powerSecret"
                      checked={powerSecret === 'ANTHROPIC_API_KEY'}
                      onChange={() => setPowerSecret('ANTHROPIC_API_KEY')}
                    />
                    Anthropic API key <span className="dim">fallback</span>
                  </label>
                </div>
                <label className="field">
                  <span className="field__label">{powerSecret}</span>
                  <input
                    key={powerSecret}
                    ref={keyRef}
                    type="password"
                    autoComplete="off"
                    placeholder={
                      powerSecret === 'CLAUDE_CODE_OAUTH_TOKEN'
                        ? 'from `claude setup-token` (sealed-box, never stored)'
                        : 'sk-ant-… (sealed-box, never stored)'
                    }
                    defaultValue={
                      import.meta.env.DEV
                        ? powerSecret === 'CLAUDE_CODE_OAUTH_TOKEN'
                          ? import.meta.env.VITE_CLAUDE_CODE_OAUTH_TOKEN
                          : import.meta.env.VITE_ANTHROPIC_API_KEY
                        : undefined
                    }
                  />
                  <span className="field__help">
                    Encrypted in-browser with the repo public key (libsodium sealed box) and PUT as the{' '}
                    <b>{powerSecret}</b> Actions secret. The plaintext never touches app state, storage, or the blueprint.
                  </span>
                </label>
                <button type="button" className="btn" onClick={connectPower} disabled={powerBusy}>
                  {powerBusy ? 'Provisioning…' : '⚡ Connect power'}
                </button>
                {powerMsg && <p className="modal__note">{powerMsg}</p>}
              </div>

              {deployError && <p className="modal__err">{deployError}</p>}
              {outcome && (
                <p className="modal__note" style={{ color: 'var(--signal)' }}>
                  ✓ Deployed {outcome.changes} change{outcome.changes === 1 ? '' : 's'}
                  {outcome.mode === 'pr' && outcome.prUrl ? (
                    <>
                      {' '}as a PR:{' '}
                      <a href={outcome.prUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--copper)' }}>
                        {outcome.prUrl}
                      </a>
                    </>
                  ) : (
                    ' to the default branch.'
                  )}
                </p>
              )}
            </>
          )}
        </div>

        <div className="modal__foot">
          <button className="btn" onClick={onClose}>
            {outcome ? 'Done' : 'Cancel'}
          </button>
          <button className="btn btn--primary" onClick={deploy} disabled={loading || deploying || changes === 0 || !!outcome}>
            {deploying ? 'Deploying…' : prMode ? 'Open deploy PR' : 'Deploy'}
          </button>
        </div>
      </div>
    </div>
  );
}
