// The demo client's two load-bearing promises: it satisfies the whole GithubClient
// contract, and it never goes near the network (spec FR-1, FR-3, NFR-SEC-1, AC-4, AC-6).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compile } from '../compiler/compile';
import type { GithubClient, RepoRef } from '../github/types';
import { parseRepo } from '../github/types';
import { createDemoClient, demoBlueprintFor } from './client';
import { DEMO_PRIMARY, DEMO_REPOS, DEMO_WORKFLOWS, demoWorkflows } from './fixtures';

// Pinned so every assertion below is about the fixtures, not about today (R-1).
const NOW = Date.parse('2026-08-22T09:00:00Z');
const clock = () => NOW;

const STOREFRONT = parseRepo(DEMO_PRIMARY)!;

/** Every method name on the interface, so "exercise all of them" cannot silently shrink. */
const METHODS = [
  'preflight',
  'getFile',
  'listDir',
  'putFile',
  'deleteFile',
  'getDefaultBranch',
  'createBranch',
  'createPullRequest',
  'getActionsPublicKey',
  'hasSecret',
  'putSecret',
  'listFactoryRuns',
  'listRunJobs',
  'dispatchWorkflow',
  'cancelRun',
  'listRepoWorkflows',
  'rerunRun',
  'setWorkflowEnabled',
  'createIssue',
  'listVariables',
  'getVariable',
  'setVariable',
] as const;

describe('createDemoClient — contract', () => {
  it('satisfies GithubClient structurally', () => {
    // The assignment IS the assertion: if a method is missing or mistyped, this file
    // fails to typecheck (AC-6). The runtime check guards against an `any` slipping in.
    const client: GithubClient = createDemoClient({ clock });
    for (const m of METHODS) {
      expect(typeof (client as unknown as Record<string, unknown>)[m]).toBe('function');
    }
    expect(METHODS).toHaveLength(22);
    expect(client.login).toBeTruthy();
  });
});

describe('createDemoClient — no network', () => {
  const realFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(() => {
      throw new Error('the demo client must not perform network I/O');
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('runs every method to completion with fetch booby-trapped', async () => {
    const c = createDemoClient({ clock });
    const repo: RepoRef = STOREFRONT;
    const [wf] = await c.listRepoWorkflows(repo);

    await c.preflight(repo);
    await c.getFile(repo, '.factory/blueprint.json');
    await c.listDir(repo, '.factory/prompts');
    await c.putFile(repo, 'demo.txt', 'hello', 'test');
    await c.deleteFile(repo, 'demo.txt', 'sha', 'test');
    await c.getDefaultBranch(repo);
    await c.createBranch(repo, 'factory/demo', 'main');
    await c.createPullRequest(repo, { title: 't', head: 'factory/demo', base: 'main' });
    await c.getActionsPublicKey(repo);
    await c.hasSecret(repo, 'CLAUDE_CODE_OAUTH_TOKEN');
    await c.putSecret(repo, 'ANTHROPIC_API_KEY', 'sealed', 'demo-key-1');
    const poll = await c.listFactoryRuns(repo, { pathPrefix: '.github/workflows/' });
    await c.listRunJobs(repo, poll.runs[0]!.runId);
    await c.dispatchWorkflow(repo, 'factory--content-factory.yml');
    await c.cancelRun(repo, poll.runs[0]!.runId);
    await c.rerunRun(repo, poll.runs[0]!.runId);
    await c.setWorkflowEnabled(repo, wf!.id, false);
    await c.createIssue(repo, { title: 't', body: 'b' });
    await c.listVariables(repo);
    await c.getVariable(repo, 'CONTENT_FACTORY_ENABLED');
    await c.setVariable(repo, 'CONTENT_FACTORY_ENABLED', 'false');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('createDemoClient — the write overlay', () => {
  it('reads back what it wrote (AC-4)', async () => {
    const c = createDemoClient({ clock });
    const path = '.factory/prompts/issue-triage.md';
    const before = await c.getFile(STOREFRONT, path);
    expect(before?.content).toContain('Issue triage');

    await c.putFile(STOREFRONT, path, '# Edited in the demo\n', 'docs: edit', {
      sha: before!.sha,
    });
    const after = await c.getFile(STOREFRONT, path);
    expect(after?.content).toBe('# Edited in the demo\n');
    // The sha has to move with the content or Deploy's diff would go stale.
    expect(after?.sha).not.toBe(before?.sha);
  });

  it('keeps each repo isolated and forgets nothing within a session', async () => {
    const c = createDemoClient({ clock });
    await c.setVariable(STOREFRONT, 'PERFECTION_ENABLED', 'true');
    expect((await c.getVariable(STOREFRONT, 'PERFECTION_ENABLED'))?.value).toBe('true');

    const other = parseRepo('acme/infra')!;
    expect(await c.getVariable(other, 'PERFECTION_ENABLED')).toBeNull();
  });

  it('creates a variable that did not exist', async () => {
    const c = createDemoClient({ clock });
    expect(await c.getVariable(STOREFRONT, 'NEW_SWITCH')).toBeNull();
    await c.setVariable(STOREFRONT, 'NEW_SWITCH', 'true');
    expect((await c.getVariable(STOREFRONT, 'NEW_SWITCH'))?.value).toBe('true');
  });

  it('logs what the session changed, so the banner can say where it went', async () => {
    const c = createDemoClient({ clock });
    expect(c.activity()).toEqual([]);
    await c.createIssue(STOREFRONT, { title: 'Work order: nightly is ungated', body: 'b' });
    expect(c.activity()).toHaveLength(1);
    expect(c.activity()[0]!.kind).toBe('issue');
  });

  it('a dispatch shows up as a run', async () => {
    const c = createDemoClient({ clock });
    // perPage above the fixture fleet's run count: the demo honours the cap exactly as
    // the real client does, so a page-sized window would hide the new row.
    const before = await c.listFactoryRuns(STOREFRONT, { perPage: 500 });
    await c.dispatchWorkflow(STOREFRONT, 'factory--content-factory.yml');
    const after = await c.listFactoryRuns(STOREFRONT, { perPage: 500 });
    expect(after.runs.length).toBe(before.runs.length + 1);
    expect(after.runs[0]!.status).toBe('in_progress');
  });

  it('an unknown repo reads as empty rather than throwing', async () => {
    const c = createDemoClient({ clock });
    const nowhere = parseRepo('nobody/nothing')!;
    expect(await c.listRepoWorkflows(nowhere)).toEqual([]);
    expect(await c.listDir(nowhere, '.github/workflows')).toEqual([]);
    expect(await c.getFile(nowhere, 'README.md')).toBeNull();
    expect(await c.listVariables(nowhere)).toEqual([]);
  });
});

describe('createDemoClient — the fixture fleet holds together', () => {
  it('serves compiler output, not a hand-written imitation (G2)', async () => {
    const c = createDemoClient({ clock });
    const bp = demoBlueprintFor(DEMO_PRIMARY)!;
    const expected = compile(bp, { blueprintPath: '.factory/blueprint.json' });
    expect(expected.workflows.length).toBe(3);
    for (const wf of expected.workflows) {
      const served = await c.getFile(STOREFRONT, `.github/workflows/${wf.filename}`);
      expect(served?.content).toBe(wf.yaml);
    }
  });

  it('the workflow catalogue matches the files on disk, per repo', async () => {
    // The drift guard. `DEMO_WORKFLOWS` drives the run history and the Actions catalogue
    // while the file tree drives facts/audit; if the two names diverge, Fleet Ops shows a
    // workflow with no source or a source with no telemetry. Neither is worth debugging
    // in a demo, so assert they agree.
    const c = createDemoClient({ clock });
    for (const slug of DEMO_REPOS) {
      const repo = parseRepo(slug)!;
      const onDisk = (await c.listDir(repo, '.github/workflows')).map((e) => e.name).sort();
      const catalogued = (await c.listRepoWorkflows(repo))
        .map((w) => w.path.replace('.github/workflows/', ''))
        .sort();
      expect(catalogued).toEqual(onDisk);
    }
  });

  it('every catalogued workflow has run history unless it is disabled', async () => {
    const c = createDemoClient({ clock });
    for (const slug of DEMO_REPOS) {
      const repo = parseRepo(slug)!;
      const poll = await c.listFactoryRuns(repo, {
        pathPrefix: '.github/workflows/',
        perPage: 500,
      });
      const withRuns = new Set(poll.runs.map((r) => r.path));
      for (const wf of demoWorkflows(slug)) {
        if (wf.state !== 'active') continue;
        expect(withRuns.has(wf.path), `${slug} ${wf.path} has no runs`).toBe(true);
      }
    }
  });

  it('run history is generated from the clock, never hard-dated (R-1)', async () => {
    const early = createDemoClient({ clock: () => Date.parse('2027-01-01T00:00:00Z') });
    const poll = await early.listFactoryRuns(STOREFRONT, {
      pathPrefix: '.github/workflows/',
      perPage: 500,
    });
    const newest = Date.parse(poll.runs[0]!.createdAt);
    // Newest run within a day of the injected "now"; oldest within the 14-day window.
    expect(Date.parse('2027-01-01T00:00:00Z') - newest).toBeLessThan(36 * 60 * 60 * 1000);
    const oldest = Date.parse(poll.runs[poll.runs.length - 1]!.createdAt);
    expect(Date.parse('2027-01-01T00:00:00Z') - oldest).toBeLessThan(15 * 24 * 60 * 60 * 1000);
  });

  it('carries a re-run so the rework metric is exercised', async () => {
    const c = createDemoClient({ clock });
    const poll = await c.listFactoryRuns(STOREFRONT, {
      pathPrefix: '.github/workflows/',
      perPage: 500,
    });
    expect(poll.runs.some((r) => r.runAttempt > 1)).toBe(true);
  });

  it('carries both failures and successes, so the boards are not all green', async () => {
    const c = createDemoClient({ clock });
    const poll = await c.listFactoryRuns(STOREFRONT, {
      pathPrefix: '.github/workflows/',
      perPage: 500,
    });
    expect(poll.runs.some((r) => r.conclusion === 'failure')).toBe(true);
    expect(poll.runs.some((r) => r.conclusion === 'success')).toBe(true);
  });

  it('spans three repos with a disabled workflow among them', () => {
    expect(DEMO_REPOS).toHaveLength(3);
    expect(DEMO_WORKFLOWS.some((w) => w.state === 'disabled_manually')).toBe(true);
  });
});
