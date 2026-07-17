import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMonitorStore } from './monitor';
import { useGithubStore } from './github';
import type { FactoryRun, RunJob } from '../github/types';

const run = (over: Partial<FactoryRun> = {}): FactoryRun => ({
  path: '.github/workflows/factory--line.yml',
  slug: 'line',
  runId: 1,
  runNumber: 1,
  status: 'completed',
  conclusion: 'success',
  event: 'workflow_dispatch',
  htmlUrl: 'https://x/1',
  runStartedAt: '2026-07-05T00:00:00Z',
  updatedAt: '2026-07-05T00:01:00Z',
  createdAt: '2026-07-05T00:00:00Z',
  runAttempt: 1,
  ...over,
});

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    login: 'me',
    listFactoryRuns: vi.fn(async () => ({ runs: [run(), run({ runId: 2, slug: 'other', status: 'in_progress', conclusion: null })], etag: 'e1', notModified: false, rateRemaining: 5000 })),
    listRunJobs: vi.fn(async (): Promise<RunJob[]> => [{ jobId: 9, name: 'line', status: 'completed', conclusion: 'success', startedAt: null, completedAt: null, htmlUrl: 'https://x/job', steps: [] }]),
    dispatchWorkflow: vi.fn(async () => {}),
    cancelRun: vi.fn(async () => {}),
    ...over,
  };
}

function connect(client: ReturnType<typeof fakeClient>) {
  useGithubStore.setState({ client: client as never, repo: { owner: 'o', repo: 'r' }, login: 'me' });
}

beforeEach(() => {
  useMonitorStore.setState({ runs: [], etag: null, stats: null, jobsByRun: {}, expandedRunId: null, filterSlug: null, error: null, flash: null });
});

describe('monitor store', () => {
  it('poll maps runs and computes dashboard stats', async () => {
    connect(fakeClient());
    await useMonitorStore.getState().poll();
    const s = useMonitorStore.getState();
    expect(s.runs).toHaveLength(2);
    expect(s.stats?.total).toBe(2);
    expect(s.stats?.inProgress).toBe(1);
    expect(s.etag).toBe('e1');
  });

  it('a 304 keeps the prior runs (no clobber)', async () => {
    const client = fakeClient();
    connect(client);
    await useMonitorStore.getState().poll();
    client.listFactoryRuns.mockResolvedValueOnce({ runs: [], etag: 'e1', notModified: true, rateRemaining: 5000 });
    await useMonitorStore.getState().poll();
    expect(useMonitorStore.getState().runs).toHaveLength(2);
  });

  it('expand() lazy-loads jobs once and caches them', async () => {
    const client = fakeClient();
    connect(client);
    await useMonitorStore.getState().expand(1);
    expect(useMonitorStore.getState().expandedRunId).toBe(1);
    expect(Array.isArray(useMonitorStore.getState().jobsByRun[1])).toBe(true);
    // collapse + re-expand → no second fetch (cached)
    await useMonitorStore.getState().expand(1); // collapse
    await useMonitorStore.getState().expand(1); // re-open
    expect(client.listRunJobs).toHaveBeenCalledTimes(1);
  });

  it('dispatch() calls dispatchWorkflow with the filename and flashes', async () => {
    const client = fakeClient();
    connect(client);
    await useMonitorStore.getState().dispatch('factory--line.yml');
    expect(client.dispatchWorkflow).toHaveBeenCalledWith({ owner: 'o', repo: 'r' }, 'factory--line.yml');
    expect(useMonitorStore.getState().flash).toMatch(/Dispatched/);
  });

  it('cancel() calls cancelRun; setFilter updates the filter', async () => {
    const client = fakeClient();
    connect(client);
    await useMonitorStore.getState().cancel(2);
    expect(client.cancelRun).toHaveBeenCalledWith({ owner: 'o', repo: 'r' }, 2);
    useMonitorStore.getState().setFilter('line');
    expect(useMonitorStore.getState().filterSlug).toBe('line');
  });

  it('surfaces errors without throwing', async () => {
    connect(fakeClient({ listFactoryRuns: vi.fn(async () => { throw new Error('boom'); }) }));
    await useMonitorStore.getState().poll();
    expect(useMonitorStore.getState().error).toBe('boom');
  });
});
