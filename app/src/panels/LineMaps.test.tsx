// @vitest-environment jsdom
// Build · Map mode (specs/013 FR-5, AC-3): every assembly line as its archify map, selection
// shared with the floor, compiled capabilities in the machine passport, beacons from telemetry
// and diagnostics, and "Edit on the floor" returning to the canvas with the machine selected.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EXAMPLE_BLUEPRINT } from '../blueprint/example';
import { assemblyLines } from '../compiler/compile';
import { useFactoryStore } from '../state/store';
import { useTelemetryStore } from '../state/telemetry';
import { useUiStore } from '../state/ui';
import { LineMaps } from './LineMaps';

afterEach(cleanup);
beforeEach(() => {
  useFactoryStore.getState().loadBlueprint(EXAMPLE_BLUEPRINT);
  useFactoryStore.getState().setSelected(null);
  useUiStore.setState({ buildMode: 'map' });
  useTelemetryStore.setState({ statusByNode: {} });
});

const lines = assemblyLines(EXAMPLE_BLUEPRINT);

describe('LineMaps', () => {
  it('renders one chip per assembly line and the first line’s map', () => {
    render(<LineMaps />);
    const chips = within(screen.getByRole('group', { name: 'Assembly lines' })).getAllByRole(
      'button',
    );
    expect(chips.map((c) => c.textContent)).toEqual(lines.map((l) => l.name));
    expect(screen.getByRole('group', { name: `${lines[0].name} map` })).toBeTruthy();
    expect(screen.getByText(lines[0].filename)).toBeTruthy();
  });

  it('shares selection with the floor: a selected machine focuses its node, Edit on the floor returns', () => {
    useFactoryStore.getState().setSelected('a1');
    render(<LineMaps />);
    const passport = screen.getByRole('region', { name: /Machine passport/ });
    expect(within(passport).getByText('Capabilities · compiled')).toBeTruthy();
    expect(within(passport).getByText('This agent may')).toBeTruthy();
    fireEvent.click(within(passport).getByRole('button', { name: 'Edit on the floor' }));
    expect(useUiStore.getState().buildMode).toBe('floor');
    expect(useFactoryStore.getState().selectedId).toBe('a1');
  });

  it('follows a selection into the other line and maps telemetry + diagnostics to beacons', () => {
    // s3 belongs to the second (cron) line; a1 has a run; s1 (a label sink with no labels) warns.
    useTelemetryStore.setState({ statusByNode: { a2: 'on' } });
    useFactoryStore.getState().setSelected('s3');
    const { container } = render(<LineMaps />);
    expect(screen.getByRole('group', { name: `${lines[1].name} map` })).toBeTruthy();
    expect(container.querySelector('.map-beacon--ok text')?.textContent).toBe('ok');
    // Switch back to the first line via its chip: the foreign selection clears.
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Assembly lines' })).getByRole('button', {
        name: lines[0].name,
      }),
    );
    expect(useFactoryStore.getState().selectedId).toBeNull();
    expect(screen.getByRole('group', { name: `${lines[0].name} map` })).toBeTruthy();
  });

  it('explains the compiler’s bot guard in its own passport', () => {
    const { container } = render(<LineMaps />);
    fireEvent.click(container.querySelector('[data-id="guard-bot-actor"]')!);
    const passport = screen.getByRole('region', { name: /Bot guard/ });
    expect(within(passport).getByText(/ADR-009/)).toBeTruthy();
  });

  it('shows an honest empty state when the floor has no line', () => {
    useFactoryStore
      .getState()
      .loadBlueprint({ version: 1, meta: { name: 'Empty' }, nodes: [], edges: [] });
    render(<LineMaps />);
    expect(screen.getByText('No assembly line yet')).toBeTruthy();
  });
});
