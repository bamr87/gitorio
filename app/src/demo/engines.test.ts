// @vitest-environment jsdom
// The demo's central claim: what a visitor sees is what the code actually does (spec G2,
// AC-2, AC-3, R-3). These tests run the SHIPPING engines — `compile()`, the Fleet Ops
// scan through `facts`/`metrics`/`audit` — over the demo client and assert real output.
// If the demo ever grew its own rendering path, the assertions here would stop matching.

import { afterEach, describe, expect, it } from 'vitest';
import { compile } from '../compiler/compile';
import { auditRepo } from '../fleet/audit';
import { importFleetDeep } from '../fleet/import';
import { parseRepo } from '../github/types';
import { useFleetOpsStore } from '../state/fleetops';
import { useFactoryStore } from '../state/store';
import { createDemoClient } from './client';
import { DEMO_REPOS } from './fixtures';
import { enterDemoMode, exitDemoMode } from './seed';

const clock = () => Date.parse('2026-08-22T09:00:00Z');
const STOREFRONT = parseRepo('acme/storefront')!;

afterEach(() => {
  exitDemoMode();
});

describe('the demo blueprint through the real compiler (AC-2)', () => {
  it('compiles with zero error diagnostics', async () => {
    await enterDemoMode({ clock });
    const bp = useFactoryStore.getState().toBlueprint();
    const result = compile(bp, { blueprintPath: '.factory/blueprint.json' });

    const errors = result.workflows.flatMap((w) =>
      w.diagnostics.filter((d) => d.level === 'error').map((d) => `${w.filename}: ${d.message}`),
    );
    expect(errors).toEqual([]);
    expect(result.workflows.map((w) => w.filename)).toEqual([
      'factory--content-factory.yml',
      'factory--issue-triage.yml',
      'factory--perfection-loop.yml',
    ]);
  });

  it('emits the governance the demo is meant to demonstrate', async () => {
    await enterDemoMode({ clock });
    const result = compile(useFactoryStore.getState().toBlueprint());
    const byFile = new Map(result.workflows.map((w) => [w.filename, w.yaml]));

    // Default-OFF kill switch on both scheduled lines (ADR-017's convention).
    expect(byFile.get('factory--content-factory.yml')).toContain('CONTENT_FACTORY_ENABLED');
    expect(byFile.get('factory--perfection-loop.yml')).toContain('PERFECTION_ENABLED');
    // The perfection loop's three deterministic jobs plus its rotating window (ADR-031).
    const pl = byFile.get('factory--perfection-loop.yml')!;
    expect(pl).toContain('max-parallel: 1');
    expect(pl).toContain('fromJson(needs.plan.outputs.matrix)');
    // The issue line is event-driven and must carry a bot guard (golden rule #6).
    expect(byFile.get('factory--issue-triage.yml')).toContain("!= 'Bot'");
  });
});

describe('the demo fleet through the real Fleet Ops engines (AC-3)', () => {
  it('extracts facts and grades every repo', async () => {
    const client = createDemoClient({ clock });
    for (const slug of DEMO_REPOS) {
      const repo = parseRepo(slug)!;
      const { fleet, facts } = await importFleetDeep(client, repo);
      expect(fleet.warnings).toEqual([]);
      expect(facts.length).toBeGreaterThan(0);

      const workflowStates = Object.fromEntries(
        (await client.listRepoWorkflows(repo)).map((w) => [w.path, w.state]),
      );
      const audit = auditRepo(facts, { workflowStates });
      expect(audit.score).toBeGreaterThanOrEqual(0);
      expect(audit.score).toBeLessThanOrEqual(100);
      expect(audit.grade).toMatch(/^[SABCD]$/);
    }
  });

  it('finds the problems the fixture fleet was built to have', async () => {
    const client = createDemoClient({ clock });
    const { facts } = await importFleetDeep(client, STOREFRONT);
    const audit = auditRepo(facts);
    const nightly = audit.findings.filter((f) => f.path?.endsWith('nightly.yml'));

    // A demo fleet where everything passes teaches nothing. The ungated nightly is the
    // cautionary tale, and the audit has to actually catch it — otherwise the Audit board
    // renders empty and a visitor never learns what it is for.
    expect(nightly.length).toBeGreaterThan(0);
    expect(nightly.map((f) => f.ruleId)).toContain('kill-switch');
  });

  it('rewards the disciplined repo more than the careless one', async () => {
    const client = createDemoClient({ clock });
    const score = async (slug: string) => {
      const repo = parseRepo(slug)!;
      const { facts } = await importFleetDeep(client, repo);
      return auditRepo(facts).score;
    };
    expect(await score('acme/design-system')).toBeGreaterThan(await score('acme/storefront'));
  });

  it('a full store scan populates every board (Districts / Rankings / Workflows / Audit)', async () => {
    await enterDemoMode({ clock });
    await useFleetOpsStore.getState().scanFleet();

    const st = useFleetOpsStore.getState();
    expect(st.error).toBeNull();
    for (const slug of DEMO_REPOS) {
      const snap = st.snapshots[slug];
      expect(snap?.status, `${slug} did not scan`).toBe('ready');
      expect(snap!.facts.length).toBeGreaterThan(0);
      // Variables read cleanly, so the Schedule board shows armed/disarmed, not "unknown".
      expect(snap!.variables).not.toBeNull();
    }

    // Rankings + Workflows read from the derived metrics; totals drive the HUD.
    expect(st.fleetMetrics.length).toBeGreaterThan(0);
    expect(st.totals).not.toBeNull();
    expect(st.totals!.runs).toBeGreaterThan(0);
    expect(st.fleetMetrics.some((m) => m.failure > 0)).toBe(true);
    expect(st.fleetMetrics.some((m) => m.reworkRuns > 0)).toBe(true);
  });
});
