import { useEffect, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import './theme.css';
import { FactoryCanvas } from './canvas/FactoryCanvas';
import { FleetView } from './canvas/FleetView';
import { Palette } from './panels/Palette';
import { BuildToolbar } from './panels/BuildToolbar';
import { Inspector } from './panels/Inspector';
import { CompileDrawer } from './panels/CompileDrawer';
import { ConnectDialog } from './panels/ConnectDialog';
import { DemoBanner } from './panels/DemoBanner';
import { DeployModal } from './panels/DeployModal';
import { TelemetryPanel } from './panels/TelemetryPanel';
import { PromptStudio } from './panels/PromptStudio';
import { ContentPanel } from './panels/ContentPanel';
import { DocsView } from './panels/DocsView';
import { MonitorPanel } from './panels/MonitorPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { TemplateGallery } from './panels/TemplateGallery';
import { useFactoryStore } from './state/store';
import { useGithubStore } from './state/github';
import { useTelemetryStore } from './state/telemetry';
import { useUiStore, type AppView } from './state/ui';
import { applyTheme, useSettingsStore } from './state/settings';
import { demoRequested, enterDemoMode, isDemoActive } from './demo/seed';
import { repoSlug } from './github/types';
import { decodeBlueprintString, encodeBlueprintString, type Blueprint } from './blueprint/types';

function download(filename: string, text: string) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next tick — revoking synchronously can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const TABS: { id: AppView; label: string; icon: string; title: string }[] = [
  { id: 'build', label: 'Build', icon: '⚒', title: 'Design the factory: machines, belts, compile' },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: '📜',
    title: 'Prompt Studio — edit the agents’ operating instructions',
  },
  {
    id: 'content',
    label: 'Content',
    icon: '📰',
    title: 'Headless-CMS cockpit — config, content backlog, kill switches',
  },
  {
    id: 'docs',
    label: 'Docs',
    icon: '📖',
    title: 'The rendered docs collection — the content factory’s visible output',
  },
  {
    id: 'monitor',
    label: 'Monitor',
    icon: '📊',
    title: 'Runs, per-line stats, schedules, controls',
  },
  {
    id: 'fleet',
    label: 'Fleet',
    icon: '🛰',
    title: 'Observe any repo’s workflows; switch between repos',
  },
  { id: 'settings', label: 'Settings', icon: '⚙', title: 'Connections and preferences' },
];

export default function App() {
  const meta = useFactoryStore((s) => s.meta);
  const toBlueprint = useFactoryStore((s) => s.toBlueprint);
  const loadBlueprint = useFactoryStore((s) => s.loadBlueprint);
  const undo = useFactoryStore((s) => s.undo);
  const redo = useFactoryStore((s) => s.redo);
  const client = useGithubStore((s) => s.client);
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
  const flashTimer = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'connect' | 'deploy' | 'templates'>(null);
  const [showTelemetry, setShowTelemetry] = useState(false);
  // isDemoActive() is module state, not store state, so key it off the store's client —
  // entering or leaving the demo always swaps that, which is what re-renders this.
  const demo = !!client && isDemoActive();

  // Theme preference → <html data-theme> (specs/011): system removes the stamp so the
  // prefers-color-scheme media query decides.
  const theme = useSettingsStore((s) => s.theme);
  useEffect(() => applyTheme(theme), [theme]);

  // Reconnect from a sessionStorage PAT if this tab already has one — unless the URL
  // asked for the demo, in which case the demo client takes the seat instead (FR-5).
  useEffect(() => {
    if (demoRequested(window.location.search, window.location.hash)) {
      void enterDemoMode();
      return;
    }
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
    // Reset the prior timer so a rapid second message still gets its full 2.5s on screen.
    window.clearTimeout(flashTimer.current);
    setFlash(msg);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2500);
  };
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

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
        {/* Global chrome only: session (connection) + power. Per-view actions live in each
            view's own toolbar (see BuildToolbar) so this bar never gets crowded. */}
        <button
          type="button"
          className={`btn${login ? ' btn--live' : ''}`}
          onClick={() => setDialog('connect')}
          title={login ? 'Manage connection' : 'Connect a repo with a fine-grained PAT'}
        >
          {login ? `⚡ ${repo ? repoSlug(repo) : login}` : 'Connect'}
        </button>
        <span
          className="power"
          title="Power = Claude auth secret on the target repo (CLAUDE_CODE_OAUTH_TOKEN, or ANTHROPIC_API_KEY fallback)."
        >
          <span
            className={`led led--${power === 'on' ? 'on' : power === 'off' ? 'off' : 'idle'}`}
          />
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

      {demo && <DemoBanner />}

      {view === 'build' && drift.length > 0 && (
        <div className="banner banner--drift">
          ⚠ {drift.length} deployed workflow{drift.length > 1 ? 's were' : ' was'} hand-edited since
          the last blueprint.
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
          <BuildToolbar
            onTemplates={() => setDialog('templates')}
            onImportFile={() => fileRef.current?.click()}
            onImportString={importString}
            onExport={() =>
              download(
                `${meta.name || 'blueprint'}.blueprint.json`,
                JSON.stringify(toBlueprint(), null, 2),
              )
            }
            onCopyString={() => {
              void navigator.clipboard.writeText(encodeBlueprintString(toBlueprint()));
              say('Blueprint string copied — share it like a Factorio blueprint.');
            }}
            onDeploy={() => setDialog('deploy')}
            canDeploy={canDeploy}
            loggedIn={!!login}
            showTelemetry={showTelemetry}
            onToggleTelemetry={toggleTelemetry}
          />
          <div className="workspace">
            <Palette />
            <FactoryCanvas />
            <Inspector />
          </div>
          <CompileDrawer />
        </>
      )}
      {view === 'prompts' && <PromptStudio />}
      {view === 'content' && <ContentPanel />}
      {view === 'docs' && <DocsView />}
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
