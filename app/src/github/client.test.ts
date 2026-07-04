import { describe, expect, it, vi } from 'vitest';
import { connectWithPat } from './client';
import { GithubError } from './types';
import type { RepoRef } from './types';

const REPO: RepoRef = { owner: 'o', repo: 'r' };

// UTF-8-safe base64 mirroring the client's encode idiom — used to build fixture bodies
// and to decode request bodies back for assertions.
function b64utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function fromB64utf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

type Handler = (url: string, init: RequestInit) => Response;

/** Build a fetch stub that auto-answers GET /user, then delegates everything else to `handler`. */
function stubFetch(handler: Handler) {
  return vi.fn(async (url: string, init: RequestInit) => {
    if (url === 'https://api.github.com/user') {
      return new Response(JSON.stringify({ login: 'octocat' }), { status: 200 });
    }
    return handler(url, init);
  });
}

/** Connect a client whose non-/user calls are served by `handler`. */
async function connect(handler: Handler) {
  const fetchImpl = stubFetch(handler);
  const client = await connectWithPat('tok', { fetchImpl: fetchImpl as unknown as typeof fetch });
  return { client, fetchImpl };
}

/** The first recorded fetch call whose URL matches `pred`, as [url, init]. */
function callMatching(fetchImpl: ReturnType<typeof stubFetch>, pred: (url: string) => boolean) {
  const call = fetchImpl.mock.calls.find(([u]) => pred(u as string));
  if (!call) throw new Error('no matching fetch call');
  return call as unknown as [string, RequestInit];
}

const jsonBody = (init: RequestInit) => JSON.parse(init.body as string);
const headerOf = (init: RequestInit, name: string) =>
  (init.headers as Record<string, string>)[name];

describe('connectWithPat', () => {
  it('resolves login from GET /user with the right headers', async () => {
    const fetchImpl = stubFetch(() => new Response('{}', { status: 200 }));
    const client = await connectWithPat('tok', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(client.login).toBe('octocat');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/user');
    expect(init.method).toBe('GET');
    expect(headerOf(init, 'Authorization')).toBe('Bearer tok');
    expect(headerOf(init, 'Accept')).toBe('application/vnd.github+json');
    expect(headerOf(init, 'X-GitHub-Api-Version')).toBe('2022-11-28');
  });

  it('throws GithubError with status 401 on a bad token', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }),
    );
    await expect(
      connectWithPat('bad', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ name: 'GithubError', status: 401 });
  });

  it('surfaces the error instance as a GithubError', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(
      connectWithPat('bad', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(GithubError);
  });
});

describe('getFile', () => {
  it('decodes UTF-8 base64 content (stripping newlines) and returns path/content/sha', async () => {
    const text = 'héllo 🚀 world';
    const raw = b64utf8(text);
    const wrapped = `${raw.slice(0, 4)}\n${raw.slice(4)}`; // Contents API wraps base64 in newlines
    const { client, fetchImpl } = await connect(
      () => new Response(JSON.stringify({ content: wrapped, sha: 'deadbeef' }), { status: 200 }),
    );

    const file = await client.getFile(REPO, '.factory/blueprint.json', 'main');
    expect(file).toEqual({ path: '.factory/blueprint.json', content: text, sha: 'deadbeef' });

    const [url, init] = callMatching(fetchImpl, (u) => u.includes('/contents/'));
    expect(url).toBe(
      'https://api.github.com/repos/o/r/contents/.factory/blueprint.json?ref=main',
    );
    expect(init.method).toBe('GET');
  });

  it('returns null on 404', async () => {
    const { client } = await connect(
      () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
    );
    expect(await client.getFile(REPO, 'missing.txt')).toBeNull();
  });
});

describe('listDir', () => {
  it('maps a directory listing and returns [] on 404', async () => {
    const { client } = await connect((url) => {
      if (url.includes('/contents/present')) {
        return new Response(
          JSON.stringify([
            { path: 'present/a.md', name: 'a.md', sha: 's1', type: 'file' },
            { path: 'present/sub', name: 'sub', sha: 's2', type: 'dir' },
          ]),
          { status: 200 },
        );
      }
      return new Response('{"message":"Not Found"}', { status: 404 });
    });

    expect(await client.listDir(REPO, 'present')).toEqual([
      { path: 'present/a.md', name: 'a.md', sha: 's1', type: 'file' },
      { path: 'present/sub', name: 'sub', sha: 's2', type: 'dir' },
    ]);
    expect(await client.listDir(REPO, 'gone')).toEqual([]);
  });
});

describe('putFile', () => {
  it('PUTs UTF-8-safe base64 content and forwards sha + branch', async () => {
    const { client, fetchImpl } = await connect(() => new Response('{}', { status: 201 }));
    const text = 'héllo 🚀';
    await client.putFile(REPO, 'a/b.md', text, 'commit msg', { sha: 'oldsha', branch: 'feat' });

    const [url, init] = callMatching(fetchImpl, (u) => u.includes('/contents/'));
    expect(url).toBe('https://api.github.com/repos/o/r/contents/a/b.md');
    expect(init.method).toBe('PUT');
    expect(headerOf(init, 'Content-Type')).toBe('application/json');

    const body = jsonBody(init);
    expect(body.message).toBe('commit msg');
    expect(body.sha).toBe('oldsha');
    expect(body.branch).toBe('feat');
    expect(fromB64utf8(body.content)).toBe(text);
  });

  it('omits sha and branch when not provided (create)', async () => {
    const { client, fetchImpl } = await connect(() => new Response('{}', { status: 201 }));
    await client.putFile(REPO, 'new.md', 'hi', 'create');

    const [, init] = callMatching(fetchImpl, (u) => u.includes('/contents/'));
    const body = jsonBody(init);
    expect(body.sha).toBeUndefined();
    expect(body.branch).toBeUndefined();
    expect(fromB64utf8(body.content)).toBe('hi');
  });
});

describe('deleteFile', () => {
  it('DELETEs with message, sha and branch', async () => {
    const { client, fetchImpl } = await connect(() => new Response('{}', { status: 200 }));
    await client.deleteFile(REPO, 'x.md', 'sha1', 'remove', { branch: 'main' });

    const [url, init] = callMatching(fetchImpl, (u) => u.includes('/contents/'));
    expect(url).toBe('https://api.github.com/repos/o/r/contents/x.md');
    expect(init.method).toBe('DELETE');
    expect(jsonBody(init)).toEqual({ message: 'remove', sha: 'sha1', branch: 'main' });
  });
});

describe('createBranch / createPullRequest', () => {
  it('reads the source ref sha then POSTs a new ref', async () => {
    const { client, fetchImpl } = await connect((url) => {
      if (url.includes('/git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: 'basesha' } }), { status: 200 });
      }
      return new Response('{}', { status: 201 });
    });
    await client.createBranch(REPO, 'factory/deploy', 'main');

    const [url, init] = callMatching(fetchImpl, (u) => u.endsWith('/git/refs'));
    expect(url).toBe('https://api.github.com/repos/o/r/git/refs');
    expect(init.method).toBe('POST');
    expect(jsonBody(init)).toEqual({ ref: 'refs/heads/factory/deploy', sha: 'basesha' });
  });

  it('returns the html_url from an opened PR', async () => {
    const { client, fetchImpl } = await connect(
      () =>
        new Response(JSON.stringify({ html_url: 'https://github.com/o/r/pull/7' }), {
          status: 201,
        }),
    );
    const url = await client.createPullRequest(REPO, {
      title: 'Deploy',
      head: 'factory/deploy',
      base: 'main',
      body: 'auto',
    });
    expect(url).toBe('https://github.com/o/r/pull/7');

    const [, init] = callMatching(fetchImpl, (u) => u.endsWith('/pulls'));
    expect(jsonBody(init)).toEqual({
      title: 'Deploy',
      head: 'factory/deploy',
      base: 'main',
      body: 'auto',
    });
  });
});

describe('secrets', () => {
  it('getActionsPublicKey maps key_id → keyId', async () => {
    const { client } = await connect(
      () => new Response(JSON.stringify({ key: 'PUBKEY', key_id: '123456' }), { status: 200 }),
    );
    expect(await client.getActionsPublicKey(REPO)).toEqual({ key: 'PUBKEY', keyId: '123456' });
  });

  it('hasSecret is true on 200 and false on 404', async () => {
    const present = await connect(() => new Response('{}', { status: 200 }));
    expect(await present.client.hasSecret(REPO, 'ANTHROPIC_API_KEY')).toBe(true);

    const absent = await connect(
      () => new Response('{"message":"Not Found"}', { status: 404 }),
    );
    expect(await absent.client.hasSecret(REPO, 'ANTHROPIC_API_KEY')).toBe(false);
  });

  it('putSecret PUTs encrypted_value + key_id to the named secret', async () => {
    const { client, fetchImpl } = await connect(() => new Response('', { status: 201 }));
    await client.putSecret(REPO, 'ANTHROPIC_API_KEY', 'ENCRYPTED', 'KID');

    const [url, init] = callMatching(fetchImpl, (u) => u.includes('/actions/secrets/'));
    expect(url).toBe('https://api.github.com/repos/o/r/actions/secrets/ANTHROPIC_API_KEY');
    expect(init.method).toBe('PUT');
    expect(jsonBody(init)).toEqual({ encrypted_value: 'ENCRYPTED', key_id: 'KID' });
  });
});

describe('preflight', () => {
  it('maps push → contents/workflows ok and a 403 probe → missing, without throwing', async () => {
    const { client } = await connect((url) => {
      if (url === 'https://api.github.com/repos/o/r') {
        return new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 });
      }
      if (url.endsWith('/actions/permissions')) {
        return new Response('{}', { status: 200 }); // actions readable → ok
      }
      if (url.endsWith('/actions/secrets/public-key')) {
        return new Response('forbidden', { status: 403 }); // secrets → missing
      }
      return new Response('nope', { status: 404 });
    });

    const pf = await client.preflight(REPO);
    expect(pf).toEqual({
      repo: REPO,
      contents: 'ok',
      workflows: 'ok',
      issues: 'ok',
      pullRequests: 'ok',
      actions: 'ok',
      secrets: 'missing',
      canDeploy: true,
    });
  });

  it('reports contents missing (canDeploy false) when push is absent', async () => {
    const { client } = await connect((url) => {
      if (url === 'https://api.github.com/repos/o/r') {
        return new Response(JSON.stringify({ permissions: { push: false } }), { status: 200 });
      }
      // unexpected probe status → unknown, still no throw
      return new Response('teapot', { status: 418 });
    });

    const pf = await client.preflight(REPO);
    expect(pf.contents).toBe('missing');
    expect(pf.workflows).toBe('missing');
    expect(pf.issues).toBe('unknown');
    expect(pf.pullRequests).toBe('unknown');
    expect(pf.actions).toBe('unknown');
    expect(pf.secrets).toBe('unknown');
    expect(pf.canDeploy).toBe(false);
  });

  it('returns an all-missing/unknown Preflight when the repo is inaccessible (404), not throwing', async () => {
    const { client } = await connect(() => new Response('{"message":"Not Found"}', { status: 404 }));
    const pf = await client.preflight(REPO);
    expect(pf).toEqual({
      repo: REPO,
      contents: 'missing',
      workflows: 'missing',
      issues: 'unknown',
      pullRequests: 'unknown',
      actions: 'unknown',
      secrets: 'unknown',
      canDeploy: false,
    });
  });
});
