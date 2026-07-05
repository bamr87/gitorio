import { useEffect, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import './theme.css';
import { FactoryCanvas } from './canvas/FactoryCanvas';
import { FleetView } from './canvas/FleetView';
import { Palette } from './panels/Palette';
import { Inspector } from './panels/Inspector';
import { CompileDrawer } from './panels/CompileDrawer';
import { ConnectDialog } from './panels/ConnectDialog';
import { DeployModal } from './panels/DeployModal';
import { TelemetryPanel } from './panels/TelemetryPanel';
import { PromptStudio } from './panels/PromptStudio';
import { MonitorPanel } from './panels/MonitorPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { TemplateGallery } from './panels/TemplateGallery';
import { useFactoryStore } from './state/store';
import { useGithubStore } from './state/github';
import { useTelemetryStore } from './state/telemetry';
import { useUiStore, type AppView } from './state/ui';
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

const TABS: { id: AppView; label: string; icon: string; title: string }[] = [
  { id: 'build', label: 'Build', icon: '⚒', title: 'Design the factory: machines, belts, compile' },
  { id: 'prompts', label: 'Prompts', icon: '📜', title: 'Prompt Studio — edit the agents’ operating instructions' },
  { id: 'monitor', label: 'Monitor', icon: '📊', title: 'Runs, per-line stats, schedules, controls' },
  { id: 'fleet', label: 'Fleet', icon: '🛰', title: 'Observe any repo’s workflows; switch between repos' },
  { id: 'settings', label: 'Settings', icon: '⚙', title: 'Connections and preferences' },
];

export default function App() {
  const meta = useFactoryStore((s) => s.meta);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  const loadBlueprint = useFactoryStore((s) => s.loadBlueprint);
  const undo = useFactoryStore((s) => s.undo);
  const redo = useFactoryStore((s) => s.redo);
  const login = useGithubStore((s) => s.login);
  const repo = useGithubStore((s) => s.repo);
  const power = useGithubStore((s) => s.power);
  const canDeploy = useGithubStore((s) => s.preflight?.canDeploy ?? false);
  const drift = useGithubStore((s) => s.drift);
  const clearDrift = useGithubStore((s) => s.clearDrift);
  const restore = useGithubStore((s) => s.restore);
  const telemetryStart = useTelemetryStore((s) => s.start);
  const telemetryStop = useTelemetryStore((s) => s.stop);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const fileRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'connect' | 'deploy' | 'templates'>(null);
  const [showTelemetry, setShowTelemetry] = useState(false);

  // Reconnect from a sessionStorage PAT if this tab already has one.
  useEffect(() => {
    restore();
  }, [restore]);

  // Undo/redo keyboard shortcuts (Build tab only — text inputs are exempt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUiStore.getState().view !== 'build') return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // The floating LED-telemetry poller follows its panel; stop on unmount/disconnect.
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
        <nav className="tabs" aria-label="App sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab${view === t.id ? ' is-active' : ''}`}
              title={t.title}
              aria-current={view === t.id ? 'page' : undefined}
              onClick={() => setView(t.id)}
            >
              <span aria-hidden>{t.icon}</span> {t.label}
            </button>
          ))}
        </nav>
        <span className="topbar__spacer" />
        {view === 'build' && (
          <>
            <button className="btn" onClick={() => setDialog('templates')} title="Stamp a ready-made factory blueprint">
              📐 Templates
            </button>
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
            {login && (
              <button
                type="button"
                className={`btn${showTelemetry ? ' btn--primary' : ''}`}
                onClick={toggleTelemetry}
                title="Poll factory workflow runs and light up the machines"
              >
                📊 LEDs
              </button>
            )}
          </>
        )}
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
        <span className="power" title="Power = Claude auth secret on the target repo (CLAUDE_CODE_OAUTH_TOKEN, or ANTHROPIC_API_KEY fallback).">
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

      {view === 'build' && drift.length > 0 && (
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

      {view === 'build' && (
        <>
          <div className="workspace">
            <Palette />
            <FactoryCanvas />
            <Inspector />
          </div>
          <CompileDrawer />
        </>
      )}
      {view === 'prompts' && <PromptStudio />}
      {view === 'monitor' && <MonitorPanel />}
      {view === 'fleet' && <FleetView />}
      {view === 'settings' && <SettingsPanel />}

      {flash && <div className="flash">{flash}</div>}
      {view === 'build' && showTelemetry && <TelemetryPanel onClose={toggleTelemetry} />}
      {dialog === 'connect' && <ConnectDialog onClose={() => setDialog(null)} />}
      {dialog === 'deploy' && <DeployModal onClose={() => setDialog(null)} />}
      {dialog === 'templates' && <TemplateGallery onClose={() => setDialog(null)} />}
    </div>
  );
}
