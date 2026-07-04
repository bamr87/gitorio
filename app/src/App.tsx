import { useEffect, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import './theme.css';
import { FactoryCanvas } from './canvas/FactoryCanvas';
import { FleetCanvas } from './canvas/FleetCanvas';
import { Palette } from './panels/Palette';
import { Inspector } from './panels/Inspector';
import { CompileDrawer } from './panels/CompileDrawer';
import { ConnectDialog } from './panels/ConnectDialog';
import { DeployModal } from './panels/DeployModal';
import { TelemetryPanel } from './panels/TelemetryPanel';
import { useFactoryStore } from './state/store';
import { useGithubStore } from './state/github';
import { useTelemetryStore } from './state/telemetry';
import { useFleetStore } from './state/fleet';
import { repoSlug } from './github/types';
import {
  decodeBlueprintString,
  encodeBlueprintString,
  type Blueprint,
} from './blueprint/types';

function download(filename: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function App() {
  const meta = useFactoryStore((s) => s.meta);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  const loadBlueprint = useFactoryStore((s) => s.loadBlueprint);
  const login = useGithubStore((s) => s.login);
  const repo = useGithubStore((s) => s.repo);
  const power = useGithubStore((s) => s.power);
  const canDeploy = useGithubStore((s) => s.preflight?.canDeploy ?? false);
  const drift = useGithubStore((s) => s.drift);
  const clearDrift = useGithubStore((s) => s.clearDrift);
  const restore = useGithubStore((s) => s.restore);
  const telemetryStart = useTelemetryStore((s) => s.start);
  const telemetryStop = useTelemetryStore((s) => s.stop);
  const observeMode = useFleetStore((s) => s.mode);
  const fleet = useFleetStore((s) => s.fleet);
  const observeLoading = useFleetStore((s) => s.loading);
  const observeError = useFleetStore((s) => s.error);
  const observePolling = useFleetStore((s) => s.polling);
  const observeCurrentRepo = useFleetStore((s) => s.observeCurrentRepo);
  const exitObserve = useFleetStore((s) => s.exitObserve);
  const fileRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'connect' | 'deploy'>(null);
  const [showTelemetry, setShowTelemetry] = useState(false);

  // Reconnect from a sessionStorage PAT if this tab already has one.
  useEffect(() => {
    restore();
  }, [restore]);

  // Polling follows the panel: only the open factory polls (ARCHITECTURE §6). Stop on
  // unmount, and stop + hide if the repo disconnects out from under an open panel.
  useEffect(() => () => telemetryStop(), [telemetryStop]);
  useEffect(() => {
    if (!login && showTelemetry) {
      telemetryStop();
      setShowTelemetry(false);
    }
  }, [login, showTelemetry, telemetryStop]);

  const toggleTelemetry = () => {
    if (showTelemetry) {
      telemetryStop();
      setShowTelemetry(false);
    } else {
      telemetryStart();
      setShowTelemetry(true);
    }
  };

  const toggleObserve = async () => {
    if (observeMode === 'observe') {
      exitObserve();
      return;
    }
    // one live poll loop at a time — leave the authoring telemetry panel first.
    if (showTelemetry) {
      telemetryStop();
      setShowTelemetry(false);
    }
    const ok = await observeCurrentRepo();
    if (!ok) say(useFleetStore.getState().error ?? 'Could not import workflows.');
  };

  const say = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2500);
  };

  const importFile = async (file: File) => {
    try {
      loadBlueprint(JSON.parse(await file.text()) as Blueprint);
      say('Blueprint loaded.');
    } catch {
      say('That file is not a valid blueprint.');
    }
  };

  const importString = () => {
    const s = window.prompt('Paste a blueprint string:');
    if (!s) return;
    try {
      loadBlueprint(decodeBlueprintString(s.trim()));
      say('Blueprint loaded.');
    } catch {
      say('Could not decode that blueprint string.');
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
          <span className="topbar__logo">⚙ GITFACTORY</span>
          <span className="topbar__name">{meta.name}</span>
          <span className="topbar__spacer" />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <button className="btn" onClick={importString}>
            Paste string
          </button>
          <button
            className="btn"
            onClick={() => download(`${meta.name || 'blueprint'}.blueprint.json`, JSON.stringify(toBlueprint(), null, 2))}
          >
            Export JSON
          </button>
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(encodeBlueprintString(toBlueprint()));
              say('Blueprint string copied — share it like a Factorio blueprint.');
            }}
          >
            Copy string
          </button>
          <button type="button" className="btn" onClick={() => setDialog('connect')}>
            {login ? `⚡ ${repo ? repoSlug(repo) : login}` : 'Connect'}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canDeploy}
            title={canDeploy ? 'Deploy compiled workflows to the repo' : 'Connect a repo with Contents (RW) first'}
            onClick={() => setDialog('deploy')}
          >
            🚀 Deploy
          </button>
          {login && observeMode === 'author' && (
            <button
              type="button"
              className={`btn${showTelemetry ? ' btn--primary' : ''}`}
              onClick={toggleTelemetry}
              title="Poll factory workflow runs and light up the machines"
            >
              📊 Telemetry
            </button>
          )}
          {login && (
            <button
              type="button"
              className={`btn${observeMode === 'observe' ? ' btn--primary' : ''}`}
              onClick={() => void toggleObserve()}
              disabled={observeLoading}
              title="Import this repo's .github/workflows into a read-only fleet map"
            >
              {observeLoading ? 'Importing…' : observeMode === 'observe' ? '← Exit observe' : '🛰 Observe'}
            </button>
          )}
          <span className="power" title="Power = ANTHROPIC_API_KEY secret on the target repo.">
            <span className={`led led--${power === 'on' ? 'on' : power === 'off' ? 'off' : 'idle'}`} />
            {power === 'on' ? 'power' : power === 'off' ? 'no power' : '—'}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
        </header>

        {observeMode === 'author' && drift.length > 0 && (
          <div className="banner banner--drift">
            ⚠ {drift.length} deployed workflow{drift.length > 1 ? 's were' : ' was'} hand-edited since the last blueprint.
            <button type="button" className="btn" onClick={() => setDialog('deploy')}>
              Review &amp; redeploy
            </button>
            <button type="button" className="btn" onClick={clearDrift}>
              Dismiss
            </button>
          </div>
        )}

        {observeMode === 'observe' ? (
          <>
            <div className="observe-bar">
              <span className="observe-bar__title">
                🛰 Observing <b>{fleet ? repoSlug(fleet.repo) : ''}</b>
              </span>
              {fleet && (
                <span className="observe-bar__stat">
                  {fleet.workflows.length} workflows · {fleet.workflows.filter((w) => w.hasAgent).length} agents ·{' '}
                  {fleet.externalRepos.length} cross-repo
                </span>
              )}
              <span className="observe-bar__spacer" />
              <span className="observe-bar__legend" aria-hidden>
                <span className="led led--on" /> ok
                <span className="led led--warn" /> running
                <span className="led led--bad" /> failed
                <span className="led led--idle" /> idle
              </span>
              {observePolling && (
                <span className="observe-bar__poll">
                  <span className="led led--warn" /> live
                </span>
              )}
            </div>
            {observeError && <div className="banner banner--drift">{observeError}</div>}
            {fleet && fleet.warnings.length > 0 && (
              <div className="banner">
                ⚠ {fleet.warnings.length} note{fleet.warnings.length === 1 ? '' : 's'}: {fleet.warnings.join(' · ')}
              </div>
            )}
            <FleetCanvas />
          </>
        ) : (
          <>
            <div className="workspace">
              <Palette />
              <FactoryCanvas />
              <Inspector />
            </div>
            <CompileDrawer />
          </>
        )}
        {flash && <div className="flash">{flash}</div>}
        {showTelemetry && <TelemetryPanel onClose={toggleTelemetry} />}
        {dialog === 'connect' && <ConnectDialog onClose={() => setDialog(null)} />}
        {dialog === 'deploy' && <DeployModal onClose={() => setDialog(null)} />}
      </div>
  );
}
