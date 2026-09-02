// @vitest-environment jsdom
// The demo chrome (spec FR-6, FR-7, AC-5): the banner says plainly that nothing reaches
// GitHub, the exit really disconnects, and the tour walks the tabs by keyboard.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TOUR } from '../demo/tour';
import { enterDemoMode, exitDemoMode, isDemoActive } from '../demo/seed';
import { useGithubStore } from '../state/github';
import { useUiStore } from '../state/ui';
import { DemoBanner, DemoInvite } from './DemoBanner';

const clock = () => Date.parse('2026-08-22T09:00:00Z');

afterEach(() => {
  cleanup();
  exitDemoMode();
});

describe('DemoBanner', () => {
  it('states that nothing is written to GitHub (FR-6)', async () => {
    await enterDemoMode({ clock });
    render(<DemoBanner />);
    expect(screen.getByRole('region', { name: /demo mode/i })).toBeTruthy();
    expect(screen.getByText(/Nothing here is written to GitHub/i)).toBeTruthy();
  });

  it('exits to the disconnected state (AC-5)', async () => {
    await enterDemoMode({ clock });
    render(<DemoBanner />);
    fireEvent.click(screen.getByRole('button', { name: /leave demo/i }));
    expect(isDemoActive()).toBe(false);
    expect(useGithubStore.getState().client).toBeNull();
  });

  it('walks the tabs, forwards and back, by button and by arrow key (FR-7)', async () => {
    await enterDemoMode({ clock });
    render(<DemoBanner />);
    fireEvent.click(screen.getByRole('button', { name: /take the tour/i }));

    expect(useUiStore.getState().view).toBe(TOUR[0].view);
    expect(screen.getByText(TOUR[0].title)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(useUiStore.getState().view).toBe(TOUR[1].view);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(useUiStore.getState().view).toBe(TOUR[2].view);

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(useUiStore.getState().view).toBe(TOUR[1].view);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(TOUR[1].title)).toBeNull();
  });

  it('covers every tab in order and ends on Finish', async () => {
    await enterDemoMode({ clock });
    render(<DemoBanner />);
    fireEvent.click(screen.getByRole('button', { name: /take the tour/i }));
    for (let i = 0; i < TOUR.length - 1; i++) {
      expect(useUiStore.getState().view).toBe(TOUR[i].view);
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    }
    expect(useUiStore.getState().view).toBe(TOUR[TOUR.length - 1].view);
    fireEvent.click(screen.getByRole('button', { name: /finish/i }));
    expect(screen.queryByText(TOUR[0].title)).toBeNull();
  });

  it('the tour reaches all eight tabs', () => {
    expect(new Set(TOUR.map((s) => s.view)).size).toBe(8);
  });
});

describe('DemoInvite', () => {
  it('enters demo mode from an empty state (FR-5)', async () => {
    render(<DemoInvite />);
    fireEvent.click(screen.getByRole('button', { name: /explore the demo/i }));
    // enterDemoMode installs the client synchronously; the preflight lands a tick later.
    await Promise.resolve();
    expect(isDemoActive()).toBe(true);
    expect(useGithubStore.getState().login).toBeTruthy();
  });
});
