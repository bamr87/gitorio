// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MonitorPanel } from './MonitorPanel';
import { useFactoryStore } from '../state/store';
import { useGithubStore } from '../state/github';
import { useMonitorStore } from '../state/monitor';
import type { Blueprint } from '../blueprint/types';

const wardenLine: Blueprint = {
  version: 1,
  meta: { name: 'Warden' },
  nodes: [
    { id: 'm', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
    { id: 'c', type: 'trigger.cron', position: { x: 0, y: 1 }, config: { cron: '0 6 * * 1' } },
    { id: 'a', type: 'agent.claude', position: { x: 1, y: 0 }, config: { promptRef: 'p.md' } },
    { id: 's', type: 'sink.comment', position: { x: 2, y: 0 }, config: { instruction: 'x' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'm', port: 'out' }, to: { node: 'a', port: 'in' } },
    { id: 'e2', from: { node: 'c', port: 'out' }, to: { node: 'a', port: 'in' } },
    { id: 'e3', from: { node: 'a', port: 'out' }, to: { node: 's', port: 'in' } },
  ],
};

beforeEach(() => {
  cleanup();
  useFactoryStore.getState().loadBlueprint(wardenLine);
  useGithubStore.setState({
    client: { login: 'me', listFactoryRuns: vi.fn(async () => ({ runs: [], etag: null, notModified: false, rateRemaining: 5000 })) } as never,
    repo: { owner: 'o', repo: 'r' },
    login: 'me',
  });
  useMonitorStore.setState({
    runs: [
      { path: '.github/workflows/factory--warden.yml', slug: 'warden', runId: 7, runNumber: 7, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', htmlUrl: 'https://x/7', runStartedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:01:00Z', createdAt: '2026-07-05T00:00:00Z', runAttempt: 1 },
    ],
    stats: { total: 1, completed: 1, success: 1, failure: 0, inProgress: 0, successRate: 1, p50DurationSec: 60 },
    jobsByRun: {},
    expandedRunId: null,
    filterSlug: null,
    polling: true,
    lastPolledAt: Date.now(),
    error: null,
    flash: null,
  });
});

describe('MonitorPanel', () => {
  it('shows a connect prompt when disconnected', () => {
    useGithubStore.setState({ login: null });
    render(<MonitorPanel />);
    expect(screen.getByText(/Connect a repo/)).toBeTruthy();
  });

  it('renders the assembly line with a Run-now control (manual lever present) and its runs', () => {
    render(<MonitorPanel />);
    expect(screen.getByText('Warden')).toBeTruthy();
    expect(screen.getByText('factory--warden.yml')).toBeTruthy();
    // the manual line → Run now button enabled
    const runNow = screen.getByRole('button', { name: /Run now/ }) as HTMLButtonElement;
    expect(runNow.disabled).toBe(false);
    // run history row present
    expect(screen.getAllByText('warden').length).toBeGreaterThan(0);
  });
});
