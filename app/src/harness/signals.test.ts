// @vitest-environment jsdom
// The live adapter (specs/014, FR-3, AC-3): a Fleet Ops scan of the demo fleet becomes the
// hub's signal shapes and runs through the same `harnessHealth()` as the hub's files.

import { afterEach, describe, expect, it } from 'vitest';
import { enterDemoMode, exitDemoMode } from '../demo/seed';
import { useFleetOpsStore } from '../state/fleetops';
import { harnessHealth } from './health';
import { liveActionsUsage, liveFleetTriage, liveSignals, type LiveScan } from './signals';

afterEach(() => exitDemoMode());

async function scannedDemo(): Promise<LiveScan> {
  await enterDemoMode();
  await useFleetOpsStore.getState().scanFleet();
  const s = useFleetOpsStore.getState();
  return {
    rollup: s.totals,
    workflows: s.fleetMetrics,
    repos: Object.values(s.snapshots),
    scannedAt: new Date(),
  };
}

describe('live signals from a Fleet Ops scan', () => {
  it('maps the rollup and the per-workflow rows into actions_usage', async () => {
    const scan = await scannedDemo();
    expect(scan.rollup).toBeTruthy();
    const usage = liveActionsUsage(scan)!;
    expect(usage.totals!.success_rate_pct).toBe(Math.round(scan.rollup!.successRatePct * 10) / 10);
    expect(usage.totals!.effectiveness_pct).toBe(Math.round(scan.rollup!.effectivenessPct * 10) / 10);
    expect(usage.workflows!.length).toBe(scan.workflows.length);
    for (const w of usage.workflows!) {
      expect(w.external).toBe(false);
      expect(w.path).toMatch(/^\.github\/workflows\//);
      expect(w.repo).not.toContain('/');
    }
    expect(usage.generated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  });

  it('counts standing red workflows and red repos into fleet_triage', async () => {
    const scan = await scannedDemo();
    const triage = liveFleetTriage(scan)!;
    let failing = 0;
    for (const repo of scan.repos) {
      const latest = new Map<string, (typeof repo.runs)[number]>();
      for (const run of repo.runs) {
        const cur = latest.get(run.path);
        if (!cur || run.createdAt > cur.createdAt) latest.set(run.path, run);
      }
      for (const run of latest.values()) if (run.conclusion === 'failure') failing += 1;
    }
    expect(triage.totals!.failing_workflows).toBe(failing);
    expect(triage.totals!.repos_red).toBeGreaterThanOrEqual(failing > 0 ? 1 : 0);
  });

  it('runs the hub’s engine over the live scan and reports the hub-only loops as missing', async () => {
    const scan = await scannedDemo();
    const health = harnessHealth(liveSignals(scan), undefined, scan.scannedAt);
    expect(health.scorecard.completion_rate_pct.value).toBe(Math.round(scan.rollup!.successRatePct * 10) / 10);
    expect(health.scorecard.completion_rate_pct.status).not.toBe('unknown');
    expect(health.sources.actions_usage.present).toBe(true);
    expect(health.sources.issue_pipeline.present).toBe(false);
    expect(health.sources.token_rotation.present).toBe(false);
    const stale = health.trip_wires.find((w) => w.id === 'stale-data')!;
    expect(stale.tripped).toBe(true);
    expect(stale.detail!.map((d) => d.source)).toEqual(['issue_pipeline', 'token_rotation']);
    expect(health.scorecard.escalations_open.value).toBeNull();
    expect(health.trip_wires.map((w) => w.id).length).toBe(6);
  });
});
