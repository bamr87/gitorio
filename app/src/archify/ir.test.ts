// @vitest-environment node
// Invariant tests for the Blueprint / Fleet → archify IR compiler (specs/010-archify-maps).
// Structural checks run in-process; the acceptance runs go through the VENDORED archify
// CLI at showcase quality (the same gate CI enforces) so a green test means a rendered map.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Blueprint } from '../blueprint/types';
import { assemblyLines } from '../compiler/compile';
import { createDemoClient } from '../demo/client';
import { DEMO_REPOS } from '../demo/fixtures';
import { importFleet } from '../fleet/import';
import { parseRepo } from '../github/types';
import { toArchitectureIR, toWorkflowIR, safeId } from './ir';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ARCHIFY = join(ROOT, 'vendor/archify/bin/archify.mjs');
const readBp = (rel: string): Blueprint => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

function validateShowcase(
  type: 'workflow' | 'architecture',
  ir: unknown,
): { ok: boolean; text: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gf-ir-'));
  const file = join(dir, `${type}.json`);
  writeFileSync(file, JSON.stringify(ir));
  const r = spawnSync(
    process.execPath,
    [ARCHIFY, 'validate', type, file, '--quality', 'showcase', '--json'],
    { encoding: 'utf8' },
  );
  const text = `${r.stdout}\n${r.stderr}`;
  let ok = false;
  try {
    ok = JSON.parse(r.stdout).ok === true && r.status === 0;
  } catch {
    ok = false;
  }
  return { ok, text };
}

const mini = (nodes: [string, string][], edges: [string, string][]): Blueprint => ({
  version: 1,
  meta: { name: 'Mini' },
  nodes: nodes.map(([id, type], i) => ({ id, type, position: { x: i * 100, y: 0 }, config: {} })),
  edges: edges.map(([from, to]) => ({
    id: `${from}-${to}`,
    from: { node: from, port: 'out' },
    to: { node: to, port: 'in' },
  })),
});

describe('toWorkflowIR — structure (FR-3)', () => {
  const bp = mini(
    [
      ['t', 'trigger.issue_opened'],
      ['a', 'agent.claude'],
      ['s1', 'sink.comment'],
      ['s2', 'sink.label'],
    ],
    [
      ['t', 'a'],
      ['a', 's1'],
      ['a', 's2'],
    ],
  );
  const ir = toWorkflowIR(bp, assemblyLines(bp)[0]);

  it('emits a showcase workflow diagram with role lanes in order', () => {
    expect(ir.diagram_type).toBe('workflow');
    expect(ir.meta.quality_profile).toBe('showcase');
    expect(ir.lanes.map((l) => l.id)).toEqual(['triggers', 'agent', 'sinks', 'guards']);
  });

  it('every edge endpoint is a node and mainPath walks real edges to a sink', () => {
    const ids = new Set(ir.nodes.map((n) => n.id));
    for (const e of ir.edges) {
      expect(ids.has(e.from), e.id).toBe(true);
      expect(ids.has(e.to), e.id).toBe(true);
    }
    expect(ir.mainPath).toEqual(['t', 'a', 's1']);
    const pairs = new Set(ir.edges.map((e) => `${e.from}>${e.to}`));
    ir.mainPath!.slice(1).forEach((id, i) =>
      expect(pairs.has(`${ir.mainPath![i]}>${id}`)).toBe(true),
    );
    expect(ir.edges.filter((e) => e.role === 'main')).toHaveLength(2);
  });

  it('columns follow depth and same-lane nodes never collide', () => {
    const col = Object.fromEntries(ir.nodes.map((n) => [n.id, n.col]));
    expect(col.t).toBeLessThan(col.a);
    expect(col.a).toBeLessThan(col.s1);
    // both sinks sit in the sinks lane at ≥ 100 px separation (cols 2 and 3 are 130 px apart; 1 and 2 only 80)
    expect(Math.abs(col.s1 - col.s2)).toBeGreaterThan(0);
  });

  it('draws the bot-actor guard in an exception lane iff the line is loop-prone (AC-5)', () => {
    const guard = ir.nodes.find((n) => n.id === 'guard-bot-actor');
    expect(guard?.lane).toBe('guards');
    expect(ir.lanes.find((l) => l.id === 'guards')?.variant).toBe('exception');
    expect(
      ir.edges.some(
        (e) => e.from === 't' && e.to === 'guard-bot-actor' && e.variant === 'security',
      ),
    ).toBe(true);

    const cron = mini(
      [
        ['c', 'trigger.cron'],
        ['a', 'agent.claude'],
        ['p', 'sink.open_pr'],
      ],
      [
        ['c', 'a'],
        ['a', 'p'],
      ],
    );
    const cronIr = toWorkflowIR(cron, assemblyLines(cron)[0]);
    expect(cronIr.nodes.some((n) => n.id === 'guard-bot-actor')).toBe(false);
    expect(cronIr.lanes.some((l) => l.id === 'guards')).toBe(false);
  });

  it('sanitises ids and uses the factory legend words', () => {
    expect(safeId('1st node.yml')).toBe('n-1st-node-yml');
    expect(safeId('ok_id-9')).toBe('ok_id-9');
    expect(ir.meta.legend?.entries?.external?.label).toBe('Trigger');
  });

  it('collapses a full lane\'s tail into one "+N more" node instead of overlapping', () => {
    const many = mini(
      [
        ['c', 'trigger.cron'],
        ['a', 'agent.claude'],
        ...Array.from({ length: 6 }, (_, i) => [`s${i}`, 'sink.comment'] as [string, string]),
      ],
      [['c', 'a'], ...Array.from({ length: 6 }, (_, i) => ['a', `s${i}`] as [string, string])],
    );
    const out = toWorkflowIR(many, assemblyLines(many)[0]);
    const more = out.nodes.find((n) => n.id === 'sinks-more');
    expect(more?.label).toMatch(/^\+\d more$/);
    expect(out.nodes.filter((n) => n.lane === 'sinks').length).toBeLessThanOrEqual(4);
    expect(out.edges.filter((e) => e.to === 'sinks-more')).toHaveLength(1);
    const ids = new Set(out.nodes.map((n) => n.id));
    for (const e of out.edges) expect(ids.has(e.to) && ids.has(e.from), e.id).toBe(true);
    const byLane = new Map<string, number[]>();
    for (const n of out.nodes) byLane.set(n.lane, [...(byLane.get(n.lane) ?? []), n.col]);
    for (const cols of byLane.values()) expect(new Set(cols).size).toBe(cols.length);
    const r = validateShowcase('workflow', out);
    expect(r.ok, r.text.slice(0, 2500)).toBe(true);
  });
});

describe('toWorkflowIR — dogfood blueprints pass the vendored showcase gate (AC-3)', () => {
  for (const rel of ['.factory/blueprint.json', '.factory/docs-gardener.blueprint.json']) {
    const bp = readBp(rel);
    for (const line of assemblyLines(bp)) {
      it(`${rel} · ${line.filename}`, () => {
        const ir = toWorkflowIR(bp, line, { source: rel });
        const r = validateShowcase('workflow', ir);
        expect(r.ok, r.text.slice(0, 2500)).toBe(true);
      });
    }
  }
});

describe('toArchitectureIR — demo fleet (FR-4, AC-4)', () => {
  const client = createDemoClient({ clock: () => Date.parse('2026-08-28T12:00:00Z') });

  it('keeps ≤ 12 components, one boundary per repo, and every connection endpoint real', async () => {
    const fleets = await Promise.all(DEMO_REPOS.map((r) => importFleet(client, parseRepo(r)!)));
    const ir = toArchitectureIR(fleets);
    expect(ir.components.length).toBeLessThanOrEqual(12 + 3); // + external-repo rows at most
    expect(ir.boundaries).toHaveLength(3);
    const ids = new Set(ir.components.map((c) => c.id));
    for (const b of ir.boundaries) for (const id of b.wraps) expect(ids.has(id)).toBe(true);
    for (const c of ir.connections) {
      expect(ids.has(c.from)).toBe(true);
      expect(ids.has(c.to)).toBe(true);
    }
    expect(new Set(ir.components.map((c) => `${c.row}:${c.col}`)).size).toBe(ir.components.length);
  });

  for (const repo of DEMO_REPOS) {
    it(`${repo} passes the vendored showcase gate`, async () => {
      const fleet = await importFleet(client, parseRepo(repo)!);
      const ir = toArchitectureIR(fleet);
      const r = validateShowcase('architecture', ir);
      expect(r.ok, r.text.slice(0, 2500)).toBe(true);
    });
  }

  it('collapses the tail of a large fleet into one "more" component', async () => {
    const fleet = await importFleet(client, parseRepo(DEMO_REPOS[0])!);
    const ir = toArchitectureIR(fleet, { cap: 2 });
    const more = ir.components.find((c) => c.id.endsWith('--more'));
    expect(more?.label).toMatch(/more workflow/);
    expect(ir.components.length).toBeLessThanOrEqual(2 + 3);
  });
});
