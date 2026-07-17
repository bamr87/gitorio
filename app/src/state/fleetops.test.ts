// Fleet Command store: roster persistence, hub import, the scan pipeline
// (workflows → facts → audit; runs → metrics), and fleet-wide derived views.
// The GithubClient is faked per-method (house idiom — see monitor.test.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryRun, GithubClient } from '../github/types';
import { createFleetOpsStore, FLEETOPS_KEY } from './fleetops';
import { useGithubStore } from './github';

const CI_YML = `name: CI
on:
  push:
    branches: [main]
  pull_request:
concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;

const GITMODULES = `[submodule "alpha"]
\tpath = projects/alpha
\turl = https://github.com/o/alpha.git
\tbranch = main
[submodule "beta"]
\tpath = projects/beta
\turl = https://github.com/o/beta.git
\tbranch = master
`;

function run(over: Partial<FactoryRun> = {}): FactoryRun {
  return {
    path: '.github/workflows/ci.yml',
    slug: 'ci',
    runId: 1,
    runNumber: 1,
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    htmlUrl: 'https://x/1',
    runStartedAt: '2026-07-16T00:00:00Z',
    updatedAt: '2026-07-16T00:02:00Z',
    createdAt: '2026-07-16T00:00:00Z',
    runAttempt: 1,
    ...over,
  };
}

function fakeClient(over: Partial<Record<keyof GithubClient, unknown>> = {}): GithubClient {
  return {
    login: 'me',
    listDir: vi.fn(async () => [
      { path: '.github/workflows/ci.yml', name: 'ci.yml', sha: 's', type: 'file' as const },
    ]),
    getFile: vi.fn(async (_repo: unknown, path: string) =>
      path === '.gitmodules'
        ? { path, content: GITMODULES, sha: 'g' }
        : { path, content: CI_YML, sha: 'w' },
    ),
    listRepoWorkflows: vi.fn(async () => [
      { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', htmlUrl: 'https://x/w1' },
      { id: 2, name: 'Old', path: '.github/workflows/old.yml', state: 'disabled_manually', htmlUrl: 'https://x/w2' },
    ]),
    listVariables: vi.fn(async () => [{ name: 'CONTENT_FACTORY_ENABLED', value: 'true' }]),
    listFactoryRuns: vi.fn(async () => ({
      runs: [run(), run({ runId: 2, conclusion: 'failure' })],
      etag: 'e1',
      notModified: false,
      rateRemaining: 4321,
    })),
    createIssue: vi.fn(async () => 'https://github.com/o/alpha/issues/9'),
    ...over,
  } as never;
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    dump: () => data,
  };
}

function connect(client: GithubClient) {
  useGithubStore.setState({ client, repo: { owner: 'o', repo: 'hub' }, login: 'me' });
}

beforeEach(() => {
  useGithubStore.setState({ client: null, repo: null, login: '' });
});

describe('roster', () => {
  it('addRepos parses, dedupes, and persists slugs', () => {
    const storage = memoryStorage();
    const store = createFleetOpsStore(storage);
    store.getState().addRepos('o/alpha\no/beta o/alpha');
    expect(store.getState().roster.map((e) => e.slug)).toEqual(['o/alpha', 'o/beta']);
    const persisted = JSON.parse(storage.dump().get(FLEETOPS_KEY) ?? '{}') as {
      roster: { slug: string }[];
    };
    expect(persisted.roster.map((e) => e.slug)).toEqual(['o/alpha', 'o/beta']);
  });

  it('removeRepo drops the roster entry and its snapshot', async () => {
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient());
    store.getState().addRepos('o/alpha');
    await store.getState().scanRepo('o/alpha');
    expect(store.getState().snapshots['o/alpha']).toBeTruthy();
    store.getState().removeRepo('o/alpha');
    expect(store.getState().roster).toEqual([]);
    expect(store.getState().snapshots['o/alpha']).toBeUndefined();
  });

  it('importFromHub reads .gitmodules and merges the discovered fleet', async () => {
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient());
    const ok = await store.getState().importFromHub('o/hub');
    expect(ok).toBe(true);
    expect(store.getState().roster.map((e) => e.slug)).toEqual(['o/alpha', 'o/beta']);
    expect(store.getState().roster[1].branch).toBe('master');
    expect(store.getState().hubSlug).toBe('o/hub');
  });

  it('importFromHub without a connection reports an error', async () => {
    const store = createFleetOpsStore(memoryStorage());
    const ok = await store.getState().importFromHub('o/hub');
    expect(ok).toBe(false);
    expect(store.getState().error).toMatch(/Connect/);
  });
});

describe('scanning', () => {
  it('scanRepo builds a ready snapshot with facts, audit, and workflow states', async () => {
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient());
    await store.getState().scanRepo('o/alpha');
    const snap = store.getState().snapshots['o/alpha'];
    expect(snap.status).toBe('ready');
    expect(snap.facts.length).toBe(1);
    expect(snap.facts[0].name).toBe('CI');
    expect(snap.audit?.grade).toBeTruthy();
    expect(snap.workflowStates.length).toBe(2);
    expect(store.getState().rateRemaining).toBe(4321);
  });

  it('derives fleet-wide metrics keyed by repo (no cross-repo path collisions)', async () => {
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient());
    await store.getState().scanRepo('o/alpha');
    await store.getState().scanRepo('o/beta');
    const rows = store.getState().fleetMetrics;
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.repo))).toEqual(new Set(['o/alpha', 'o/beta']));
    expect(rows.every((r) => r.displayPath === '.github/workflows/ci.yml')).toBe(true);
    expect(store.getState().totals?.runs).toBe(4);
  });

  it('a 304 poll keeps the previous runs and etag', async () => {
    const listFactoryRuns = vi
      .fn()
      .mockResolvedValueOnce({
        runs: [run()],
        etag: 'e1',
        notModified: false,
        rateRemaining: 100,
      })
      .mockResolvedValueOnce({ runs: [], etag: 'e1', notModified: true, rateRemaining: 99 });
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient({ listFactoryRuns }));
    await store.getState().scanRepo('o/alpha');
    await store.getState().scanRepo('o/alpha');
    const snap = store.getState().snapshots['o/alpha'];
    expect(snap.runs.length).toBe(1);
    expect(snap.etag).toBe('e1');
  });

  it('a failing repo becomes an error snapshot without aborting the fleet scan', async () => {
    const listDir = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([
        { path: '.github/workflows/ci.yml', name: 'ci.yml', sha: 's', type: 'file' },
      ]);
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient({ listDir }));
    store.getState().addRepos('o/alpha o/beta');
    await store.getState().scanFleet();
    const { snapshots, scanning, progress } = store.getState();
    expect(snapshots['o/alpha'].status).toBe('error');
    expect(snapshots['o/alpha'].error).toBe('boom');
    expect(snapshots['o/beta'].status).toBe('ready');
    expect(scanning).toBe(false);
    expect(progress).toBeNull();
  });
});

describe('work orders', () => {
  it('fileWorkOrder embeds the dedup marker and records the filed url', async () => {
    const client = fakeClient();
    const store = createFleetOpsStore(memoryStorage());
    connect(client);
    const url = await store
      .getState()
      .fileWorkOrder('o/alpha', 'o/alpha:.github/workflows/ci.yml:kill-switch', 'Fix', 'Body');
    expect(url).toBe('https://github.com/o/alpha/issues/9');
    const call = (client.createIssue as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].body).toContain(
      '<!-- gitorio-fleet-audit key="o/alpha:.github/workflows/ci.yml:kill-switch" -->',
    );
    expect(call[1].labels).toEqual(['gitorio-audit']);
    expect(
      store.getState().filedWorkOrders['o/alpha:.github/workflows/ci.yml:kill-switch'],
    ).toBe(url);
  });
});
