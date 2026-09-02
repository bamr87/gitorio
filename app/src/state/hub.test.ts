// @vitest-environment jsdom
// The hub source (specs/014 FR-4, FR-9): the demo hub is read through the same reader the real
// hub is, the slug persists (never a token), and the demo overrides it for the session only.

import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_HUB, DEMO_PRIMARY } from '../demo/fixtures';
import { importFleet } from '../fleet/import';
import { parseRepo } from '../github/types';
import { enterDemoMode, exitDemoMode } from '../demo/seed';
import {
  createHubStore,
  DEFAULT_HUB,
  HUB_KEY,
  hubDiagramUrl,
  hubPagesUrl,
  useHubStore,
} from './hub';

afterEach(() => {
  exitDemoMode();
  localStorage.removeItem(HUB_KEY);
});

const memStorage = () => {
  const mem = new Map<string, string>();
  return {
    mem,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
};

describe('the hub store', () => {
  it('the demo points the tab at acme/hub without persisting it; leaving restores the default', async () => {
    await enterDemoMode();
    expect(useHubStore.getState().hubSlug).toBe(DEMO_HUB);
    expect(localStorage.getItem(HUB_KEY)).toBeNull();
    exitDemoMode();
    expect(useHubStore.getState().hubSlug).toBe(DEFAULT_HUB);
    expect(useHubStore.getState().snapshot).toBeNull();
  });

  it('reads the demo hub: committed health with one tripped wire, parity, the manifest, the pulse cron', async () => {
    await enterDemoMode();
    expect(await useHubStore.getState().refresh()).toBe(true);
    const snap = useHubStore.getState().snapshot!;
    expect(useHubStore.getState().status).toBe('ready');
    expect(snap.committed).toBeTruthy();
    expect(snap.committed!.tripped_count).toBe(1);
    expect(snap.committed!.trip_wires.find((w) => w.id === 'cost-spike')!.tripped).toBe(true);
    expect(snap.committed!.trip_wires.length).toBe(6);
    expect(snap.parity).toEqual([]);
    expect(snap.recomputed.scorecard.completion_rate_pct.value).toBe(84.6);
    expect(snap.manifest!.lanes.map((l) => l.id)).toContain('issue-pipeline');
    expect(snap.manifest!.lanes.find((l) => l.id === 'issue-pipeline')!.switch).toBe('ISSUE_PIPELINE_ENABLED');
    expect(snap.pulseCron).toBe('0 6 * * *');
    expect(snap.found['_data/harness_health.yml']).toBe(true);
    expect(snap.found['_data/fleet.yml']).toBe(true);
    expect(snap.config.trip_wires.cost_spike_multiplier).toBe(3);
  });

  it('the demo storefront carries the manifest GitFactory compiles, so Observe pins lanes to its lines', async () => {
    const client = await enterDemoMode();
    const fleet = await importFleet(client, parseRepo(DEMO_PRIMARY)!);
    expect(fleet.manifest?.spec_version).toBe('fleet/v1');
    const factoryLines = fleet.workflows.filter((w) => w.path.includes('/factory--'));
    expect(factoryLines.length).toBeGreaterThanOrEqual(3);
    for (const w of factoryLines) {
      expect(w.lane?.id, w.path).toBe(w.slug);
      expect(w.lane?.harness).toBe('claude-code-action');
    }
    expect(fleet.workflows.find((w) => w.slug === 'nightly')?.lane).toBeUndefined();
  });

  it('refuses junk slugs, normalizes URLs, persists only when asked, and reloads what it persisted', () => {
    const storage = memStorage();
    const store = createHubStore(storage);
    expect(store.getState().hubSlug).toBe(DEFAULT_HUB);
    expect(store.getState().setHubSlug('nope')).toBe(false);
    expect(store.getState().hubSlug).toBe(DEFAULT_HUB);
    expect(store.getState().setHubSlug('https://github.com/acme/other')).toBe(true);
    expect(store.getState().hubSlug).toBe('acme/other');
    expect(JSON.parse(storage.mem.get(HUB_KEY)!)).toEqual({ hubSlug: 'acme/other' });
    expect(store.getState().setHubSlug('acme/session', { persist: false })).toBe(true);
    expect(store.getState().hubSlug).toBe('acme/session');
    expect(JSON.parse(storage.mem.get(HUB_KEY)!)).toEqual({ hubSlug: 'acme/other' });
    store.getState().restorePersisted();
    expect(store.getState().hubSlug).toBe('acme/other');
    expect(createHubStore(storage).getState().hubSlug).toBe('acme/other');
    const junk = createHubStore({ ...storage, getItem: () => '{"hubSlug": 12}' });
    expect(junk.getState().hubSlug).toBe(DEFAULT_HUB);
    const broken = createHubStore({ ...storage, getItem: () => 'not json' });
    expect(broken.getState().hubSlug).toBe(DEFAULT_HUB);
  });

  it('a refresh without a client is an error state, not a throw', async () => {
    const store = createHubStore(null);
    expect(await store.getState().refresh()).toBe(false);
    expect(store.getState().status).toBe('error');
    expect(store.getState().error).toMatch(/Connect/);
  });

  it('builds Pages URLs for project sites and user sites', () => {
    expect(hubPagesUrl('bamr87/bamr87')).toBe('https://bamr87.github.io/bamr87/harness/');
    expect(hubPagesUrl('bamr87/bamr87.github.io')).toBe('https://bamr87.github.io/harness/');
    expect(hubDiagramUrl('bamr87/bamr87', 'fleet-pulse.workflow')).toBe(
      'https://bamr87.github.io/bamr87/diagrams/fleet-pulse.workflow.html',
    );
    expect(hubPagesUrl('junk')).toBeNull();
  });
});
