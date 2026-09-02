// @vitest-environment node
// The fleet/v1 bridge (specs/014, FR-6, AC-5): GitFactory's own blueprints compile to the
// lanes its committed `fleet.manifest.yml` (written by `wtd fleet adopt`) records — same id,
// harness, implementation, switch, guardrails, and token set — so the hub can present what
// GitFactory deploys. Plus the parser's tolerance and the structural kind table.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_BLUEPRINT } from '../blueprint/example';
import type { Blueprint } from '../blueprint/types';
import { laneForPath, parseFleetManifest, toFleetLanes } from './lanes';
import { toFleetManifestYaml } from './manifest-yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const readBp = (rel: string): Blueprint => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

describe('parity with gitorio’s committed fleet.manifest.yml (AC-5)', () => {
  const manifest = parseFleetManifest(readFileSync(join(ROOT, 'fleet.manifest.yml'), 'utf8'));
  const lanes = [
    ...toFleetLanes(readBp('.factory/blueprint.json')),
    ...toFleetLanes(readBp('.factory/docs-gardener.blueprint.json')),
  ];

  it('reads the manifest', () => {
    expect(manifest.spec_version).toBe('fleet/v1');
    expect(manifest.repo).toBe('bamr87/gitorio');
    expect(manifest.provenance).toBe('derived');
    expect(manifest.skipped).toBe(0);
    expect(manifest.lanes.filter((l) => l.id.startsWith('factory--')).length).toBeGreaterThanOrEqual(4);
  });

  it('every factory lane the manifest records is what the blueprint compiles to', () => {
    for (const recorded of manifest.lanes.filter((l) => l.id.startsWith('factory--'))) {
      const mine = lanes.find((l) => l.id === recorded.id);
      expect(mine, recorded.id).toBeTruthy();
      expect(mine!.harness).toBe(recorded.harness);
      expect(mine!.implementation).toBe(recorded.implementation);
      expect(mine!.switch).toBe(recorded.switch);
      expect(mine!.guardrails.never_merges).toBe(recorded.guardrails.never_merges);
      if (recorded.guardrails.opens_pull_requests !== undefined) {
        expect(mine!.guardrails.opens_pull_requests, recorded.id).toBe(recorded.guardrails.opens_pull_requests);
      }
      expect(mine!.uses_tokens).toEqual(recorded.uses_tokens);
    }
  });

  it('exports a manifest document the parser reads back', () => {
    const text = toFleetManifestYaml(readBp('.factory/docs-gardener.blueprint.json'), 'bamr87/gitorio');
    const back = parseFleetManifest(text);
    expect(back.spec_version).toBe('fleet/v1');
    expect(back.lanes.map((l) => l.id)).toEqual(['factory--docs-gardener']);
    expect(back.lanes[0].switch).toBe('DOCS_GARDENER_ENABLED');
    expect(back.lanes[0].uses_tokens).toEqual(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
    expect(text).toContain('tokens:');
  });
});

describe('the kind table and the lane shape', () => {
  it('reads the example blueprint’s two lines as triage and maintenance harnesses', () => {
    const lanes = toFleetLanes(EXAMPLE_BLUEPRINT);
    expect(lanes.length).toBe(2);
    const issue = lanes.find((l) => l.triggers.some((t) => t.kind === 'event'))!;
    expect(issue.kind).toBe('triage');
    expect(issue.triggers).toEqual([{ kind: 'event', events: ['issues'] }]);
    expect(issue.harness).toBe('claude-code-action');
    expect(issue.guardrails).toEqual({ never_merges: true, opens_pull_requests: false });
    const cron = lanes.find((l) => l.triggers.some((t) => t.kind === 'schedule'))!;
    expect(cron.kind).toBe('maintenance');
    expect(cron.triggers[0]).toEqual({ kind: 'schedule', cron: '0 3 * * *' });
  });

  it('deterministic lines are engine lanes with no Claude tokens; cross-repo sinks add their token', () => {
    const bp: Blueprint = {
      version: 1,
      meta: { name: 'Det' },
      nodes: [
        { id: 't', type: 'trigger.pr_opened', position: { x: 0, y: 0 }, config: { fireOn: 'labeled', label: 'dep:safe' } },
        { id: 'm', type: 'sink.merge_pr', position: { x: 0, y: 0 }, config: {} },
        { id: 'c', type: 'trigger.cron', position: { x: 0, y: 0 }, config: { cron: '0 4 * * *' } },
        { id: 'x', type: 'sink.cross_repo_issue', position: { x: 0, y: 0 }, config: { targetRepo: 'o/r' } },
      ],
      edges: [
        { id: 'e1', from: { node: 't', port: 'out' }, to: { node: 'm', port: 'in' } },
        { id: 'e2', from: { node: 'c', port: 'out' }, to: { node: 'x', port: 'in' } },
      ],
    };
    const lanes = toFleetLanes(bp);
    const merge = lanes.find((l) => l.guardrails.never_merges === false)!;
    expect(merge.harness).toBe('engine');
    expect(merge.uses_tokens).toEqual([]);
    expect(merge.kind).toBe('review');
    const fan = lanes.find((l) => l.uses_tokens.includes('FLEET_TOKEN'))!;
    expect(fan.kind).toBe('fanout');
    expect(fan.harness).toBe('engine');
  });

  it('parses junk tolerantly and finds a lane by path or basename', () => {
    expect(parseFleetManifest('not: [yaml').lanes).toEqual([]);
    expect(parseFleetManifest('lanes: [1, {kind: mention}, {id: ok, kind: weird, harness: none}]').lanes).toEqual([
      expect.objectContaining({ id: 'ok', kind: 'other', harness: 'none', guardrails: { never_merges: true } }),
    ]);
    expect(parseFleetManifest('lanes: [1, 2]').skipped).toBe(2);
    const m = parseFleetManifest('lanes:\n- id: ci\n  implementation: .github/workflows/ci.yml\n- id: nightly\n');
    expect(laneForPath(m, '.github/workflows/ci.yml')?.id).toBe('ci');
    expect(laneForPath(m, '.github/workflows/nightly.yml')?.id).toBe('nightly');
    expect(laneForPath(m, '.github/workflows/other.yml')).toBeNull();
    expect(laneForPath(null, 'x')).toBeNull();
  });
});
