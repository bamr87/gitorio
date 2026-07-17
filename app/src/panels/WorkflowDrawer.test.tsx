// @vitest-environment jsdom
// WorkflowDrawer unit smoke: the capability report renders from facts, and every mutation is
// gated behind a confirm that names the consequence before the store action fires. The store
// actions are faked via setState so the confirm-then-call contract is observable.

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Archetype, WorkflowFacts } from '../fleet/types';
import type { FactoryRun } from '../github/types';
import { useFleetOpsStore, type RepoSnapshot } from '../state/fleetops';
import { archetypeLabel, WorkflowDrawer } from './WorkflowDrawer';

function mkFacts(over: Partial<WorkflowFacts> = {}): WorkflowFacts {
  return {
    path: '.github/workflows/factory.yml',
    name: 'Content Factory',
    dashType: 'ai',
    archetype: 'content-factory',
    triggers: [{ kind: 'schedule', detail: '0 8 * * *' }],
    crons: ['0 8 * * *'],
    dormantCrons: [],
    isReusable: false,
    reusableCalls: [],
    jobCount: 2,
    hasMatrix: false,
    matrixDynamic: false,
    localWorkflowCalls: [],
    waitBound: false,
    timeoutMinutes: 30,
    runners: ['ubuntu-latest'],
    concurrency: { present: false, group: null, cancelInProgress: 'unset' },
    permissions: { declared: true, topLevelRead: true, topLevelWrite: false, writeScopes: ['contents', 'pull-requests'] },
    actions: [],
    compositeLocals: [],
    ai: { present: true, runners: ['claude-code-action'], models: [], maxTurns: 15, maxCostUsd: null, authMode: 'oauth-first', agents: [] },
    killSwitches: ['CONTENT_FACTORY_ENABLED'],
    planApply: true,
    guards: ['rate-limiter', 'gate-job'],
    tokenChain: ['FLEET_TOKEN', 'github.token'],
    secretsUsed: [],
    varsUsed: ['CONTENT_FACTORY_ENABLED'],
    sinks: ['pr'],
    crossRepoTargets: [],
    generated: null,
    manualEditMarkers: 0,
    ...over,
  };
}

function run(over: Partial<FactoryRun> = {}): FactoryRun {
  return {
    path: '.github/workflows/factory.yml',
    slug: 'factory',
    runId: 1,
    runNumber: 1,
    status: 'completed',
    conclusion: 'success',
    event: 'schedule',
    htmlUrl: 'https://x/1',
    runStartedAt: '2026-07-16T00:00:00Z',
    updatedAt: '2026-07-16T00:05:00Z',
    createdAt: '2026-07-16T00:00:00Z',
    runAttempt: 1,
    ...over,
  };
}

function mkSnapshot(over: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    slug: 'o/x',
    status: 'ready',
    error: null,
    fleet: { repo: { owner: 'o', repo: 'x' }, workflows: [], externalRepos: [], edges: [], warnings: [] },
    facts: [mkFacts()],
    audit: null,
    workflowStates: [{ id: 42, name: 'Content Factory', path: '.github/workflows/factory.yml', state: 'active', htmlUrl: 'https://x/w' }],
    variables: [{ name: 'CONTENT_FACTORY_ENABLED', value: 'true' }],
    runs: [run()],
    jobsByRun: {},
    etag: null,
    scannedAt: 1,
    ...over,
  };
}

const spies = {
  dispatchWorkflowFile: vi.fn(async () => {}),
  rerunLatestFailed: vi.fn(async () => {}),
  cancelRunById: vi.fn(async () => {}),
  setKillSwitch: vi.fn(async () => {}),
  setWorkflowEnabledById: vi.fn(async () => {}),
  loadRunJobs: vi.fn(async () => {}),
};

beforeEach(() => {
  cleanup();
  for (const fn of Object.values(spies)) fn.mockClear();
  useFleetOpsStore.setState({ actionBusy: {}, ...spies });
});

afterEach(cleanup);

const noop = () => {};

describe('WorkflowDrawer', () => {
  it('renders the archetype, kill-switch state, guards, and token chain from facts', () => {
    render(<WorkflowDrawer slug="o/x" facts={mkFacts()} snapshot={mkSnapshot()} onClose={noop} />);
    const dialog = screen.getByRole('dialog', { name: /Manage Content Factory/ });
    expect(within(dialog).getByText('Content factory')).toBeTruthy();
    expect(within(dialog).getByText(/CONTENT_FACTORY_ENABLED armed/)).toBeTruthy();
    expect(within(dialog).getByText('gate-job')).toBeTruthy();
    expect(within(dialog).getByText(/FLEET_TOKEN → github\.token/)).toBeTruthy();
  });

  it('confirms before disarming a kill switch, then calls setKillSwitch(...false)', async () => {
    const user = userEvent.setup();
    render(<WorkflowDrawer slug="o/x" facts={mkFacts()} snapshot={mkSnapshot()} onClose={noop} />);
    await user.click(screen.getByRole('button', { name: /Disarm CONTENT_FACTORY_ENABLED/ }));
    expect(screen.getByText(/short-circuit at its gate/i)).toBeTruthy();
    expect(spies.setKillSwitch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Disarm CONTENT_FACTORY_ENABLED' }));
    expect(spies.setKillSwitch).toHaveBeenCalledWith('o/x', 'CONTENT_FACTORY_ENABLED', false);
  });

  it('cancelling the confirm dialog dismisses it without mutating', async () => {
    const user = userEvent.setup();
    render(<WorkflowDrawer slug="o/x" facts={mkFacts()} snapshot={mkSnapshot()} onClose={noop} />);
    await user.click(screen.getByRole('button', { name: '▶ Run now' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(spies.dispatchWorkflowFile).not.toHaveBeenCalled();
  });

  it('shows a Cancel-run control only for an in-progress run and confirms before cancelling', async () => {
    const snapshot = mkSnapshot({ runs: [run({ runId: 7, status: 'in_progress', conclusion: null })] });
    const user = userEvent.setup();
    render(<WorkflowDrawer slug="o/x" facts={mkFacts()} snapshot={snapshot} onClose={noop} />);
    await user.click(screen.getByRole('button', { name: /Cancel run/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel run' }));
    expect(spies.cancelRunById).toHaveBeenCalledWith('o/x', 7);
  });

  it('maps archetype strings to readable labels', () => {
    expect(archetypeLabel('agentic-validator')).toBe('Agentic validator');
    expect(archetypeLabel('dependency-bot')).toBe('Dependency bot');
    expect(archetypeLabel('other' as Archetype)).toBe('Other');
  });
});
