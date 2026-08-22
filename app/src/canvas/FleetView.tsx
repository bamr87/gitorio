import './fleetview.css';
import { useState } from 'react';
import { FleetCanvas } from './FleetCanvas';
import { ConnectDialog } from '../panels/ConnectDialog';
import { DemoInvite } from '../panels/DemoBanner';
import { FleetOpsPanel } from '../panels/FleetOpsPanel';
import { useFleetStore } from '../state/fleet';
import { useGithubStore } from '../state/github';
import { useSettingsStore } from '../state/settings';
import { repoSlug } from '../github/types';

export function FleetView() {
  const login = useGithubStore((s) => s.login);
  const connectedRepo = useGithubStore((s) => s.repo);
  const recentRepos = useSettingsStore((s) => s.recentRepos);
  const mode = useFleetStore((s) => s.mode);
  const fleet = useFleetStore((s) => s.fleet);
  const observedRepo = useFleetStore((s) => s.observedRepo);
  const loading = useFleetStore((s) => s.loading);
  const error = useFleetStore((s) => s.error);
  const polling = useFleetStore((s) => s.polling);
  const { observeRepo, exitObserve } = useFleetStore.getState();

  const [connectOpen, setConnectOpen] = useState(false);
  const [arbitrary, setArbitrary] = useState('');
  // Command = the multi-repo cockpit; Observe = the single-repo fleet map drill-in.
  const [board, setBoard] = useState<'command' | 'observe'>('command');

  const chips = [...new Set([connectedRepo ? repoSlug(connectedRepo) : null, ...recentRepos].filter(Boolean))] as string[];
  const observedSlug = observedRepo ? repoSlug(observedRepo) : null;

  if (!login) {
    return (
      <div className="tabpane fleetview">
        <p className="tabpane__empty">
          Connect a token to command your workflow fleet.{' '}
          <button type="button" className="btn btn--small" onClick={() => setConnectOpen(true)}>Connect</button>
        </p>
        <DemoInvite />
        {connectOpen && <ConnectDialog onClose={() => setConnectOpen(false)} />}
      </div>
    );
  }

  const drill = (slug: string) => {
    setBoard('observe');
    void observeRepo(slug);
  };

  return (
    <div className="tabpane fleetview">
      <nav className="fleetmode" aria-label="Fleet mode">
        <button
          type="button"
          className={`chip${board === 'command' ? ' is-active' : ''}`}
          aria-pressed={board === 'command'}
          onClick={() => setBoard('command')}
        >
          ⌘ Command
        </button>
        <button
          type="button"
          className={`chip${board === 'observe' ? ' is-active' : ''}`}
          aria-pressed={board === 'observe'}
          onClick={() => setBoard('observe')}
        >
          🛰 Observe
        </button>
      </nav>

      {board === 'command' && <FleetOpsPanel onDrill={drill} />}

      {board === 'observe' && (
        <>
      <div className="fleetbar">
        <span className="fleetbar__label">🛰 Observe</span>
        <div className="fleetbar__chips">
          {chips.map((slug) => (
            <button
              key={slug}
              type="button"
              className={`chip${observedSlug === slug && mode === 'observe' ? ' is-active' : ''}`}
              onClick={() => void observeRepo(slug)}
            >
              {slug}
            </button>
          ))}
        </div>
        <span className="fleetbar__spacer" />
        <input
          className="palette__search fleetbar__input"
          placeholder="owner/name…"
          aria-label="Observe an arbitrary repo"
          value={arbitrary}
          onChange={(e) => setArbitrary(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && arbitrary.trim()) void observeRepo(arbitrary.trim()); }}
        />
        <button type="button" className="btn btn--small" disabled={!arbitrary.trim() || loading} onClick={() => void observeRepo(arbitrary.trim())}>
          {loading ? 'Importing…' : 'Observe'}
        </button>
        {mode === 'observe' && (
          <button type="button" className="btn btn--small" onClick={() => exitObserve()}>Clear</button>
        )}
      </div>

      {error && <div className="banner banner--drift">{error}</div>}

      {mode === 'observe' && fleet ? (
        <>
          <div className="observe-bar">
            <span className="observe-bar__title">🛰 Observing <b>{observedSlug}</b></span>
            <span className="observe-bar__stat">
              {fleet.workflows.length} workflows · {fleet.workflows.filter((w) => w.hasAgent).length} agents · {fleet.externalRepos.length} cross-repo
            </span>
            <span className="observe-bar__spacer" />
            <span className="observe-bar__legend" aria-hidden>
              <span className="led led--on" /> ok
              <span className="led led--warn" /> running
              <span className="led led--bad" /> failed
              <span className="led led--idle" /> idle
            </span>
            {polling && <span className="observe-bar__poll"><span className="led led--warn" /> live</span>}
          </div>
          {fleet.warnings.length > 0 && (
            <div className="banner">⚠ {fleet.warnings.length} note{fleet.warnings.length === 1 ? '' : 's'}: {fleet.warnings.join(' · ')}</div>
          )}
          <FleetCanvas />
        </>
      ) : (
        <p className="tabpane__empty">
          Pick a repo above to reverse-import its <code>.github/workflows/</code> into a live fleet map — one node per workflow, workflow_run belts, cross-repo edges, telemetry LEDs.
        </p>
      )}
        </>
      )}
    </div>
  );
}
