// Implements tests for: docs/spec/06-upkeep.md §1.2 — the GitHub RepoHostPort
// (src/adapters/github/repo-host.ts) against a fake transport: no network, no process.

import { describe, expect, it } from 'vitest';

import type { HttpRequest, HttpResponse } from '../../src/adapters/github/issues.js';
import { proposalLabels } from '../../src/adapters/github/render.js';
import {
  decodeRelease,
  engineLabels,
  githubRepoHost,
  resolveRepository,
  slugFromRemoteUrl,
} from '../../src/adapters/github/repo-host.js';

function fakeTransport(routes: Record<string, unknown>): { calls: HttpRequest[]; transport: (r: HttpRequest) => Promise<HttpResponse> } {
  const calls: HttpRequest[] = [];
  return {
    calls,
    transport: async (req) => {
      calls.push(req);
      const key = `${req.method} ${req.path}${req.query?.['page'] !== undefined ? `#${req.query['page']}` : ''}`;
      return { status: 200, body: routes[key] ?? routes[`${req.method} ${req.path}`] ?? null };
    },
  };
}

describe('repository coordinates', () => {
  it.each([
    ['https://github.com/bamr87/git-with-the-program', 'bamr87/git-with-the-program'],
    ['https://github.com/o/n.git', 'o/n'],
    ['git@github.com:o/n.git', 'o/n'],
    ['ssh://git@github.com/o/n', 'o/n'],
    ['https://gitlab.com/o/n', null],
  ])('%s → %s', (url, slug) => {
    expect(slugFromRemoteUrl(url)).toBe(slug);
  });

  it('resolveRepository prefers explicit, then the Actions env, then the remote', () => {
    expect(resolveRepository({ explicit: 'a/b', env: 'c/d', remoteUrl: 'https://github.com/e/f' })).toEqual({ owner: 'a', name: 'b' });
    expect(resolveRepository({ env: 'c/d', remoteUrl: 'https://github.com/e/f' })).toEqual({ owner: 'c', name: 'd' });
    expect(resolveRepository({ remoteUrl: 'https://github.com/e/f' })).toEqual({ owner: 'e', name: 'f' });
    expect(resolveRepository({})).toBeNull();
  });
});

describe('engineLabels', () => {
  it('is exactly the set the delivery adapter stamps on proposals', () => {
    const expected = new Set([...proposalLabels('refactor'), ...proposalLabels('reprogram')]);
    expect(new Set(engineLabels().map((l) => l.name))).toEqual(expected);
    for (const l of engineLabels()) expect(l.color).toMatch(/^[0-9a-f]{6}$/);
  });
});

describe('githubRepoHost', () => {
  it('reads metadata, paginated releases and labels', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i, tag_name: `v0.0.${i}`, body: 'x' }));
    const { transport, calls } = fakeTransport({
      'GET repos/o/n': { description: 'D', homepage: '', topics: ['a'], default_branch: 'main', license: { spdx_id: 'MIT' } },
      'GET repos/o/n/releases#1': page1,
      'GET repos/o/n/releases#2': [{ id: 100, tag_name: 'v1.0.0', body: '', draft: false, prerelease: false }],
      'GET repos/o/n/labels#1': [{ name: 'bug', color: 'd73a4a', description: null }],
    });
    const facts = await githubRepoHost({ owner: 'o', name: 'n' }, transport).read();
    expect(facts).toMatchObject({ description: 'D', homepage: null, topics: ['a'], license: 'MIT' });
    expect(facts.releases).toHaveLength(101);
    expect(facts.releases.at(-1)).toMatchObject({ tag: 'v1.0.0', body_empty: true });
    expect(facts.labels).toEqual([{ name: 'bug', color: 'd73a4a', description: null }]);
    expect(calls.filter((c) => c.path === 'repos/o/n/releases')).toHaveLength(2);
  });

  it('writes through the documented routes', async () => {
    const { transport, calls } = fakeTransport({ 'POST repos/o/n/releases': { html_url: 'https://x/r' } });
    const host = githubRepoHost({ owner: 'o', name: 'n' }, transport);
    await host.createTag('v1.0.0', 'a'.repeat(40));
    expect(await host.createRelease({ tag: 'v1.0.0', name: 'v1.0.0', body: 'b', prerelease: false, make_latest: true })).toBe('https://x/r');
    await host.updateLabel({ name: 'gwtp:refactor', color: '1d76db', description: 'd' });
    await host.replaceTopics(['a', 'b']);
    await host.updateMetadata({ description: 'D' });
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ['POST', 'repos/o/n/git/refs'],
      ['POST', 'repos/o/n/releases'],
      ['PATCH', 'repos/o/n/labels/gwtp%3Arefactor'],
      ['PUT', 'repos/o/n/topics'],
      ['PATCH', 'repos/o/n'],
    ]);
    expect(calls[0]!.body).toEqual({ ref: 'refs/tags/v1.0.0', sha: 'a'.repeat(40) });
    expect(calls[1]!.body).toMatchObject({ make_latest: 'true', draft: false });
  });

  it('has no delete capability at all', () => {
    const host = githubRepoHost({ owner: 'o', name: 'n' }, fakeTransport({}).transport);
    expect(Object.keys(host).filter((k) => /delete|remove/i.test(k))).toEqual([]);
  });

  it('decodeRelease rejects payloads without id or tag', () => {
    expect(decodeRelease({ tag_name: 'v1' })).toBeNull();
    expect(decodeRelease({ id: 1, tag_name: 'v1', body: null })).toMatchObject({ body_empty: true });
  });
});
