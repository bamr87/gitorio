import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFleetStore } from './fleet';
import { useGithubStore } from './github';

// importFleet(client, repo) uses listDir + getFile; the empty-dir path returns an empty fleet.
function fakeClient() {
  return {
    login: 'me',
    listDir: vi.fn(async () => [] as never[]),
    getFile: vi.fn(async () => null),
    listFactoryRuns: vi.fn(async () => ({ runs: [], etag: null, notModified: false, rateRemaining: 5000 })),
  };
}
const connect = (client: ReturnType<typeof fakeClient>) =>
  useGithubStore.setState({ client: client as never, repo: { owner: 'o', repo: 'r' }, login: 'me' });

afterEach(() => {
  useFleetStore.getState().exitObserve();
  useFleetStore.setState({ fleet: null, observedRepo: null, mode: 'author', error: null });
});

describe('fleet store: observeRepo (multi-repo switcher)', () => {
  it('observes an arbitrary repo via the session client and enters observe mode', async () => {
    const client = fakeClient();
    connect(client);
    const ok = await useFleetStore.getState().observeRepo('bamr87/lifehacker.dev');
    expect(ok).toBe(true);
    const s = useFleetStore.getState();
    expect(s.mode).toBe('observe');
    expect(s.observedRepo).toEqual({ owner: 'bamr87', repo: 'lifehacker.dev' });
    expect(s.fleet).not.toBeNull();
    expect(client.listDir).toHaveBeenCalledWith({ owner: 'bamr87', repo: 'lifehacker.dev' }, expect.any(String));
  });

  it('observeCurrentRepo delegates to the connected repo', async () => {
    connect(fakeClient());
    const ok = await useFleetStore.getState().observeCurrentRepo();
    expect(ok).toBe(true);
    expect(useFleetStore.getState().observedRepo).toEqual({ owner: 'o', repo: 'r' });
  });

  it('rejects a bad slug and requires a connection', async () => {
    connect(fakeClient());
    expect(await useFleetStore.getState().observeRepo('not a slug')).toBe(false);
    expect(useFleetStore.getState().error).toMatch(/owner\/name/);

    useGithubStore.setState({ client: null, login: null, repo: null });
    expect(await useFleetStore.getState().observeRepo('o/r')).toBe(false);
    expect(useFleetStore.getState().error).toMatch(/Connect/);
  });
});
