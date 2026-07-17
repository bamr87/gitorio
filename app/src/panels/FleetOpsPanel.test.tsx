// @vitest-environment jsdom
// Fleet Command cockpit render smoke: HUD tiles, district cards, rankings, audit
// findings, and the schedule board — all primed straight into the store (no network).

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FleetOpsPanel } from './FleetOpsPanel';
import type { WorkflowFacts } from '../fleet/types';
import { useFleetOpsStore, type FleetWorkflowMetrics, type RepoSnapshot } from '../state/fleetops';

function mkFacts(over: Partial<WorkflowFacts> = {}): WorkflowFacts {
  return {
    path: '.github/workflows/ci.yml',
    name: 'CI',
    dashType: 'ci',
    archetype: 'ci-gate',
    triggers: [{ kind: 'push' }],
    crons: [],
    dormantCrons: [],
    isReusable: false,
    reusableCalls: [],
    jobCount: 1,
    hasMatrix: false,
    timeoutMinutes: 10,
    runners: ['ubuntu-latest'],
    concurrency: { present: true, group: 'ci', cancelInProgress: 'always' },
    permissions: { declared: true, topLevelRead: true, topLevelWrite: false, writeScopes: [] },
    actions: [],
    compositeLocals: [],
    ai: { present: false, runners: [], models: [], maxTurns: null, authMode: 'none', agents: [] },
    killSwitches: [],
    planApply: false,
    guards: [],
    tokenChain: [],
    secretsUsed: [],
    varsUsed: [],
    sinks: [],
    crossRepoTargets: [],
    generated: null,
    manualEditMarkers: 0,
    ...over,
  };
}

function mkMetrics(over: Partial<FleetWorkflowMetrics> = {}): FleetWorkflowMetrics {
  return {
    path: 'o/alpha::.github/workflows/ci.yml',
    repo: 'o/alpha',
    displayPath: '.github/workflows/ci.yml',
    name: 'CI',
    dashType: 'ci',
    runs: 10,
    totalMin: 42,
    avgMin: 4.2,
    p95Min: 9,
    wasteMin: 12,
    runsPerWeek: 5,
    success: 7,
    failure: 3,
    cancelled: 0,
    other: 0,
    successRatePct: 70,
    effectivenessPct: 71.4,
    schedPct: 0,
    reworkRuns: 2,
    reworkPct: 20,
    queueP50Sec: 5,
    events: { push: 10 },
    flags: ['flaky'],
    priority: 24,
    ...over,
  };
}

function mkSnapshot(over: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    slug: 'o/alpha',
    status: 'ready',
    error: null,
    fleet: {
      repo: { owner: 'o', repo: 'alpha' },
      workflows: [],
      externalRepos: [],
      edges: [],
      warnings: [],
    },
    facts: [mkFacts()],
    audit: {
      score: 88,
      grade: 'A',
      findings: [
        {
          ruleId: 'kill-switch',
          severity: 'fail',
          path: '.github/workflows/nightly.yml',
          message: 'scheduled AI line with no kill switch',
          fix: 'Add a vars.NIGHTLY_ENABLED gate job.',
        },
      ],
      passedRules: ['concurrency', 'permissions'],
      byWorkflow: {},
    },
    workflowStates: [],
    variables: [],
    runs: [],
    etag: null,
    scannedAt: 1,
    ...over,
  };
}

function prime() {
  useFleetOpsStore.setState({
    roster: [{ slug: 'o/alpha', source: 'manual', branch: null }],
    snapshots: { 'o/alpha': mkSnapshot() },
    fleetMetrics: [mkMetrics()],
    totals: {
      runs: 10,
      totalMin: 42,
      wasteMin: 12,
      effectivenessPct: 71.4,
      successRatePct: 70,
      reworkPct: 20,
    },
    byType: [
      {
        type: 'ci',
        sharePct: 100,
        runs: 10,
        totalMin: 42,
        wasteMin: 12,
        effectivenessPct: 71.4,
        successRatePct: 70,
        reworkPct: 20,
      },
    ],
    scanning: false,
    progress: null,
    error: null,
    filedWorkOrders: {},
  });
}

beforeEach(() => {
  cleanup();
  prime();
});

const noDrill = () => {};

describe('FleetOpsPanel', () => {
  it('renders the HUD with fleet totals and the scan control', () => {
    render(<FleetOpsPanel onDrill={noDrill} />);
    expect(screen.getByText('repos scanned')).toBeTruthy();
    expect(screen.getByText('effectiveness')).toBeTruthy();
    expect(screen.getByText('71.4%')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scan fleet/ })).toBeTruthy();
  });

  it('shows the district card with its certification grade', () => {
    render(<FleetOpsPanel onDrill={noDrill} />);
    expect(screen.getAllByText('o/alpha').length).toBeGreaterThan(0);
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('switches to Rankings and lists the offender row with its signals', async () => {
    const user = userEvent.setup();
    render(<FleetOpsPanel onDrill={noDrill} />);
    await user.click(screen.getByRole('button', { name: /Rankings/ }));
    expect(screen.getByText(/Priority offenders/)).toBeTruthy();
    expect(screen.getAllByText('flaky').length).toBeGreaterThan(0);
  });

  it('switches to Audit and expands a repo to its findings with a file-issue action', async () => {
    const user = userEvent.setup();
    render(<FleetOpsPanel onDrill={noDrill} />);
    await user.click(screen.getByRole('button', { name: /Audit/ }));
    await user.click(screen.getByRole('button', { name: 'Findings' }));
    expect(screen.getByText(/scheduled AI line with no kill switch/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'File issue' })).toBeTruthy();
  });

  it('gives sibling findings (same rule+path) independent file-issue buttons', async () => {
    // Two standard-trio findings (both path:null, ruleId:standard-trio) must not collide:
    // each keeps its own File-issue button, not share one filed-state.
    useFleetOpsStore.setState({
      snapshots: {
        'o/alpha': mkSnapshot({
          audit: {
            score: 60,
            grade: 'C',
            findings: [
              { ruleId: 'standard-trio', severity: 'warn', path: null, message: 'no CI workflow', fix: 'Add a CI caller.' },
              { ruleId: 'standard-trio', severity: 'warn', path: null, message: 'no @claude handler', fix: 'Add claude.yml.' },
            ],
            passedRules: [],
            byWorkflow: {},
          },
        }),
      },
    });
    const user = userEvent.setup();
    render(<FleetOpsPanel onDrill={noDrill} />);
    await user.click(screen.getByRole('button', { name: /Audit/ }));
    await user.click(screen.getByRole('button', { name: 'Findings' }));
    // Both siblings render distinctly and each has its own File-issue button.
    expect(screen.getByText(/no CI workflow/)).toBeTruthy();
    expect(screen.getByText(/no @claude handler/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'File issue' })).toHaveLength(2);
  });

  it('renders the schedule board with armed kill-switch state', async () => {
    useFleetOpsStore.setState({
      snapshots: {
        'o/alpha': mkSnapshot({
          facts: [
            mkFacts({
              path: '.github/workflows/factory.yml',
              name: 'Factory',
              crons: ['0 8 * * *'],
              killSwitches: ['CONTENT_FACTORY_ENABLED'],
              ai: {
                present: true,
                runners: ['claude-code-action'],
                models: [],
                maxTurns: null,
                authMode: 'oauth-first',
                agents: [],
              },
            }),
          ],
          variables: [{ name: 'CONTENT_FACTORY_ENABLED', value: 'true' }],
        }),
      },
    });
    const user = userEvent.setup();
    render(<FleetOpsPanel onDrill={noDrill} />);
    await user.click(screen.getByRole('button', { name: /Schedule/ }));
    expect(screen.getByText('Factory')).toBeTruthy();
    expect(screen.getByText(/armed/)).toBeTruthy();
  });

  it('shows the empty-roster onboarding when nothing is configured', () => {
    useFleetOpsStore.setState({ roster: [], snapshots: {}, fleetMetrics: [], totals: null, byType: [] });
    render(<FleetOpsPanel onDrill={noDrill} />);
    expect(screen.getByText(/Import a monorepo hub|Build a roster/i)).toBeTruthy();
  });
});
