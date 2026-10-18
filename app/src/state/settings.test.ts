import { describe, expect, it } from 'vitest';
import { createSettingsStore, SETTINGS_KEY } from './settings';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

describe('settings store', () => {
  it('starts with safe defaults when storage is empty or unavailable', () => {
    const s = createSettingsStore(null).getState();
    expect(s.recentRepos).toEqual([]);
    expect(s.defaultDeployMode).toBe('pr');
    expect(s.pollMs).toBe(15_000);
    expect(s.defaultModel).toBe('claude-sonnet-5-5');
  });

  it('persists slugs (never tokens) and dedupes newest-first', () => {
    const storage = fakeStorage();
    const store = createSettingsStore(storage);
    store.getState().addRecentRepo('bamr87/gitorio');
    store.getState().addRecentRepo('bamr87/lifehacker.dev');
    store.getState().addRecentRepo('bamr87/gitorio'); // re-connect → moves to front
    expect(store.getState().recentRepos).toEqual(['bamr87/gitorio', 'bamr87/lifehacker.dev']);
    const persisted = JSON.parse(storage.dump()[SETTINGS_KEY]);
    expect(persisted.recentRepos).toEqual(['bamr87/gitorio', 'bamr87/lifehacker.dev']);
    expect(JSON.stringify(persisted)).not.toMatch(/ghp_|github_pat_/);
  });

  it('rejects non-slug inputs and clamps pollMs to sane bounds', () => {
    const store = createSettingsStore(fakeStorage());
    store.getState().addRecentRepo('not a slug');
    expect(store.getState().recentRepos).toEqual([]);
    store.getState().setPollMs(1);
    expect(store.getState().pollMs).toBe(5_000);
    store.getState().setPollMs(999_999);
    expect(store.getState().pollMs).toBe(120_000);
  });

  it('hydrates from prior storage and survives corrupt JSON', () => {
    const good = fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({
        recentRepos: ['o/r'],
        defaultDeployMode: 'commit',
        pollMs: 30_000,
        defaultModel: 'claude-opus-5-5',
      }),
    });
    const s1 = createSettingsStore(good).getState();
    expect(s1.recentRepos).toEqual(['o/r']);
    expect(s1.defaultDeployMode).toBe('commit');
    expect(s1.pollMs).toBe(30_000);
    expect(s1.defaultModel).toBe('claude-opus-5-5');

    const corrupt = createSettingsStore(fakeStorage({ [SETTINGS_KEY]: '{nope' })).getState();
    expect(corrupt.defaultDeployMode).toBe('pr');
  });

  it('removeRecentRepo drops a connection', () => {
    const store = createSettingsStore(fakeStorage());
    store.getState().addRecentRepo('a/b');
    store.getState().addRecentRepo('c/d');
    store.getState().removeRecentRepo('a/b');
    expect(store.getState().recentRepos).toEqual(['c/d']);
  });
});

describe('theme preference (specs/011 FR-4)', () => {
  it('defaults to system, persists a valid choice, and rejects junk', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    const store = createSettingsStore(storage);
    expect(store.getState().theme).toBe('system');
    store.getState().setTheme('light');
    expect(JSON.parse(mem.get(SETTINGS_KEY)!).theme).toBe('light');
    expect(createSettingsStore(storage).getState().theme).toBe('light');
    mem.set(SETTINGS_KEY, JSON.stringify({ theme: 'neon' }));
    expect(createSettingsStore(storage).getState().theme).toBe('system');
  });
});
