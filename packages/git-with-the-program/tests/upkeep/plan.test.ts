// Implements tests for: docs/spec/06-upkeep.md §2 (desired state per facet) and §3 (the plan),
// above all the CONVERGENCE contract: apply a plan, observe again, and the next plan carries no
// remote actions (src/upkeep/plan.ts header, rules 1-3).

import { describe, expect, it } from 'vitest';

import { normalizeDescription, normalizeTopic, planUpkeep, renderChangelog } from '../../src/upkeep/plan.js';
import type { HostFacts, UpkeepPlan } from '../../src/upkeep/types.js';
import { SHA, config, hostFacts, localFacts, planInput } from './fixtures.js';

const ids = (p: UpkeepPlan): string[] => p.findings.map((f) => f.id);

describe('a repository that matches its config', () => {
  it('produces no findings, actions or content', () => {
    const plan = planUpkeep(planInput());
    expect(plan.findings).toEqual([]);
    expect(plan.actions).toEqual([]);
    expect(plan.content).toEqual([]);
  });

  it('is deterministic: same input, same plan', () => {
    const input = planInput({ host: hostFacts({ description: null, topics: [] }) });
    expect(JSON.stringify(planUpkeep(input))).toBe(JSON.stringify(planUpkeep(input)));
  });
});

describe('metadata', () => {
  it('derives the description from the configured source and sets it when it drifted', () => {
    const plan = planUpkeep(
      planInput({ config: config({ metadata: { ...config().metadata, description: { from: 'readme' } } }) }),
    );
    const a = plan.actions.find((x) => x.kind === 'repo.update');
    expect(a).toMatchObject({ kind: 'repo.update', description: 'A demo project.' });
    expect(plan.findings.find((f) => f.id === 'metadata.description')?.actions).toEqual([a!.id]);
  });

  it('an `ai` description is requested ONLY when the forge has none (no weekly rewrites)', () => {
    const ai = config({ metadata: { ...config().metadata, description: { from: 'ai' } } });
    expect(planUpkeep(planInput({ config: ai })).content).toEqual([]);

    const empty = planUpkeep(planInput({ config: ai, host: hostFacts({ description: null }) }));
    expect(empty.content).toHaveLength(1);
    expect(empty.content[0]).toMatchObject({ kind: 'description', status: 'requested', fallback: 'A demo project.' });
    expect(empty.actions[0]).toMatchObject({ kind: 'repo.update', content: empty.content[0]!.id });
  });

  it('normalizes: markdown stripped, one line, ≤ 350 characters cut at a word', () => {
    expect(normalizeDescription('**Bold** and `code` [link](http://x)')).toBe('Bold and code link');
    const long = normalizeDescription(`${'word '.repeat(100)}end`);
    expect(long.length).toBeLessThanOrEqual(350);
    expect(long.endsWith('…')).toBe(true);
  });

  it('topics: merge mode adds without removing; exact mode removes too', () => {
    const t = { include: ['governance'], from_package_keywords: true, mode: 'merge' as const, min: 0 };
    const host = hostFacts({ topics: ['human-added'] });
    const merge = planUpkeep(planInput({ host, config: config({ metadata: { ...config().metadata, topics: t } }) }));
    expect(merge.actions[0]).toMatchObject({ kind: 'repo.topics', names: ['demo-tool', 'git', 'governance', 'human-added'] });

    const exact = planUpkeep(planInput({ host, config: config({ metadata: { ...config().metadata, topics: { ...t, mode: 'exact' } } }) }));
    expect(exact.actions[0]).toMatchObject({ kind: 'repo.topics', names: ['demo-tool', 'git', 'governance'] });
  });

  it('topics below `min` request an AI top-up with an empty fallback', () => {
    const t = { include: [], from_package_keywords: true, mode: 'merge' as const, min: 5 };
    const plan = planUpkeep(planInput({ config: config({ metadata: { ...config().metadata, topics: t } }) }));
    expect(plan.content[0]).toMatchObject({ kind: 'topics', fallback: [] });
    expect((plan.content[0]!.brief.context as { need: number }).need).toBe(3);
  });

  it('normalizeTopic makes keywords GitHub-valid or drops them', () => {
    expect(normalizeTopic('Demo Tool')).toBe('demo-tool');
    expect(normalizeTopic('C++')).toBe('c');
    expect(normalizeTopic('!!!')).toBeNull();
  });

  it('a declared license with no LICENSE file is in-tree drift, never an action', () => {
    const plan = planUpkeep(planInput({ local: localFacts({ license_file: null }) }));
    const f = plan.findings.find((x) => x.id === 'metadata.license-file');
    expect(f).toMatchObject({ where: 'in-tree', actions: [] });
    expect(plan.actions).toEqual([]);
  });
});

describe('versioning', () => {
  it('an untagged version is tagged where it was introduced, and its release depends on the tag', () => {
    const local = localFacts({
      version: { source: { path: 'package.json', value: '1.1.0', line: 3 }, others: [], introduced_at: SHA('b') },
      history: [
        ...localFacts().history,
        { tag: 'v1.1.0', sha: SHA('b'), previous: 'v1.0.0', pending: true, commits: [{ sha: SHA('b'), subject: 'feat: more', breaking: false }], areas: {} },
      ],
    });
    const plan = planUpkeep(planInput({ local }));
    const tag = plan.actions.find((a) => a.kind === 'tag.create');
    const rel = plan.actions.find((a) => a.kind === 'release.create');
    expect(tag).toMatchObject({ tag: 'v1.1.0', sha: SHA('b') });
    expect(rel).toMatchObject({ tag: 'v1.1.0', make_latest: true, depends_on: [tag!.id] });
  });

  it('a version not newer than the latest tag is an in-tree error, and nothing is tagged', () => {
    const local = localFacts({
      version: { source: { path: 'package.json', value: '0.9.0', line: 3 }, others: [], introduced_at: SHA('b') },
    });
    const plan = planUpkeep(planInput({ local }));
    expect(plan.findings.find((f) => f.id === 'versioning.behind')).toMatchObject({ severity: 'error', where: 'in-tree' });
    expect(plan.actions.filter((a) => a.kind === 'tag.create')).toEqual([]);
  });

  it('files that disagree with the source of truth are cited', () => {
    const local = localFacts({
      version: {
        source: { path: 'package.json', value: '1.0.0', line: 3 },
        others: [{ path: 'src/cli/index.ts', value: '0.9.0', line: 14 }],
        introduced_at: null,
      },
    });
    const f = planUpkeep(planInput({ local })).findings.find((x) => x.id === 'versioning.consistency:src/cli/index.ts');
    expect(f).toMatchObject({ citation: { path: 'src/cli/index.ts', line: 14 }, expected: '1.0.0', actual: '0.9.0' });
  });

  it('unreleased commits become a bump SUGGESTION (in-tree), never an action', () => {
    const local = localFacts({ unreleased: [{ sha: SHA('c'), subject: 'feat: new thing', breaking: false }] });
    const plan = planUpkeep(planInput({ local }));
    const f = plan.findings.find((x) => x.id === 'versioning.unreleased');
    expect(f).toMatchObject({ where: 'in-tree', expected: '1.1.0', actual: '1.0.0' });
    expect(plan.actions).toEqual([]);
  });
});

describe('releases', () => {
  it('a tag without a release gets one; an empty body gets notes; drafts are left alone', () => {
    const local = localFacts({
      tags: [{ name: 'v1.0.0', sha: SHA('a') }, { name: 'v1.1.0', sha: SHA('b') }, { name: 'v1.2.0', sha: SHA('c') }],
      version: { source: { path: 'package.json', value: '1.2.0', line: 3 }, others: [], introduced_at: null },
      history: ['v1.0.0', 'v1.1.0', 'v1.2.0'].map((tag, i, all) => ({
        tag, sha: SHA('abc'[i]!), previous: i === 0 ? null : all[i - 1]!, pending: false, commits: [], areas: {},
      })),
    });
    const host = hostFacts({
      releases: [
        { id: 1, tag: 'v1.0.0', name: null, body_empty: true, draft: true, prerelease: false },
        { id: 2, tag: 'v1.1.0', name: null, body_empty: true, draft: false, prerelease: false },
      ],
    });
    const plan = planUpkeep(planInput({ local, host }));
    expect(plan.actions.map((a) => [a.kind, 'tag' in a ? a.tag : ''])).toEqual([
      ['release.update', 'v1.1.0'],
      ['release.create', 'v1.2.0'],
    ]);
  });

  it('`notes: ai` requests a summary per release; the changelog stays deterministic', () => {
    const local = localFacts({ tags: [{ name: 'v1.0.0', sha: SHA('a') }] });
    const plan = planUpkeep(planInput({ local, host: hostFacts({ releases: [] }), config: config({ releases: { backfill: 3, notes: 'ai' } }) }));
    const rel = plan.actions.find((a) => a.kind === 'release.create')!;
    expect(rel.content).toBe(plan.content[0]!.id);
    expect(plan.content[0]).toMatchObject({ kind: 'release-notes', fallback: '' });
  });

  it('the changelog is identity-free and skips merges', () => {
    const md = renderChangelog({
      tag: 'v2.0.0', sha: SHA('b'), previous: 'v1.0.0', pending: false, areas: {},
      commits: [
        { sha: SHA('1'), subject: 'Merge pull request #3 from someone/branch', breaking: false },
        { sha: SHA('2'), subject: 'feat: x (#3)', breaking: false },
      ],
    });
    expect(md).toBe('### Changes since v1.0.0\n\n- feat: x (#3) (2222222)');
  });
});

describe('labels', () => {
  const codeLabels = [{ name: 'gwtp-proposal', color: '5319e7', description: 'Filed by GWTP' }];

  it('labels the engine files with must exist; existing ones from code are not restyled', () => {
    const cfg = config({ labels: { declared: [], from_code: true } });
    const missing = planUpkeep(planInput({ config: cfg, codeLabels }));
    expect(missing.actions[0]).toMatchObject({ kind: 'label.upsert', name: 'gwtp-proposal', exists: false });

    const present = planUpkeep(planInput({ config: cfg, codeLabels, host: hostFacts({ labels: [{ name: 'GWTP-Proposal', color: 'ffffff', description: null }] }) }));
    expect(present.actions).toEqual([]);
  });

  it('declared labels are kept in their declared colour and description', () => {
    const cfg = config({ labels: { declared: [{ name: 'upkeep', color: '0e8a16', description: 'Upkeep' }], from_code: false } });
    const plan = planUpkeep(planInput({ config: cfg, host: hostFacts({ labels: [{ name: 'upkeep', color: 'ffffff', description: 'Upkeep' }] }) }));
    expect(plan.actions[0]).toMatchObject({ kind: 'label.upsert', exists: true, color: '0e8a16' });
  });

  it('never plans a deletion: undeclared host labels are invisible to the plan', () => {
    const plan = planUpkeep(planInput({ host: hostFacts({ labels: [{ name: 'random', color: '000000', description: null }] }) }));
    expect(plan.actions).toEqual([]);
  });
});

describe('references', () => {
  it('missing mentions are in-tree findings that name each mention', () => {
    const local = localFacts({
      references: [{ id: 'cli', doc: 'CLAUDE.md', doc_exists: true, items: ['a', 'b'], mention: 'gwtp {item}', missing: ['b'] }],
    });
    const f = planUpkeep(planInput({ local })).findings[0]!;
    expect(f).toMatchObject({ id: 'references.cli', where: 'in-tree' });
    expect(f.summary).toContain('`gwtp b`');
  });
});

describe('no forge', () => {
  it('reports remote facets as UNOBSERVED and plans no remote action', () => {
    const local = localFacts({ license_file: null, version: { source: { path: 'package.json', value: '2.0.0', line: 3 }, others: [], introduced_at: SHA('d') } });
    const plan = planUpkeep(planInput({ host: null, hostError: 'offline', local }));
    expect(plan.observed.host).toBeNull();
    expect(plan.observed.host_error).toBe('offline');
    expect(ids(plan)).toContain('host.unobserved');
    expect(ids(plan)).toContain('metadata.license-file');
    // The tag action is planned (it is derivable from history alone); apply skips it without a forge.
    expect(plan.actions.map((a) => a.kind)).toEqual(['tag.create']);
  });
});

describe('convergence', () => {
  it('applying a plan and observing again yields no remote actions', () => {
    const cfg = config({
      metadata: { description: { from: 'readme' }, topics: { include: ['governance'], from_package_keywords: true, mode: 'merge', min: 0 }, license_file: true },
      labels: { declared: [{ name: 'upkeep', color: '0e8a16', description: 'Upkeep' }], from_code: false },
    });
    const host0 = hostFacts({ description: null, topics: [], labels: [] });
    const first = planUpkeep(planInput({ config: cfg, host: host0 }));
    expect(first.actions.length).toBeGreaterThan(0);

    // What the forge looks like after `apply` ran every action.
    let host1: HostFacts = host0;
    for (const a of first.actions) {
      if (a.kind === 'repo.update' && typeof a.description === 'string') host1 = { ...host1, description: a.description };
      if (a.kind === 'repo.topics') host1 = { ...host1, topics: [...a.names] };
      if (a.kind === 'label.upsert') host1 = { ...host1, labels: [...host1.labels, { name: a.name, color: a.color, description: a.description }] };
    }
    const second = planUpkeep(planInput({ config: cfg, host: host1 }));
    expect(second.actions).toEqual([]);
    expect(second.findings.filter((f) => f.where === 'remote')).toEqual([]);
  });
});
