// @vitest-environment jsdom
// The app shell's landmarks (UPS-FE-10/11, issue #166): the first Tab lands on a skip link,
// Enter moves focus to the one <main id="main-content">, and every tab — connected or in the
// tokenless demo — renders inside that single landmark.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { exitDemoMode } from './demo/seed';
import { useUiStore } from './state/ui';

beforeAll(() => {
  // @xyflow/react measures the floor with ResizeObserver, which jsdom lacks. An inert
  // stand-in is enough: these tests assert landmarks, not layout.
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.ResizeObserver) {
    g.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

afterEach(() => {
  cleanup();
  exitDemoMode();
  useUiStore.getState().setView('build');
  window.history.replaceState(null, '', '/');
});

const mains = () => document.querySelectorAll('main');

async function expectOneMainInEveryTab(user: ReturnType<typeof userEvent.setup>) {
  const nav = screen.getByRole('navigation', { name: 'App sections' });
  const tabs = within(nav).getAllByRole('button');
  expect(tabs.length).toBeGreaterThan(1);
  for (const tab of tabs) {
    await user.click(tab);
    await waitFor(() => expect(tab.getAttribute('aria-current')).toBe('page'));
    expect(mains()).toHaveLength(1);
    expect(mains()[0].id).toBe('main-content');
  }
}

describe('App shell landmarks (UPS-FE-10/11)', () => {
  it('makes the skip link the first Tab stop, and Enter moves focus to <main>', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    const link = document.activeElement as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.classList.contains('skip-link')).toBe(true);
    expect(link.getAttribute('href')).toBe('#main-content');
    expect(link.textContent).toMatch(/skip to content/i);

    const target = document.getElementById('main-content');
    expect(target?.tagName).toBe('MAIN');

    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(target);
    // Focus moved without a fragment in the address bar.
    expect(window.location.hash).toBe('');
  });

  it('renders every tab inside exactly one <main id="main-content">', async () => {
    const user = userEvent.setup();
    render(<App />);
    await expectOneMainInEveryTab(user);
  });

  it('keeps the skip link and the single <main> in the tokenless demo (?demo=1)', async () => {
    window.history.replaceState(null, '', '/?demo=1');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('region', { name: /demo mode/i });

    await user.tab();
    expect((document.activeElement as HTMLElement).classList.contains('skip-link')).toBe(true);
    await expectOneMainInEveryTab(user);
  });
});
