// The Build view's toolbar — a per-view action bar so the global top bar can stay to just
// logo · nav · session. Groups the blueprint I/O behind a single "Blueprint ▾" menu, surfaces
// undo/redo as visible controls (they were keyboard-only), and holds the Build-context actions
// (Templates, LEDs, Deploy). Reads undo/redo + meta straight from the store; the rest are props
// because they touch App-level plumbing (dialogs, the hidden file input, telemetry polling).

import { Menu } from './Menu';
import { useFactoryStore } from '../state/store';

export function BuildToolbar({
  onTemplates,
  onImportFile,
  onImportString,
  onExport,
  onCopyString,
  onDeploy,
  canDeploy,
  loggedIn,
  showTelemetry,
  onToggleTelemetry,
}: {
  onTemplates: () => void;
  onImportFile: () => void;
  onImportString: () => void;
  onExport: () => void;
  onCopyString: () => void;
  onDeploy: () => void;
  canDeploy: boolean;
  loggedIn: boolean;
  showTelemetry: boolean;
  onToggleTelemetry: () => void;
}) {
  const name = useFactoryStore((s) => s.meta.name);
  const nodeCount = useFactoryStore((s) => s.nodes.length);
  const edgeCount = useFactoryStore((s) => s.edges.length);
  const canUndo = useFactoryStore((s) => s.canUndo);
  const canRedo = useFactoryStore((s) => s.canRedo);
  const undo = useFactoryStore((s) => s.undo);
  const redo = useFactoryStore((s) => s.redo);

  return (
    <div className="viewbar">
      <span className="viewbar__title">⚒ {name || 'Untitled factory'}</span>
      <span className="viewbar__meta">
        {nodeCount} machine{nodeCount === 1 ? '' : 's'} · {edgeCount} belt{edgeCount === 1 ? '' : 's'}
      </span>
      <span className="viewbar__spacer" />

      <div className="viewbar__group" role="group" aria-label="History">
        <button type="button" className="btn" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">↶</button>
        <button type="button" className="btn" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">↷</button>
      </div>

      <button type="button" className="btn" onClick={onTemplates} title="Stamp a ready-made factory blueprint">
        📐 Templates
      </button>

      <Menu
        label="Blueprint"
        title="Import / export the blueprint"
        items={[
          { label: 'Import file…', icon: '📂', onClick: onImportFile },
          { label: 'Paste string…', icon: '📋', onClick: onImportString },
          { label: 'Export JSON', icon: '💾', onClick: onExport },
          { label: 'Copy string', icon: '🔗', onClick: onCopyString },
        ]}
      />

      {loggedIn && (
        <button
          type="button"
          className={`btn${showTelemetry ? ' btn--primary' : ''}`}
          onClick={onToggleTelemetry}
          title="Poll factory workflow runs and light up the machines"
        >
          📊 LEDs
        </button>
      )}

      <button
        type="button"
        className="btn btn--primary"
        disabled={!canDeploy}
        title={canDeploy ? 'Deploy compiled workflows to the repo' : 'Connect a repo with Contents (RW) first'}
        onClick={onDeploy}
      >
        🚀 Deploy
      </button>
    </div>
  );
}
