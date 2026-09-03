// @vitest-environment node
// Invariant tests for the pure IR → geometry layout (specs/013-archify-console, AC-1).
// Runs over the same inputs the delivered maps come from — the dogfood blueprints' lines and
// the three demo fleets — so a green test means the in-app map covers what the maps cover.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Blueprint } from '../blueprint/types';
import { assemblyLines } from '../compiler/compile';
import { createDemoClient } from '../demo/client';
import { DEMO_REPOS } from '../demo/fixtures';
import { importFleet } from '../fleet/import';
import type { Fleet } from '../fleet/types';
import { parseRepo } from '../github/types';
import { toArchitectureIR, toWorkflowIR } from '../archify/ir';
import {
  ARCHITECTURE_LAYOUT,
  layoutArchitecture,
  layoutWorkflow,
  reach,
  WORKFLOW_LAYOUT,
  type MapGeometry,
} from './layout';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const readBp = (rel: string): Blueprint => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const dogfood = ['.factory/blueprint.json', '.factory/docs-gardener.blueprint.json'].flatMap(
  (rel) => {
    const bp = readBp(rel);
    return assemblyLines(bp).map((line) => ({ name: `${rel} · ${line.name}`, bp, line }));
  },
);

async function demoFleets() {
  const client = createDemoClient({ clock: () => Date.parse('2026-01-01T00:00:00Z') });
  const out = [];
  for (const repo of DEMO_REPOS) out.push(await importFleet(client, parseRepo(repo)!));
  return out;
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function assertInvariants(g: MapGeometry) {
  const ids = new Set(g.nodes.map((n) => n.id));
  expect(ids.size).toBe(g.nodes.length);
  for (const n of g.nodes) {
    expect(n.x, `${n.id} x`).toBeGreaterThanOrEqual(0);
    expect(n.y, `${n.id} y`).toBeGreaterThanOrEqual(0);
    expect(n.x + n.w, `${n.id} right`).toBeLessThanOrEqual(g.width);
    expect(n.y + n.h, `${n.id} bottom`).toBeLessThanOrEqual(g.height);
    expect(n.label.length).toBeGreaterThan(0);
  }
  for (const e of g.edges) {
    expect(ids.has(e.from), `${e.id} from`).toBe(true);
    expect(ids.has(e.to), `${e.id} to`).toBe(true);
    expect(e.d).toMatch(/^M -?[\d.]+ -?[\d.]+/);
    expect(Number.isFinite(e.lx) && Number.isFinite(e.ly)).toBe(true);
  }
  // Nodes sharing a frame never overlap (archify's ≥ 100 px column separation holds).
  for (let i = 0; i < g.nodes.length; i++) {
    for (let j = i + 1; j < g.nodes.length; j++) {
      const a = g.nodes[i];
      const b = g.nodes[j];
      expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
  for (const f of g.frames) {
    expect(f.x + f.w).toBeLessThanOrEqual(g.width);
    expect(f.y + f.h).toBeLessThanOrEqual(g.height);
  }
  for (const id of g.mainPath) expect(ids.has(id)).toBe(true);
}

describe('layoutWorkflow (FR-1)', () => {
  it('uses archify’s 680 px lane frame and its column positions', () => {
    for (const { name, bp, line } of dogfood) {
      const g = layoutWorkflow(toWorkflowIR(bp, line));
      expect(g.kind).toBe('workflow');
      expect(g.width, name).toBe(WORKFLOW_LAYOUT.laneX + WORKFLOW_LAYOUT.laneW);
      for (const n of g.nodes) {
        expect(WORKFLOW_LAYOUT.colXs, `${name} ${n.id}`).toContain(n.x + n.w / 2);
        expect(n.w).toBe(WORKFLOW_LAYOUT.nodeW);
        expect(n.h).toBe(WORKFLOW_LAYOUT.nodeH);
      }
      assertInvariants(g);
    }
  });

  it('is deterministic and flags the main path on the routed edges', () => {
    for (const { bp, line } of dogfood) {
      const ir = toWorkflowIR(bp, line);
      const a = layoutWorkflow(ir);
      const b = layoutWorkflow(JSON.parse(JSON.stringify(ir)));
      expect(a).toEqual(b);
      const mainEdges = a.edges.filter((e) => e.role === 'main');
      expect(mainEdges.length).toBe(Math.max(0, a.mainPath.length - 1));
      for (const e of mainEdges) expect(e.marker).toBe('main');
    }
  });

  it('draws an exception lane for the bot guard and dashes the security edge into it', () => {
    const bp = readBp('.factory/blueprint.json');
    const guarded = assemblyLines(bp)
      .map((line) => layoutWorkflow(toWorkflowIR(bp, line)))
      .filter((g) => g.frames.some((f) => f.kind === 'exception'));
    expect(guarded.length).toBeGreaterThan(0);
    for (const g of guarded) {
      const lane = g.frames.find((f) => f.kind === 'lane' && f.prefix === 'EX')!;
      expect(lane.label).toBe('Guards');
      const guard = g.nodes.find((n) => n.id === 'guard-bot-actor')!;
      expect(guard.frame).toBe(lane.id);
      const into = g.edges.filter((e) => e.to === guard.id);
      expect(into.length).toBeGreaterThan(0);
      for (const e of into) expect(e.marker).toBe('security');
    }
  });

  it('keeps only the kinds present in the legend, with the factory’s words', () => {
    const { bp, line } = dogfood[0];
    const g = layoutWorkflow(toWorkflowIR(bp, line));
    const kinds = new Set(g.nodes.map((n) => n.type));
    expect(g.legend.map((l) => l.kind)).toEqual(
      expect.arrayContaining([...kinds].filter((k) => k !== undefined)),
    );
    expect(g.legend.length).toBe(kinds.size);
    expect(g.legend.find((l) => l.kind === 'external')?.label).toBe('Trigger');
  });
});

describe('layoutArchitecture (FR-1)', () => {
  it('places every demo fleet on archify’s grid math inside its boundary', async () => {
    for (const fleet of await demoFleets()) {
      const ir = toArchitectureIR(fleet);
      const g = layoutArchitecture(ir);
      expect(g.kind).toBe('architecture');
      assertInvariants(g);
      const stepX = ir.layout.cellW + ir.layout.gapX;
      const stepY = ir.layout.cellH + ir.layout.gapY;
      for (const c of ir.components) {
        const n = g.nodes.find((x) => x.id === c.id)!;
        expect(n.x).toBe(ir.layout.origin[0] + c.col * stepX);
        expect(n.y).toBe(ir.layout.origin[1] + c.row * stepY);
        expect(n.w).toBe(ARCHITECTURE_LAYOUT.defaultW);
      }
      const boundary = g.frames.find((f) => f.kind === 'boundary')!;
      expect(boundary).toBeTruthy();
      for (const n of g.nodes.filter((x) => x.frame === boundary.id)) {
        expect(n.x).toBeGreaterThanOrEqual(boundary.x);
        expect(n.y).toBeGreaterThanOrEqual(boundary.y);
        expect(n.x + n.w).toBeLessThanOrEqual(boundary.x + boundary.w);
        expect(n.y + n.h).toBeLessThanOrEqual(boundary.y + boundary.h);
      }
      expect(g.width).toBeGreaterThanOrEqual(ir.meta.viewBox![0]);
    }
  });

  it('routes every belt orthogonally and marks cross-repo belts dashed', async () => {
    const fleets = await demoFleets();
    const all = layoutArchitecture(toArchitectureIR(fleets, { title: 'Demo fleet' }));
    assertInvariants(all);
    expect(all.frames.filter((f) => f.kind === 'boundary').length).toBe(fleets.length);

    // The demo fleets carry no belts, so a hand-built one exercises the router: a
    // workflow_run chain (default belt) and a cross-repo emission (dashed, to a station).
    const wf = (slug: string, extra: Partial<Fleet['workflows'][number]> = {}) => ({
      path: `.github/workflows/${slug}.yml`,
      name: slug,
      slug,
      triggers: [{ kind: 'push' }],
      hasAgent: false,
      sinks: [] as Fleet['workflows'][number]['sinks'],
      runAfterNames: [],
      crossRepoTargets: [],
      ...extra,
    });
    const belted: Fleet = {
      repo: { owner: 'acme', repo: 'hub' },
      workflows: [
        wf('ci'),
        wf('deploy', {
          triggers: [{ kind: 'workflow_run' }],
          runAfterNames: ['ci'],
          sinks: ['deploy'],
        }),
        wf('notify', { sinks: ['cross_repo_issue'], crossRepoTargets: ['acme/other'] }),
      ],
      externalRepos: ['acme/other'],
      edges: [
        {
          id: 'e1',
          from: '.github/workflows/ci.yml',
          to: '.github/workflows/deploy.yml',
          kind: 'workflow_run',
          label: 'after',
        },
        {
          id: 'e2',
          from: '.github/workflows/notify.yml',
          to: 'ext:acme/other',
          kind: 'cross_repo',
        },
      ],
      warnings: [],
    };
    const g = layoutArchitecture(toArchitectureIR(belted));
    assertInvariants(g);
    expect(g.edges.length).toBe(2);
    for (const e of g.edges) {
      expect(e.d).toMatch(/^M [\d.]+ [\d.]+( [HVL] [\d.]+( [\d.]+)?)+$/);
    }
    const cross = g.edges.find((e) => e.variant === 'dashed')!;
    expect(cross.marker).toBe('dashed');
    expect(cross.label).toBe('cross-repo');
    const after = g.edges.find((e) => e.label === 'after')!;
    expect(after.marker).toBe('default');
    expect(g.nodes.find((n) => n.id === cross.to)?.sublabel).toBe('external repo');
  });

  it('lifts the story budget when asked, so a live fleet collapses nothing', async () => {
    const [fleet] = await demoFleets();
    const capped = toArchitectureIR(fleet);
    const full = toArchitectureIR(fleet, { cap: Math.max(12, fleet.workflows.length) });
    const g = layoutArchitecture(full);
    expect(g.nodes.some((n) => n.label.endsWith('more workflows'))).toBe(false);
    expect(g.nodes.filter((n) => n.sublabel !== 'external repo').length).toBe(
      fleet.workflows.length,
    );
    expect(capped.components.length).toBeLessThanOrEqual(12);
  });
});

describe('reach — authored reachability', () => {
  it('walks authored edges forward and backward with a hop count', () => {
    const { bp, line } = dogfood[0];
    const g = layoutWorkflow(toWorkflowIR(bp, line));
    const trigger = g.nodes.find((n) => n.frame === 'lane-triggers')!;
    const down = reach(g, trigger.id, 'downstream');
    expect(down.nodes.size).toBeGreaterThan(0);
    expect(down.maxHops).toBeGreaterThanOrEqual(1);
    expect(down.nodes.has(trigger.id)).toBe(false);
    const up = reach(g, trigger.id, 'upstream');
    expect(up.nodes.size).toBe(0);
    expect(up.maxHops).toBe(0);
    const sink = g.nodes.find((n) => n.frame === 'lane-sinks')!;
    expect(reach(g, sink.id, 'upstream').nodes.has(trigger.id)).toBe(true);
  });
});
