// The Fleet tab: Command (the multi-repo cockpit) and Observe — one repo's workflows drawn as
// the archify architecture map it would be delivered as (specs/013, FR-6), live from
// `toArchitectureIR` with the observe store's run status riding on the nodes as evidence
// beacons. The read-only React Flow fleet canvas this replaced (ADR-011) was a second
// renderer of the same graph; now there is one IR and one coordinate frame.

import { lazy, Suspense, useState } from 'react';
import { repoSlug } from '../github/types';
import { ConnectDialog } from '../panels/ConnectDialog';
import { DemoInvite } from '../panels/DemoBanner';
import { FleetOpsPanel } from '../panels/FleetOpsPanel';
import { useFleetStore } from '../state/fleet';
import { useGithubStore } from '../state/github';
import { useSettingsStore } from '../state/settings';
import { Chip, PageHeader, Panel } from '../ui/primitives';

// The map surface is a secondary chunk (Vite code-splits it): the cockpit's first paint
// does not pay for the viewer until a repo is observed.
const ObserveMap = lazy(() => import('./ObserveMap').then((m) => ({ default: m.ObserveMap })));

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
  // Command = the multi-repo cockpit; Observe = the single-repo map drill-in.
  const [board, setBoard] = useState<'command' | 'observe'>('command');

  const chips = [
    ...new Set([connectedRepo ? repoSlug(connectedRepo) : null, ...recentRepos].filter(Boolean)),
  ] as string[];
  const observedSlug = observedRepo ? repoSlug(observedRepo) : null;

  if (!login) {
    return (
      <div className="tabpane fleetview">
        <PageHeader
          title="Fleet"
          subtitle="Command a roster of repositories, or observe one as the map archify delivers for it."
        />
        <p className="tabpane__empty">
          Connect a token to command your workflow fleet.{' '}
          <button type="button" className="btn btn--small" onClick={() => setConnectOpen(true)}>
            Connect
          </button>
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
      <div className="container">
        <PageHeader
          title="Fleet"
          subtitle={
            board === 'command'
              ? 'Scan a roster of repositories and grade their automation: cost, waste, rework, and conformance to the fleet’s own conventions.'
              : 'One repository’s workflows, reverse-imported and drawn as an archify architecture map — belts, agents, gates, and live run status.'
          }
          live={board === 'observe' && polling}
        >
          <nav className="fleetmode" aria-label="Fleet mode">
            <Chip active={board === 'command'} onClick={() => setBoard('command')}>
              ⌘ Command
            </Chip>
            <Chip active={board === 'observe'} onClick={() => setBoard('observe')}>
              🛰 Observe
            </Chip>
          </nav>
        </PageHeader>

        {board === 'command' && <FleetOpsPanel onDrill={drill} />}

        {board === 'observe' && (
          <Panel
            eyebrow="Observe"
            title={
              observedSlug && mode === 'observe'
                ? `Observing ${observedSlug}`
                : 'Observe a repository'
            }
            actions={
              <>
                {chips.map((slug) => (
                  <Chip
                    key={slug}
                    active={observedSlug === slug && mode === 'observe'}
                    onClick={() => void observeRepo(slug)}
                    title={`Observe ${slug}`}
                  >
                    {slug}
                  </Chip>
                ))}
                <input
                  className="palette__search fleetbar__input"
                  placeholder="owner/name…"
                  aria-label="Observe an arbitrary repo"
                  value={arbitrary}
                  onChange={(e) => setArbitrary(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && arbitrary.trim()) void observeRepo(arbitrary.trim());
                  }}
                />
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={!arbitrary.trim() || loading}
                  onClick={() => void observeRepo(arbitrary.trim())}
                >
                  {loading ? 'Importing…' : 'Observe'}
                </button>
                {mode === 'observe' && (
                  <button type="button" className="btn btn--small" onClick={() => exitObserve()}>
                    Clear
                  </button>
                )}
              </>
            }
          >
            {error && <div className="banner banner--drift">{error}</div>}
            {mode === 'observe' && fleet ? (
              <>
                <p className="observe-bar__stat">
                  {fleet.workflows.length} workflows ·{' '}
                  {fleet.workflows.filter((w) => w.hasAgent).length} agents ·{' '}
                  {fleet.externalRepos.length} cross-repo
                  {polling && <span className="observe-bar__poll"> · live</span>}
                </p>
                {fleet.warnings.length > 0 && (
                  <div className="banner">
                    ⚠ {fleet.warnings.length} note{fleet.warnings.length === 1 ? '' : 's'}:{' '}
                    {fleet.warnings.join(' · ')}
                  </div>
                )}
                <Suspense fallback={<p className="tabpane__empty">Drawing the map…</p>}>
                  <ObserveMap fleet={fleet} />
                </Suspense>
              </>
            ) : (
              <p className="tabpane__empty">
                Pick a repo above to reverse-import its <code>.github/workflows/</code> into a live
                map — one node per workflow, workflow_run belts, cross-repo edges, run status as
                beacons.
              </p>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
