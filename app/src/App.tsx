import { useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './theme.css';
import { FactoryCanvas } from './canvas/FactoryCanvas';
import { Palette } from './panels/Palette';
import { Inspector } from './panels/Inspector';
import { CompileDrawer } from './panels/CompileDrawer';
import { ConnectDialog } from './panels/ConnectDialog';
import { DeployModal } from './panels/DeployModal';
import { useFactoryStore } from './state/store';
import { useGithubStore } from './state/github';
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'connect' | 'deploy'>(null);

  // Reconnect from a sessionStorage PAT if this tab already has one.
  useEffect(() => {
    restore();
  }, [restore]);

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
    <ReactFlowProvider>
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

        {drift.length > 0 && (
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

        <div className="workspace">
          <Palette />
          <FactoryCanvas />
          <Inspector />
        </div>

        <CompileDrawer />
        {flash && <div className="flash">{flash}</div>}
        {dialog === 'connect' && <ConnectDialog onClose={() => setDialog(null)} />}
        {dialog === 'deploy' && <DeployModal onClose={() => setDialog(null)} />}
      </div>
    </ReactFlowProvider>
  );
}
