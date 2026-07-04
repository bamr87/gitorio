import { useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './theme.css';
import { FactoryCanvas } from './canvas/FactoryCanvas';
import { Palette } from './panels/Palette';
import { Inspector } from './panels/Inspector';
import { CompileDrawer } from './panels/CompileDrawer';
import { useFactoryStore } from './state/store';
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState<string | null>(null);

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
          <span className="power" title="Power = ANTHROPIC_API_KEY secret on the target repo. Hookup lands in seed 03.">
            <span className="led led--off" /> no power
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

        <div className="workspace">
          <Palette />
          <FactoryCanvas />
          <Inspector />
        </div>

        <CompileDrawer />
        {flash && <div className="flash">{flash}</div>}
      </div>
    </ReactFlowProvider>
  );
}
