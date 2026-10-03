// @vitest-environment node
// Design readiness (specs/014, FR-8, AC-6): the six layers evaluated over the dogfood
// blueprints, the n/a rules for deterministic lines, and the twelve-row checklist.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Blueprint } from '../blueprint/types';
import { blueprintReadiness, LAYERS } from './readiness';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const readBp = (rel: string): Blueprint => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

describe('the Docs Gardener line', () => {
  const r = blueprintReadiness(readBp('.factory/docs-gardener.blueprint.json'));
  const line = r.lines[0];
  const layer = (id: string) => line.layers.find((l) => l.id === id)!;

  it('has all six layers with guides, a bounded loop, and a default-OFF switch', () => {
    expect(line.layers.map((l) => l.id)).toEqual(LAYERS.map((l) => l.id));
    expect(line.hasAgent).toBe(true);
    expect(layer('guides').status).toBe('ok');
    expect(layer('guides').evidence[0]).toMatch(/promptRef/);
    expect(layer('loop').evidence.some((e) => e.startsWith('rate limiter'))).toBe(true);
    expect(layer('permissions').evidence.some((e) => e === 'kill switch vars.DOCS_GARDENER_ENABLED')).toBe(true);
    expect(layer('permissions').status).toBe('ok');
    expect(layer('observability').status).toBe('ok');
    expect(layer('observability').evidence[0]).toBe('compiles to factory--docs-gardener.yml');
    expect(line.score).toBeGreaterThanOrEqual(50);
  });

  it('renders the hub’s twelve-row checklist with the gardener’s kill switch counted', () => {
    expect(r.checklist.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(r.checklist.find((c) => c.n === 11)!.status).toBe('ok');
    expect(r.checklist.find((c) => c.n === 12)!.status).toBe('missing'); // only telemetry can tick it
    expect(r.score).toBe(line.score);
  });
});

describe('the gitorio blueprint and a deterministic line', () => {
  it('scores every line; no agent line carries a merge sink and every scheduled agent line is switched (ADR-039)', () => {
    const r = blueprintReadiness(readBp('.factory/blueprint.json'));
    expect(r.lines.length).toBeGreaterThanOrEqual(4);
    for (const l of r.lines) expect(l.layers.length).toBe(6);
    const gaps = r.lines.flatMap((l) => l.layers.flatMap((x) => x.gaps));
    expect(gaps.filter((g) => g.includes('merge sink'))).toEqual([]);
    expect(gaps.filter((g) => g.includes('gate.enablement switch'))).toEqual([]);
  });

  it('flags an agent line that carries a merge sink', () => {
    const bp: Blueprint = {
      version: 1,
      meta: { name: 'Agent Merge' },
      nodes: [
        { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
        { id: 'a', type: 'agent.claude', position: { x: 0, y: 0 }, config: { promptRef: 'p.md' } },
        { id: 'm', type: 'sink.merge_pr', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'e1', from: { node: 't', port: 'out' }, to: { node: 'a', port: 'in' } },
        { id: 'e2', from: { node: 'a', port: 'out' }, to: { node: 'm', port: 'in' } },
      ],
    };
    const r = blueprintReadiness(bp);
    const flagged = r.lines.find((l) => l.layers.some((x) => x.gaps.some((g) => g.includes('merge sink'))));
    expect(flagged, 'an agent line with a merge sink: permissions must warn').toBeTruthy();
  });

  it('marks agent-only layers n/a on a deterministic line and says so in the checklist', () => {
    const bp: Blueprint = {
      version: 1,
      meta: { name: 'Merge' },
      nodes: [
        { id: 't', type: 'trigger.pr_opened', position: { x: 0, y: 0 }, config: { fireOn: 'labeled', label: 'dep:safe' } },
        { id: 'm', type: 'sink.merge_pr', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [{ id: 'e1', from: { node: 't', port: 'out' }, to: { node: 'm', port: 'in' } }],
    };
    const r = blueprintReadiness(bp);
    const line = r.lines[0];
    expect(line.hasAgent).toBe(false);
    for (const id of ['guides', 'sensors', 'loop', 'memory']) {
      expect(line.layers.find((l) => l.id === id)!.status, id).toBe('n/a');
    }
    expect(line.layers.find((l) => l.id === 'permissions')!.status).toBe('ok');
    expect(r.checklist[0].note).toBe('no agent lines');
    expect(r.score).toBe(0);
  });
});
