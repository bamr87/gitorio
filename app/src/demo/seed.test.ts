// @vitest-environment jsdom
// Entering and leaving demo mode (spec FR-4, NFR-SEC-2, AC-5).

import { afterEach, describe, expect, it } from 'vitest';
import type { GithubClient } from '../github/types';
import { useFactoryStore } from '../state/store';
import { useFleetOpsStore } from '../state/fleetops';
import { useGithubStore } from '../state/github';
import { DEMO_LOGIN, DEMO_REPOS } from './fixtures';
import { demoRequested, enterDemoMode, exitDemoMode, isDemoActive } from './seed';

const clock = () => Date.parse('2026-08-22T09:00:00Z');

afterEach(() => {
  exitDemoMode();
});

/** A live client stand-in — only the fields the store touches on disconnect. */
function fakeLiveClient(): GithubClient {
  return { login: 'a-real-user' } as unknown as GithubClient;
}

describe('enterDemoMode', () => {
  it('connects the demo client and seeds canvas + roster (FR-4)', async () => {
    await enterDemoMode({ clock });

    const gh = useGithubStore.getState();
    expect(gh.login).toBe(DEMO_LOGIN);
    expect(gh.repo).toEqual({ owner: 'acme', repo: 'storefront' });
    expect(gh.preflight?.canDeploy).toBe(true);
    expect(gh.power).toBe('on');

    // The canvas carries the demo blueprint's three lines.
    const bp = useFactoryStore.getState().toBlueprint();
    expect(bp.meta.name).toBe('Acme Storefront Factory');
    expect(bp.nodes.length).toBeGreaterThan(15);

    const roster = useFleetOpsStore.getState().roster.map((e) => e.slug);
    for (const slug of DEMO_REPOS) expect(roster).toContain(slug);
  });

  it('replaces a live session rather than layering over it (NFR-SEC-2)', async () => {
    sessionStorage.setItem('gitfactory.pat', 'ghp_pretend');
    sessionStorage.setItem('gitfactory.repo', 'someone/private');
    useGithubStore.setState({
      client: fakeLiveClient(),
      login: 'a-real-user',
      repo: { owner: 'someone', repo: 'private' },
    });

    await enterDemoMode({ clock });

    expect(useGithubStore.getState().login).toBe(DEMO_LOGIN);
    // The real credential is gone, so a reload cannot reconnect underneath the demo.
    expect(sessionStorage.getItem('gitfactory.pat')).toBeNull();
    expect(sessionStorage.getItem('gitfactory.repo')).toBeNull();
  });

  it('is idempotent — re-entering keeps the session edits', async () => {
    const first = await enterDemoMode({ clock });
    await first.setVariable({ owner: 'acme', repo: 'storefront' }, 'PERFECTION_ENABLED', 'true');

    const second = await enterDemoMode({ clock });
    expect(second).toBe(first);
    const v = await second.getVariable({ owner: 'acme', repo: 'storefront' }, 'PERFECTION_ENABLED');
    expect(v?.value).toBe('true');
  });

  it('can leave the canvas alone for a visitor who is mid-build', async () => {
    useFactoryStore.getState().loadBlueprint({
      version: 1,
      meta: { name: 'My work in progress' },
      nodes: [],
      edges: [],
    });
    await enterDemoMode({ clock, keepCanvas: true });
    expect(useFactoryStore.getState().toBlueprint().meta.name).toBe('My work in progress');
  });
});

describe('exitDemoMode', () => {
  it('returns the app to the disconnected state (AC-5)', async () => {
    await enterDemoMode({ clock });
    expect(isDemoActive()).toBe(true);

    exitDemoMode();

    const gh = useGithubStore.getState();
    expect(isDemoActive()).toBe(false);
    expect(gh.client).toBeNull();
    expect(gh.login).toBeNull();
    expect(gh.repo).toBeNull();
    expect(gh.preflight).toBeNull();
    // The demo repos leave with it — a real connection afterwards must not try to scan
    // `acme/*` against GitHub.
    const roster = useFleetOpsStore.getState().roster.map((e) => e.slug);
    for (const slug of DEMO_REPOS) expect(roster).not.toContain(slug);
  });
});

describe('demoRequested', () => {
  it('reads the URL (FR-5)', () => {
    expect(demoRequested('?demo=1')).toBe(true);
    expect(demoRequested('demo=1')).toBe(true);
    expect(demoRequested('?demo')).toBe(true);
    expect(demoRequested('?other=1&demo=yes')).toBe(true);
    expect(demoRequested('', '#demo')).toBe(true);

    expect(demoRequested('')).toBe(false);
    expect(demoRequested('?demo=0')).toBe(false);
    expect(demoRequested('?demo=false')).toBe(false);
    expect(demoRequested('?other=1')).toBe(false);
  });
});
