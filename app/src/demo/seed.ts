// Entering and leaving demo mode (spec FR-4, NFR-SEC-2, AC-5).
//
// This is the whole of the "mode": install the fixture client in the github store, put a
// blueprint on the canvas, put the demo repos in the Fleet Ops roster. No panel learns
// anything new; they already read a `GithubClient` from the store and render whatever it
// gives them. That is why the demo cannot drift from the real app — there is only one
// rendering path, and this file just changes what is on the other end of it.
//
// NFR-SEC-2: entering REPLACES any live session rather than layering over it. A visitor
// must never be one click away from a demo action landing on their own repo, and the
// disconnect also clears the sessionStorage PAT.

import type { Blueprint } from '../blueprint/types';
import { parseRepo } from '../github/types';
import { useFactoryStore } from '../state/store';
import { useFleetOpsStore } from '../state/fleetops';
import { useGithubStore } from '../state/github';
import { useHubStore } from '../state/hub';
import { createDemoClient, demoBlueprintFor, type DemoClient } from './client';
import { DEMO_HUB, DEMO_PRIMARY, DEMO_REPOS, type Clock } from './fixtures';

/** The live demo client, or null when the app is in its ordinary state. */
let active: DemoClient | null = null;

/** Is the app currently in demo mode? */
export function isDemoActive(): boolean {
  return active !== null;
}

/** The active demo client (for the banner's activity readout). Null outside demo mode. */
export function demoClient(): DemoClient | null {
  return active;
}

export interface EnterDemoOptions {
  /** Pinned by tests and screenshot runs so the fleet tells the same story every time. */
  clock?: Clock;
  /** Skip stamping the canvas — used when a visitor is already mid-build. */
  keepCanvas?: boolean;
}

/**
 * Enter demo mode. Idempotent: entering twice reuses the same client so a visitor's
 * demo edits survive a second `?demo=1` navigation within the tab.
 */
export function enterDemoMode(opts: EnterDemoOptions = {}): Promise<DemoClient> {
  // Replace, never layer (NFR-SEC-2). disconnect() also wipes the sessionStorage PAT, so
  // a reload cannot silently reconnect the real session underneath the demo.
  if (!active) useGithubStore.getState().disconnect();

  const client = active ?? createDemoClient({ clock: opts.clock });
  active = client;
  const repo = parseRepo(DEMO_PRIMARY)!;

  // Set the connection synchronously so the panels flip on this render rather than the
  // next one; the preflight checklist fills in a microtask later.
  useGithubStore.setState({
    client,
    login: client.login,
    repo,
    preflight: null,
    power: 'on',
    connecting: false,
    error: null,
    drift: [],
  });

  if (!opts.keepCanvas) {
    const bp: Blueprint | null = demoBlueprintFor(DEMO_PRIMARY);
    if (bp) useFactoryStore.getState().loadBlueprint(structuredClone(bp));
  }

  // Seed the roster with all three demo repos so Fleet Command has a fleet to scan, and
  // measure its metrics window from the SAME clock the fixtures were generated against —
  // otherwise a pinned fixture fleet rots out of the 14-day window as the wall clock moves.
  const fleetOps = useFleetOpsStore.getState();
  fleetOps.addRepos(DEMO_REPOS.join(' '));
  fleetOps.setClock(opts.clock ? () => new Date(opts.clock!()).toISOString() : null);
  // The Harness tab reads the demo hub (specs/014): a session-only override, never persisted.
  useHubStore.getState().setHubSlug(DEMO_HUB, { persist: false });

  return client.preflight(repo).then((preflight) => {
    if (active === client) useGithubStore.setState({ preflight });
    return client;
  });
}

/**
 * Leave demo mode: the app returns to its disconnected state, exactly as if the visitor
 * had never connected (AC-5). Demo repos are dropped from the roster so a real
 * connection afterwards does not try to scan `acme/*` against GitHub.
 */
export function exitDemoMode(): void {
  active = null;
  useGithubStore.getState().disconnect();
  const fleetOps = useFleetOpsStore.getState();
  for (const slug of DEMO_REPOS) fleetOps.removeRepo(slug);
  fleetOps.setClock(null);
  useHubStore.getState().restorePersisted();
}

/** Does this URL ask for the demo? (`?demo=1`, or `#demo`.) */
export function demoRequested(search: string, hash = ''): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const v = params.get('demo');
  if (v !== null && v !== '0' && v !== 'false') return true;
  return hash.replace(/^#/, '') === 'demo';
}
