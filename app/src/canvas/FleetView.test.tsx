// @vitest-environment jsdom
// Fleet Observe on the map (specs/013 FR-6, AC-4): the demo client observing acme/storefront
// draws every workflow (no story-budget collapse), run status rides as text beacons, the
// workflow passport names the agent runner and the writes, and the delivered map is linked.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { fleetComponentId } from '../archify/ir';
import { enterDemoMode, exitDemoMode } from '../demo/seed';
import { DEMO_PRIMARY } from '../demo/fixtures';
import { importFleet } from '../fleet/import';
import { parseRepo } from '../github/types';
import { useFleetStore } from '../state/fleet';
import { FleetView } from './FleetView';

afterEach(() => {
  useFleetStore.getState().exitObserve();
  exitDemoMode();
  cleanup();
});

const clock = () => Date.parse('2026-01-01T00:00:00Z');

describe('FleetView · Observe', () => {
  it('draws the observed demo repo as an architecture map with beacons, passports, and the delivered link', async () => {
    const client = await enterDemoMode({ clock });
    const fleet = await importFleet(client, parseRepo(DEMO_PRIMARY)!);
    const { container } = render(<FleetView />);

    fireEvent.click(screen.getByRole('button', { name: /Observe/ }));
    fireEvent.click(screen.getByRole('button', { name: DEMO_PRIMARY }));

    const map = await screen.findByRole('group', { name: `${DEMO_PRIMARY} automation map` });
    // One node per workflow, nothing collapsed into "N more".
    const nodes = within(map).getAllByRole('button');
    expect(nodes.length).toBe(fleet.workflows.length);
    expect(map.textContent).not.toContain('more workflow');

    // The observe store polls on import; run status arrives as text beacons.
    await waitFor(() =>
      expect(container.querySelectorAll('.map-beacon').length).toBeGreaterThan(0),
    );
    const beaconWords = [...container.querySelectorAll('.map-beacon text')].map(
      (t) => t.textContent,
    );
    for (const w of beaconWords) expect(['ok', 'run', 'fail', 'idle']).toContain(w);

    // An agent workflow's passport names its runner and what it writes.
    const agent = fleet.workflows.find((w) => w.hasAgent)!;
    fireEvent.click(
      container.querySelector(`[data-id="${fleetComponentId(DEMO_PRIMARY, agent.slug)}"]`)!,
    );
    const passport = screen.getByRole('region', { name: /Workflow passport/ });
    expect(within(passport).getByText('runner')).toBeTruthy();
    expect(within(passport).getByText('Writes')).toBeTruthy();
    expect(within(passport).getByText(agent.path)).toBeTruthy();

    // The demo fleet has a delivered map; the nav links to it.
    const link = screen.getByRole('link', { name: /Open delivered map/ }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toMatch(/maps\/demo--acme--storefront\.html$/);
  });
});
