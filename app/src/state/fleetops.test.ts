// Fleet Command store: roster persistence, hub import, the scan pipeline
// (workflows → facts → audit; runs → metrics), and fleet-wide derived views.
// The GithubClient is faked per-method (house idiom — see monitor.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  // Pin Date only (timers stay real): the store derives metrics over a
  // windowDays cutoff from the real clock, and the fixtures' absolute
  // 2026-07-1x timestamps aged out of the 14-day window on 2026-07-30,
  // turning CI red. Fake-date keeps the fixtures inside the window forever.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-17T12:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
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

  it('the persisted localStorage payload carries no token or client material', () => {
    const storage = memoryStorage();
    const store = createFleetOpsStore(storage);
    // The client (and any Claude/PAT secret material) lives in the github store — never here.
    connect(fakeClient());
    store.getState().addRepos('o/alpha o/beta');
    const raw = storage.dump().get(FLEETOPS_KEY) ?? '{}';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['hubSlug', 'roster', 'windowDays']);
    expect(raw.toLowerCase()).not.toContain('token');
    expect(raw).not.toContain('client');
  });
});

describe('workflow maintenance', () => {
  const CI = '.github/workflows/ci.yml';

  it('rerunLatestFailed re-runs the newest failed run, then rescans', async () => {
    const rerunRun = vi.fn<(repo: unknown, runId: number) => Promise<void>>(async () => {});
    const listFactoryRuns = vi.fn(async () => ({
      runs: [
        run({ runId: 5, conclusion: 'failure', createdAt: '2026-07-10T00:00:00Z' }),
        run({ runId: 9, conclusion: 'timed_out', createdAt: '2026-07-16T00:00:00Z' }),
        run({ runId: 3, conclusion: 'success', createdAt: '2026-07-17T00:00:00Z' }),
      ],
      etag: 'e',
      notModified: false,
      rateRemaining: 10,
    }));
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient({ rerunRun, listFactoryRuns }));
    await store.getState().scanRepo('o/alpha');
    await store.getState().rerunLatestFailed('o/alpha', CI);
    expect(rerunRun).toHaveBeenCalledTimes(1);
    expect(rerunRun.mock.calls[0][1]).toBe(9); // newest retryable (not the newer success)
    // Initial scan + post-action rescan both hit the runs endpoint.
    expect(listFactoryRuns.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(store.getState().actionBusy['o/alpha:rerun']).toBe(false);
  });

  it('rerunLatestFailed is a no-op when the workflow has no failed run', async () => {
    const rerunRun = vi.fn(async () => {});
    const listFactoryRuns = vi.fn(async () => ({
      runs: [run({ runId: 1, conclusion: 'success' })],
      etag: 'e',
      notModified: false,
      rateRemaining: 10,
    }));
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient({ rerunRun, listFactoryRuns }));
    await store.getState().scanRepo('o/alpha');
    await store.getState().rerunLatestFailed('o/alpha', CI);
    expect(rerunRun).not.toHaveBeenCalled();
    expect(store.getState().error).toBeNull();
  });

  it('setKillSwitch writes "true"/"false" via setVariable, then rescans', async () => {
    const setVariable = vi.fn(async () => {});
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient({ setVariable }));
    await store.getState().scanRepo('o/alpha');
    await store.getState().setKillSwitch('o/alpha', 'CONTENT_FACTORY_ENABLED', false);
    expect(setVariable).toHaveBeenLastCalledWith(
      expect.anything(),
      'CONTENT_FACTORY_ENABLED',
      'false',
    );
    await store.getState().setKillSwitch('o/alpha', 'CONTENT_FACTORY_ENABLED', true);
    expect(setVariable).toHaveBeenLastCalledWith(
      expect.anything(),
      'CONTENT_FACTORY_ENABLED',
      'true',
    );
  });

  it('setWorkflowEnabledById toggles the workflow file, then rescans', async () => {
    const setWorkflowEnabled = vi.fn(async () => {});
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient({ setWorkflowEnabled }));
    await store.getState().scanRepo('o/alpha');
    await store.getState().setWorkflowEnabledById('o/alpha', 1, false);
    expect(setWorkflowEnabled).toHaveBeenLastCalledWith(expect.anything(), 1, false);
  });

  it('loadRunJobs caches the run jobs on the snapshot', async () => {
    const listRunJobs = vi.fn(async () => [
      {
        jobId: 1,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        startedAt: null,
        completedAt: null,
        htmlUrl: 'https://x/j1',
        steps: [],
      },
    ]);
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient({ listRunJobs }));
    await store.getState().scanRepo('o/alpha');
    await store.getState().loadRunJobs('o/alpha', 2);
    const jobs = store.getState().snapshots['o/alpha'].jobsByRun[2];
    expect(Array.isArray(jobs)).toBe(true);
    expect((jobs as { name: string }[])[0].name).toBe('build');
    // Cached: a second load must not hit the client again.
    await store.getState().loadRunJobs('o/alpha', 2);
    expect(listRunJobs).toHaveBeenCalledTimes(1);
  });

  it('loadRunJobs clears the cache on error so a later click can retry (no cached [] masquerading as "no jobs")', async () => {
    const listRunJobs = vi
      .fn()
      .mockRejectedValueOnce(new Error('jobs 503'))
      .mockResolvedValueOnce([
        { jobId: 1, name: 'build', status: 'completed', conclusion: 'success', startedAt: null, completedAt: null, htmlUrl: 'https://x/j1', steps: [] },
      ]);
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient({ listRunJobs }));
    await store.getState().scanRepo('o/alpha');
    await store.getState().loadRunJobs('o/alpha', 2);
    // The transient failure must NOT leave a cached [] blocking retry.
    expect(store.getState().snapshots['o/alpha'].jobsByRun[2]).toBeUndefined();
    await store.getState().loadRunJobs('o/alpha', 2);
    const jobs = store.getState().snapshots['o/alpha'].jobsByRun[2];
    expect((jobs as { name: string }[])[0].name).toBe('build');
    expect(listRunJobs).toHaveBeenCalledTimes(2);
  });

  it('a failed maintenance action surfaces the error and clears the busy flag', async () => {
    const dispatchWorkflow = vi.fn(async () => {
      throw new Error('dispatch boom');
    });
    const store = createFleetOpsStore(memoryStorage());
    connect(fakeClient({ dispatchWorkflow }));
    await store.getState().scanRepo('o/alpha');
    await store.getState().dispatchWorkflowFile('o/alpha', CI);
    expect(store.getState().error).toBe('dispatch boom');
    expect(store.getState().actionBusy['o/alpha:dispatch']).toBe(false);
  });

  it('maintenance without a connection reports the connect error', async () => {
    const store = createFleetOpsStore(memoryStorage());
    await store.getState().dispatchWorkflowFile('o/alpha', CI);
    expect(store.getState().error).toMatch(/Connect/);
  });
});
