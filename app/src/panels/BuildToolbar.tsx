// The Build view's toolbar (ADR-019; specs/013 for the console controls) — a per-view action
// bar so the global top bar can stay to logo · nav · session · theme. Holds the Floor | Map
// mode toggle (the floor is the editing canvas; the map is each assembly line drawn as an
// archify map), the Machine Finder toggle, the blueprint passport (the title), undo/redo,
// Templates, the Blueprint ▾ I/O menu, LEDs and Deploy.

import { Menu } from './Menu';
import { useFactoryStore } from '../state/store';
import type { BuildMode } from '../state/ui';

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
  mode,
  onMode,
  finderOpen,
  onFinder,
  passportOpen,
  onPassport,
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
  mode: BuildMode;
  onMode: (m: BuildMode) => void;
  finderOpen: boolean;
  onFinder: () => void;
  passportOpen: boolean;
  onPassport: () => void;
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
      <button
        type="button"
        className={`viewbar__title viewbar__titlebtn${passportOpen ? ' is-active' : ''}`}
        aria-pressed={passportOpen}
        title="Blueprint passport — name, target repo, description, compile status"
        onClick={onPassport}
      >
        ⚒ {name || 'Untitled factory'}
      </button>
      <span className="viewbar__meta">
        {nodeCount} machine{nodeCount === 1 ? '' : 's'} · {edgeCount} belt
        {edgeCount === 1 ? '' : 's'}
      </span>

      <div className="viewbar__group viewbar__modes" role="group" aria-label="Build mode">
        <button
          type="button"
          className={`chip${mode === 'floor' ? ' is-active' : ''}`}
          aria-pressed={mode === 'floor'}
          title="The floor — drag machines, belt them, edit their dials"
          onClick={() => onMode('floor')}
        >
          ⚒ Floor
        </button>
        <button
          type="button"
          className={`chip${mode === 'map' ? ' is-active' : ''}`}
          aria-pressed={mode === 'map'}
          title="The map — each assembly line as the archify map it compiles to"
          onClick={() => onMode('map')}
        >
          🗺 Map
        </button>
      </div>
      <span className="viewbar__spacer" />

      {mode === 'floor' && (
        <button
          type="button"
          className={`btn${finderOpen ? ' is-active' : ''}`}
          aria-pressed={finderOpen}
          onClick={onFinder}
          title="Find a machine to add (/)"
        >
          + Machine <kbd className="kbd">/</kbd>
        </button>
      )}

      <div className="viewbar__group" role="group" aria-label="History">
        <button type="button" className="btn" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
          ↶
        </button>
        <button type="button" className="btn" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
          ↷
        </button>
      </div>

      <button
        type="button"
        className="btn"
        onClick={onTemplates}
        title="Stamp a ready-made factory blueprint"
      >
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
        title={
          canDeploy
            ? 'Deploy compiled workflows to the repo'
            : 'Connect a repo with Contents (RW) first'
        }
        onClick={onDeploy}
      >
        🚀 Deploy
      </button>
    </div>
  );
}
