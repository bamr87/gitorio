// @vitest-environment jsdom
// The Harness tab (specs/014 FR-5, AC-4): the hub's page anatomy from the demo hub — KPI row,
// snapshot line, six wires, nine metrics, the parity note — then Live over a Fleet Ops scan,
// design readiness for the floor, and lane cards.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { enterDemoMode, exitDemoMode } from '../demo/seed';
import { useFleetOpsStore } from '../state/fleetops';
import { HarnessPanel } from './HarnessPanel';

afterEach(() => {
  exitDemoMode();
  cleanup();
});

const clock = () => Date.parse('2026-01-01T00:00:00Z');

describe('HarnessPanel', () => {
  it('renders the hub anatomy from the demo hub', async () => {
    await enterDemoMode({ clock });
    render(<HarnessPanel />);

    await screen.findByText('Trip wires tripped');
    expect(screen.getByText('1 / 6')).toBeTruthy();
    expect(screen.getByText(/Snapshot 2026-01-01 00:00 UTC/)).toBeTruthy();
    expect(screen.getByText(/every value, status and wire matches/)).toBeTruthy();

    const wires = screen.getByRole('table', { name: 'Trip wires' });
    expect(within(wires).getAllByRole('row').length).toBe(7);
    const spike = within(wires).getByText('cost-spike').closest('tr')!;
    expect(spike.className).toContain('is-tripped');
    expect(within(spike).getByText('TRIPPED')).toBeTruthy();
    expect(within(spike).getByText(/nightly/i)).toBeTruthy();
    expect(within(wires).getAllByText('armed').length).toBe(5);

    const score = screen.getByRole('table', { name: 'Scorecard' });
    expect(within(score).getAllByRole('row').length).toBe(10);
    expect(within(score).getByText('completion_rate_pct')).toBeTruthy();
    const completion = within(score).getByText('completion_rate_pct').closest('tr')!;
    expect(completion.textContent).toContain('84.6');
    expect(completion.textContent).toContain('↑ higher');

    const checklist = screen.getByRole('table', { name: 'Production-readiness checklist' });
    expect(within(checklist).getAllByRole('row').length).toBe(13);
    expect(screen.getAllByRole('article', { name: /^Lane / }).length).toBeGreaterThanOrEqual(3);
    // The demo hub records its own lanes too.
    expect(screen.getByRole('article', { name: 'Lane issue-pipeline' })).toBeTruthy();
    // No links to a hub that does not exist.
    expect(screen.queryByText('Open on the hub ↗')).toBeNull();
  });

  it('Live evaluates the six wires over a Fleet Ops scan and names the hub-only sources', async () => {
    // The real clock: the metrics window is measured from now, so pinned runs would fall outside it.
    await enterDemoMode();
    render(<HarnessPanel />);
    await screen.findByText('Trip wires tripped');

    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Scan fleet' }));
    await waitFor(() => expect(useFleetOpsStore.getState().totals).toBeTruthy(), { timeout: 5000 });

    const wires = await screen.findByRole('table', { name: 'Trip wires' });
    const stale = within(wires).getByText('stale-data').closest('tr')!;
    expect(within(stale).getByText('TRIPPED')).toBeTruthy();
    expect(stale.textContent).toContain('issue_pipeline');
    expect(stale.textContent).toContain('token_rotation');
    expect(screen.getByText(/hub loops/)).toBeTruthy();
    // The scan's own signals are fresh, so only the hub-only sources are stale.
    expect(stale.textContent).not.toContain('actions_usage');
  });
});
