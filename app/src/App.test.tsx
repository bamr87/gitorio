// @vitest-environment jsdom
// The app shell's landmarks (UPS-FE-10/11, issue #166): the first Tab lands on a skip link,
// Enter moves focus to the one <main id="main-content">, and every tab — connected or in the
// tokenless demo — renders inside that single landmark. And the fleet's page bridge (UPS-AST):
// <fleet-assist> is mounted once, in development only.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

const mains = () => document.querySelectorAll('main');
const assistTags = () => document.querySelectorAll('fleet-assist');
const assistScripts = () => document.head.querySelectorAll('script[src$="fleet-assist.js"]');
const assistScriptSrcs = () => [...assistScripts()].map((s) => s.getAttribute('src'));

afterEach(() => {
  cleanup();
  exitDemoMode();
  useUiStore.getState().setView('build');
  window.history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
  // The bridge adds its payload's <script> to <head>, which outlives the React tree.
  assistScripts().forEach((s) => s.remove());
});

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

describe('Assistant page bridge (UPS-AST)', () => {
  it('mounts <fleet-assist> once in development, outside <main>, with the open tab as its route', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('BASE_URL', '/');
    const user = userEvent.setup();
    render(<App />);

    expect(assistTags()).toHaveLength(1);
    const tag = assistTags()[0];
    expect(tag.getAttribute('repo')).toBe('bamr87/gitorio');
    expect(tag.getAttribute('source')).toBe('app/src/App.tsx');
    expect(tag.getAttribute('base')).toBe('/');
    expect(tag.getAttribute('route')).toBe('/?tab=build');
    expect(tag.closest('main')).toBeNull();
    expect(assistScriptSrcs()).toEqual(['/fleet-assist.js']);

    const nav = screen.getByRole('navigation', { name: 'App sections' });
    await user.click(within(nav).getByRole('button', { name: /settings/i }));
    await waitFor(() => expect(tag.getAttribute('route')).toBe('/?tab=settings'));
    // A re-render moves the route; it never adds a second tag or a second script.
    expect(assistTags()).toHaveLength(1);
    expect(assistScriptSrcs()).toEqual(['/fleet-assist.js']);
  });

  it('serves the payload and reports the base under the Pages prefix (/gitorio/)', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('BASE_URL', '/gitorio/');
    render(<App />);

    expect(assistTags()).toHaveLength(1);
    expect(assistTags()[0].getAttribute('base')).toBe('/gitorio/');
    expect(assistScriptSrcs()).toEqual(['/gitorio/fleet-assist.js']);
  });

  it('renders no tag and loads no script outside development (a production build)', () => {
    vi.stubEnv('DEV', false);
    render(<App />);

    expect(assistTags()).toHaveLength(0);
    expect(assistScriptSrcs()).toEqual([]);
  });
});
