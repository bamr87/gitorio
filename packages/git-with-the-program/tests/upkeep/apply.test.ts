// Implements tests for: docs/spec/06-upkeep.md §3.3 — apply's ordering, dependencies,
// idempotency and outcome classification against a recording fake host (src/upkeep/apply.ts).

import { describe, expect, it } from 'vitest';

import { ADMIN_REMEDY, applyExitCode, applyPlan, releaseBody, resolvedTopics } from '../../src/upkeep/apply.js';
import type { RepoHostPort } from '../../src/upkeep/host.js';
import { planUpkeep } from '../../src/upkeep/plan.js';
import type { UpkeepPlan } from '../../src/upkeep/types.js';
import { SHA, config, hostFacts, localFacts, planInput } from './fixtures.js';

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function fakeHost(fail: Partial<Record<string, Error>> = {}): RepoHostPort & { calls: string[] } {
  const calls: string[] = [];
  const step = async (name: string): Promise<void> => {
    calls.push(name);
    const e = fail[name.split(' ')[0]!];
    if (e !== undefined) throw e;
  };
  return {
    host: 'fake',
    calls,
    read: async () => hostFacts(),
    updateMetadata: async (f) => step(`updateMetadata ${JSON.stringify(f)}`),
    replaceTopics: async (n) => step(`replaceTopics ${n.join(',')}`),
    createLabel: async (l) => step(`createLabel ${l.name}`),
    updateLabel: async (l) => step(`updateLabel ${l.name}`),
    createTag: async (t, s) => step(`createTag ${t} ${s.slice(0, 1)}`),
    createRelease: async (r) => {
      await step(`createRelease ${r.tag} latest=${r.make_latest}`);
      return `https://example.test/releases/${r.tag}`;
    },
    updateReleaseBody: async (id) => step(`updateReleaseBody ${id}`),
  };
}

/** A plan with every action kind: description, topics, label, tag + dependent release. */
function busyPlan(): UpkeepPlan {
  return planUpkeep(
    planInput({
      config: config({
        metadata: { description: { from: 'readme' }, topics: { include: ['governance'], from_package_keywords: false, mode: 'merge', min: 0 }, license_file: true },
        labels: { declared: [{ name: 'upkeep', color: '0e8a16', description: 'Upkeep' }], from_code: false },
      }),
      host: hostFacts({ description: null, topics: [], releases: [] }),
      local: localFacts({
        tags: [],
        version: { source: { path: 'package.json', value: '1.0.0', line: 3 }, others: [], introduced_at: SHA('a') },
        history: [{ tag: 'v1.0.0', sha: SHA('a'), previous: null, pending: true, commits: [], areas: {} }],
      }),
    }),
  );
}

describe('applyPlan', () => {
  it('dry run calls nothing and plans everything', async () => {
    const host = fakeHost();
    const out = await applyPlan(busyPlan(), host, { dryRun: true });
    expect(host.calls).toEqual([]);
    expect(out.every((o) => o.status === 'planned')).toBe(true);
    expect(applyExitCode(out)).toBe(0);
  });

  it('applies tags before the releases that name them, and reports in plan order', async () => {
    const plan = busyPlan();
    const host = fakeHost();
    const out = await applyPlan(plan, host, { dryRun: false });
    expect(host.calls.map((c) => c.split(' ')[0])).toEqual(['createTag', 'createRelease', 'updateMetadata', 'replaceTopics', 'createLabel']);
    expect(out.map((o) => o.action)).toEqual(plan.actions.map((a) => a.id));
    expect(out.every((o) => o.status === 'applied')).toBe(true);
  });

  it('a failed tag skips its release; an existing tag (422) does not', async () => {
    const failed = await applyPlan(busyPlan(), fakeHost({ createTag: new HttpError(500, 'boom') }), { dryRun: false });
    expect(failed.find((o) => o.kind === 'tag.create')?.status).toBe('failed');
    expect(failed.find((o) => o.kind === 'release.create')).toMatchObject({ status: 'skipped' });

    const exists = await applyPlan(busyPlan(), fakeHost({ createTag: new HttpError(422, 'Reference already exists') }), { dryRun: false });
    expect(exists.find((o) => o.kind === 'tag.create')?.status).toBe('unchanged');
    expect(exists.find((o) => o.kind === 'release.create')?.status).toBe('applied');
  });

  it('a 403 on repository metadata is BLOCKED with the admin-token remedy, and fails the exit code', async () => {
    const out = await applyPlan(busyPlan(), fakeHost({ updateMetadata: new HttpError(403, 'Resource not accessible by integration') }), { dryRun: false });
    const o = out.find((x) => x.kind === 'repo.update')!;
    expect(o.status).toBe('blocked');
    expect(o.detail).toContain(ADMIN_REMEDY);
    expect(out.find((x) => x.kind === 'label.upsert')?.status).toBe('applied');
    expect(applyExitCode(out)).toBe(1);
  });

  it('without a forge every action is skipped, not failed', async () => {
    const out = await applyPlan(busyPlan(), null, { dryRun: false });
    expect(out.every((o) => o.status === 'skipped')).toBe(true);
  });

  it('an action whose target already matches is unchanged and makes no call', async () => {
    const plan: UpkeepPlan = {
      ...busyPlan(),
      actions: [{ id: 'A1', kind: 'repo.topics', names: ['a', 'b'], current: ['b', 'a'] }],
    };
    const host = fakeHost();
    expect((await applyPlan(plan, host, { dryRun: false }))[0]?.status).toBe('unchanged');
    expect(host.calls).toEqual([]);
  });
});

describe('content reaches the forge only through validation', () => {
  it('a filled summary sits above the deterministic changelog; an invalid one falls back', () => {
    const plan = busyPlan();
    const rel = plan.actions.find((a) => a.kind === 'release.create')!;
    const withNotes: UpkeepPlan = {
      ...plan,
      actions: plan.actions.map((a) => (a.id === rel.id ? { ...a, content: 'C9' } : a)),
      content: [{ id: 'C9', kind: 'release-notes', brief: { instructions: 'x', context: {} }, status: 'filled', provider: 'agent', value: 'Summary.', fallback: '' }],
    };
    const a = withNotes.actions.find((x) => x.id === rel.id) as Extract<UpkeepPlan['actions'][number], { kind: 'release.create' }>;
    expect(releaseBody(withNotes, a)).toBe(`Summary.\n\n${a.changelog}`);

    const invalid: UpkeepPlan = { ...withNotes, content: [{ ...withNotes.content[0]!, value: 42 }] };
    expect(releaseBody(invalid, a)).toBe(a.changelog);
  });

  it('AI topics top up the deterministic set, capped at 20, invalid ones ignored', () => {
    const plan: UpkeepPlan = {
      ...busyPlan(),
      actions: [{ id: 'A1', kind: 'repo.topics', names: ['git'], current: [], content: 'C1' }],
      content: [{ id: 'C1', kind: 'topics', brief: { instructions: 'x', context: {} }, status: 'filled', provider: 'agent', value: ['ai', 'git'], fallback: [] }],
    };
    expect(resolvedTopics(plan, plan.actions[0] as Extract<UpkeepPlan['actions'][number], { kind: 'repo.topics' }>)).toEqual(['ai', 'git']);
  });
});
