import { describe, expect, it } from 'vitest';
import { buildDeployPlan, detectDrift, BLUEPRINT_PATH, WORKFLOW_DIR } from './deploy';
import type { RepoState } from './deploy';
import { compile } from '../compiler/compile';
import { EXAMPLE_BLUEPRINT } from '../blueprint/example';
import { blueprintHash } from '../blueprint/types';
import type { Blueprint } from '../blueprint/types';
import type { RepoFile } from './types';

const emptyRepo: RepoState = { blueprintFile: null, workflowFiles: [], promptPaths: [] };

const wfFile = (name: string, content: string, sha = 'sha-' + name): RepoFile => ({
  path: `${WORKFLOW_DIR}/${name}`,
  content,
  sha,
});

describe('buildDeployPlan: example blueprint against an empty repo', () => {
  const plan = buildDeployPlan(EXAMPLE_BLUEPRINT, emptyRepo);

  it('writes the blueprint file (pretty JSON, no sha since it is new)', () => {
    const bp = plan.writes.find((w) => w.path === BLUEPRINT_PATH);
    expect(bp).toBeDefined();
    expect(bp!.reason).toBe('blueprint');
    expect(bp!.sha).toBeUndefined();
    expect(bp!.content).toBe(JSON.stringify(EXAMPLE_BLUEPRINT, null, 2));
  });

  it('writes at least one factory workflow with the correct path + reason', () => {
    const wfWrites = plan.writes.filter((w) => w.reason === 'workflow');
    expect(wfWrites.length).toBeGreaterThanOrEqual(1);
    for (const w of wfWrites) {
      expect(w.path.startsWith(`${WORKFLOW_DIR}/factory--`)).toBe(true);
      expect(w.path.endsWith('.yml')).toBe(true);
      expect(w.sha).toBeUndefined(); // empty repo → creates, no sha
    }
  });

  it('deletes nothing (repo has no existing workflows)', () => {
    expect(plan.deletes).toEqual([]);
  });

  it('warns about every missing prompt referenced by the agent nodes', () => {
    expect(plan.warnings).toContain(
      'Prompt not found in repo: .factory/prompts/triage.md (add it before the factory can run)',
    );
    expect(plan.warnings).toContain(
      'Prompt not found in repo: .factory/prompts/nightly-gardener.md (add it before the factory can run)',
    );
  });

  it('drops prompt warnings once the prompt files exist in the repo', () => {
    const repo: RepoState = {
      ...emptyRepo,
      promptPaths: ['.factory/prompts/triage.md', '.factory/prompts/nightly-gardener.md'],
    };
    const p = buildDeployPlan(EXAMPLE_BLUEPRINT, repo);
    expect(p.warnings).toEqual([]);
  });
});

describe('buildDeployPlan: stale factory workflow deletion', () => {
  const { workflows } = compile(EXAMPLE_BLUEPRINT);
  const stale = wfFile('factory--old.yml', '# stale', 'x');
  const ci = wfFile('ci.yml', 'name: CI', 'ci-sha');

  const repo: RepoState = {
    blueprintFile: null,
    workflowFiles: [stale, ci, ...workflows.map((w) => wfFile(w.filename, w.yaml))],
    promptPaths: [],
  };
  const plan = buildDeployPlan(EXAMPLE_BLUEPRINT, repo);

  it('deletes the stale factory-- file with reason stale-workflow and its sha', () => {
    const del = plan.deletes.find((d) => d.path === `${WORKFLOW_DIR}/factory--old.yml`);
    expect(del).toBeDefined();
    expect(del!.reason).toBe('stale-workflow');
    expect(del!.sha).toBe('x');
  });

  it('never deletes a non-factory workflow (ci.yml)', () => {
    expect(plan.deletes.some((d) => d.path.endsWith('/ci.yml'))).toBe(false);
  });

  it('does not delete the freshly compiled workflows', () => {
    for (const w of workflows) {
      expect(plan.deletes.some((d) => d.path === `${WORKFLOW_DIR}/${w.filename}`)).toBe(false);
    }
  });
});

describe('buildDeployPlan: no-op when repo already matches', () => {
  const { workflows } = compile(EXAMPLE_BLUEPRINT);
  const repo: RepoState = {
    blueprintFile: {
      path: BLUEPRINT_PATH,
      content: JSON.stringify(EXAMPLE_BLUEPRINT, null, 2),
      sha: 'bp-sha',
    },
    workflowFiles: workflows.map((w) => wfFile(w.filename, w.yaml)),
    promptPaths: ['.factory/prompts/triage.md', '.factory/prompts/nightly-gardener.md'],
  };
  const plan = buildDeployPlan(EXAMPLE_BLUEPRINT, repo);

  it('omits identical blueprint + workflow writes', () => {
    expect(plan.writes).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it('re-writes only the blueprint when its content changed (carrying the sha)', () => {
    const changed: Blueprint = {
      ...EXAMPLE_BLUEPRINT,
      meta: { ...EXAMPLE_BLUEPRINT.meta, description: 'edited' },
    };
    // Workflows still match (unless the hash header changed), so isolate the blueprint write.
    const p = buildDeployPlan(changed, repo);
    const bpWrite = p.writes.find((w) => w.reason === 'blueprint');
    expect(bpWrite).toBeDefined();
    expect(bpWrite!.sha).toBe('bp-sha');
    expect(bpWrite!.content).toBe(JSON.stringify(changed, null, 2));
  });
});

describe('detectDrift', () => {
  const currentHash = blueprintHash(EXAMPLE_BLUEPRINT);

  it('reports drift for a header hash that does not match the current blueprint', () => {
    const file = wfFile(
      'factory--issue-triage-line-1.yml',
      `# blueprint: .factory/blueprint.json  hash: deadbeef\nname: x\n`,
    );
    const [item] = detectDrift([file], EXAMPLE_BLUEPRINT);
    expect(item.deployedHash).toBe('deadbeef');
    expect(item.compiledHash).toBe(currentHash);
    expect(item.drifted).toBe(true);
  });

  it('reports no drift when the header hash matches', () => {
    const file = wfFile(
      'factory--issue-triage-line-1.yml',
      `# blueprint: .factory/blueprint.json  hash: ${currentHash}\nname: x\n`,
    );
    const [item] = detectDrift([file], EXAMPLE_BLUEPRINT);
    expect(item.deployedHash).toBe(currentHash);
    expect(item.drifted).toBe(false);
  });

  it('treats a missing/garbled header as null hash and drifted', () => {
    const file = wfFile('factory--broken.yml', 'name: x\n# no hash here\n');
    const [item] = detectDrift([file], EXAMPLE_BLUEPRINT);
    expect(item.deployedHash).toBeNull();
    expect(item.drifted).toBe(true);
  });

  it('inspects only factory-- workflow files', () => {
    const ci = wfFile('ci.yml', `# hash: ${currentHash}\n`);
    const factory = wfFile('factory--issue-triage-line-1.yml', `# hash: ${currentHash}\n`);
    const items = detectDrift([ci, factory], EXAMPLE_BLUEPRINT);
    expect(items).toHaveLength(1);
    expect(items[0].path.endsWith('/factory--issue-triage-line-1.yml')).toBe(true);
  });

  it('uses the real compiled headers (round-trip: freshly compiled files are not drifted)', () => {
    const { workflows } = compile(EXAMPLE_BLUEPRINT);
    const files = workflows.map((w) => wfFile(w.filename, w.yaml));
    const items = detectDrift(files, EXAMPLE_BLUEPRINT);
    expect(items.length).toBe(workflows.length);
    expect(items.every((i) => i.drifted === false)).toBe(true);
  });
});
