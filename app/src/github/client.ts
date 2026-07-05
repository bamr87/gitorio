// GitHub I/O — the fetch-based transport client (seed 03, docs/ARCHITECTURE.md §2–3).
//
// No Octokit dependency: a thin `fetch` wrapper keeps the static bundle lean and is
// trivially mockable via an injected `fetch`. Implements the shared GithubClient
// contract in ./types.ts — do not widen that surface here.
//
// Security (CLAUDE.md golden rule #7): the PAT is captured in the request closure
// returned by `connectWithPat` and is never stored on the client object, in module
// state, or anywhere persisted. It exists only as the `Bearer` header on live requests.

import type {
  ActionsPublicKey,
  FactoryRun,
  GithubClient,
  PermState,
  Preflight,
  RepoDirEntry,
  RepoFile,
  RepoRef,
  RepoVariable,
  RunConclusion,
  RunJob,
  RunsPoll,
} from './types';
import { GithubError } from './types';

const BASE = 'https://api.github.com';

/** A token-bound request function. `<T>` is the parsed JSON body (or `undefined` for empty responses). */
type RequestFn = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/** Standard GitHub REST auth + versioning headers for `token`. Fresh object per call. */
function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Parse the `x-ratelimit-remaining` response header to a number, or `null` if absent/NaN. */
function parseRateRemaining(res: Response): number | null {
  const raw = res.headers.get('x-ratelimit-remaining');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ── low-level transport ────────────────────────────────────────────────

/** Best-effort human-readable message from an error response body (`{message}` or raw text). */
async function readError(res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        detail = typeof parsed.message === 'string' ? parsed.message : text;
      } catch {
        detail = text;
      }
    }
  } catch {
    /* body already consumed or unreadable — status alone will have to do */
  }
  return `GitHub ${res.status}${detail ? `: ${detail}` : ''}`;
}

/** Build a request helper that closes over `token` + `fetchImpl`. Throws GithubError on non-2xx. */
function makeRequest(token: string, fetchImpl: typeof fetch): RequestFn {
  return async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${BASE}${path}`;
    const headers = authHeaders(token);
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(url, init);
    if (!res.ok) {
      throw new GithubError(await readError(res), res.status, url);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? (JSON.parse(text) as T) : (undefined as T));
  };
}

// ── encoding helpers (mirror blueprint/types.ts base64 idiom, UTF-8-safe) ──

/** UTF-8 text → base64 (TextEncoder → binary string → btoa). */
function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/** base64 (Contents API returns it line-wrapped) → UTF-8 text. */
function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Percent-encode each path segment while preserving `/` separators. */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

// ── client construction ────────────────────────────────────────────────

/**
 * Connect with a fine-grained PAT. Resolves the authenticated `login` via GET /user,
 * then returns a client that closes over the token. `opts.fetchImpl` allows injecting a
 * fetch for tests (defaults to `globalThis.fetch`).
 */
export async function connectWithPat(
  token: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<GithubClient> {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  if (!token || !token.trim()) {
    throw new GithubError('No token provided.', 0, `${BASE}/user`);
  }
  const request = makeRequest(token, fetchImpl);

  let login: string;
  try {
    const user = await request<{ login: string }>('GET', '/user');
    login = user.login;
  } catch (err) {
    if (err instanceof GithubError && err.status === 401) {
      throw new GithubError('Bad token (401): the PAT is invalid or expired.', 401, `${BASE}/user`);
    }
    throw err;
  }

  return buildClient(login, request, token, fetchImpl);
}

function buildClient(
  login: string,
  request: RequestFn,
  token: string,
  fetchImpl: typeof fetch,
): GithubClient {
  /** GET a probe URL; never throws. 200 → ok, 403 → missing, anything else → unknown. */
  const probe = async (path: string): Promise<PermState> => {
    try {
      await request('GET', path);
      return 'ok';
    } catch (err) {
      if (err instanceof GithubError && err.status === 403) return 'missing';
      return 'unknown';
    }
  };

  const contentsPath = (repo: RepoRef, path: string, ref?: string): string =>
    `/repos/${repo.owner}/${repo.repo}/contents/${encodePath(path)}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : '');

  const client: GithubClient = {
    login,

    async preflight(repo: RepoRef): Promise<Preflight> {
      let push = false;
      let accessible = false;
      try {
        const data = await request<{ permissions?: { push?: boolean } }>(
          'GET',
          `/repos/${repo.owner}/${repo.repo}`,
        );
        accessible = true;
        push = data.permissions?.push === true;
      } catch {
        accessible = false;
      }

      if (!accessible) {
        // GET /repos 404/403 (or worse) — report nothing available rather than throwing.
        return {
          repo,
          contents: 'missing',
          workflows: 'missing',
          issues: 'unknown',
          pullRequests: 'unknown',
          actions: 'unknown',
          secrets: 'unknown',
          canDeploy: false,
        };
      }

      const contents: PermState = push ? 'ok' : 'missing';
      // Approximation: the Contents API cannot cheaply distinguish "may write workflow
      // files" from "may write files" — .github/workflows write is gated behind the same
      // push permission at REST level. Mirror the contents state.
      const workflows: PermState = contents;
      const [actions, secrets] = await Promise.all([
        probe(`/repos/${repo.owner}/${repo.repo}/actions/permissions`),
        probe(`/repos/${repo.owner}/${repo.repo}/actions/secrets/public-key`),
      ]);

      return {
        repo,
        contents,
        workflows,
        // Best-effort: push implies issue/PR write is likely available; otherwise unknown.
        issues: push ? 'ok' : 'unknown',
        pullRequests: push ? 'ok' : 'unknown',
        actions,
        secrets,
        canDeploy: contents === 'ok',
      };
    },

    async getFile(repo: RepoRef, path: string, ref?: string): Promise<RepoFile | null> {
      try {
        const data = await request<{ content?: string; sha: string }>(
          'GET',
          contentsPath(repo, path, ref),
        );
        return { path, content: decodeBase64Utf8(data.content ?? ''), sha: data.sha };
      } catch (err) {
        if (err instanceof GithubError && err.status === 404) return null;
        throw err;
      }
    },

    async listDir(repo: RepoRef, path: string, ref?: string): Promise<RepoDirEntry[]> {
      try {
        const data = await request<
          Array<{ path: string; name: string; sha: string; type: string }> | unknown
        >('GET', contentsPath(repo, path, ref));
        if (!Array.isArray(data)) return [];
        return data.map((e) => ({
          path: e.path,
          name: e.name,
          sha: e.sha,
          type: e.type === 'dir' ? 'dir' : 'file',
        }));
      } catch (err) {
        if (err instanceof GithubError && err.status === 404) return [];
        throw err;
      }
    },

    async putFile(
      repo: RepoRef,
      path: string,
      content: string,
      message: string,
      opts?: { sha?: string; branch?: string },
    ): Promise<void> {
      const body: Record<string, unknown> = {
        message,
        content: encodeBase64Utf8(content),
      };
      if (opts?.sha) body.sha = opts.sha;
      if (opts?.branch) body.branch = opts.branch;
      await request('PUT', `/repos/${repo.owner}/${repo.repo}/contents/${encodePath(path)}`, body);
    },

    async deleteFile(
      repo: RepoRef,
      path: string,
      sha: string,
      message: string,
      opts?: { branch?: string },
    ): Promise<void> {
      const body: Record<string, unknown> = { message, sha };
      if (opts?.branch) body.branch = opts.branch;
      await request(
        'DELETE',
        `/repos/${repo.owner}/${repo.repo}/contents/${encodePath(path)}`,
        body,
      );
    },

    async getDefaultBranch(repo: RepoRef): Promise<string> {
      const data = await request<{ default_branch: string }>(
        'GET',
        `/repos/${repo.owner}/${repo.repo}`,
      );
      return data.default_branch;
    },

    async createBranch(repo: RepoRef, newBranch: string, fromBranch: string): Promise<void> {
      const ref = await request<{ object: { sha: string } }>(
        'GET',
        `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodePath(fromBranch)}`,
      );
      await request('POST', `/repos/${repo.owner}/${repo.repo}/git/refs`, {
        ref: `refs/heads/${newBranch}`,
        sha: ref.object.sha,
      });
    },

    async createPullRequest(
      repo: RepoRef,
      args: { title: string; head: string; base: string; body?: string },
    ): Promise<string> {
      const data = await request<{ html_url: string }>(
        'POST',
        `/repos/${repo.owner}/${repo.repo}/pulls`,
        { title: args.title, head: args.head, base: args.base, body: args.body },
      );
      return data.html_url;
    },

    async getActionsPublicKey(repo: RepoRef): Promise<ActionsPublicKey> {
      const data = await request<{ key: string; key_id: string }>(
        'GET',
        `/repos/${repo.owner}/${repo.repo}/actions/secrets/public-key`,
      );
      return { key: data.key, keyId: data.key_id };
    },

    async hasSecret(repo: RepoRef, name: string): Promise<boolean> {
      try {
        await request(
          'GET',
          `/repos/${repo.owner}/${repo.repo}/actions/secrets/${encodeURIComponent(name)}`,
        );
        return true;
      } catch (err) {
        if (err instanceof GithubError && err.status === 404) return false;
        throw err;
      }
    },

    async putSecret(
      repo: RepoRef,
      name: string,
      encryptedValue: string,
      keyId: string,
    ): Promise<void> {
      await request(
        'PUT',
        `/repos/${repo.owner}/${repo.repo}/actions/secrets/${encodeURIComponent(name)}`,
        { encrypted_value: encryptedValue, key_id: keyId },
      );
    },

    async listFactoryRuns(
      repo: RepoRef,
      opts?: { etag?: string | null; perPage?: number; pathPrefix?: string },
    ): Promise<RunsPoll> {
      // Direct fetch (not the request() helper) so we can read response headers — ETag for
      // conditional polling + x-ratelimit-remaining for polite backoff — and treat
      // 304/403/404 as non-fatal (a repo may have Actions disabled or no run history).
      // pathPrefix defaults to authored factories; observe mode passes the broader
      // '.github/workflows/' to see an entire repo's fleet.
      const prefix = opts?.pathPrefix ?? '.github/workflows/factory--';
      const perPage = opts?.perPage ?? 30;
      const url = `${BASE}/repos/${repo.owner}/${repo.repo}/actions/runs?per_page=${perPage}`;
      const headers = authHeaders(token);
      if (opts?.etag) headers['If-None-Match'] = opts.etag;

      const res = await fetchImpl(url, { method: 'GET', headers });
      const rateRemaining = parseRateRemaining(res);

      // 304 Not Modified — nothing changed since the prior ETag; costs no rate quota.
      if (res.status === 304) {
        return { runs: [], etag: opts?.etag ?? null, notModified: true, rateRemaining };
      }
      // Actions disabled (403) or no such repo/endpoint (404) — report an empty history.
      if (res.status === 403 || res.status === 404) {
        return { runs: [], etag: null, notModified: false, rateRemaining };
      }
      if (!res.ok) {
        throw new GithubError(await readError(res), res.status, url);
      }

      const body = (await res.json()) as { workflow_runs?: RawWorkflowRun[] };
      const raw = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
      const runs: FactoryRun[] = raw
        .filter((r) => r.path.startsWith(prefix))
        .map((r) => ({
          path: r.path,
          slug: r.path
            .replace(/^\.github\/workflows\//, '')
            .replace(/^factory--/, '')
            .replace(/\.ya?ml$/, ''),
          runId: r.id,
          runNumber: r.run_number,
          status: r.status,
          conclusion: r.conclusion ?? null,
          event: r.event,
          htmlUrl: r.html_url,
          runStartedAt: r.run_started_at ?? null,
          updatedAt: r.updated_at,
          createdAt: r.created_at,
        }))
        // Safety net: the API returns newest-first, but sort explicitly by createdAt desc.
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

      return { runs, etag: res.headers.get('etag'), notModified: false, rateRemaining };
    },

    async listRunJobs(repo: RepoRef, runId: number): Promise<RunJob[]> {
      const body = await request<{ jobs?: RawRunJob[] }>(
        'GET',
        `/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/jobs?per_page=50`,
      );
      const raw = Array.isArray(body?.jobs) ? body.jobs : [];
      return raw.map((j) => ({
        jobId: j.id,
        name: j.name,
        status: j.status,
        conclusion: j.conclusion ?? null,
        startedAt: j.started_at ?? null,
        completedAt: j.completed_at ?? null,
        htmlUrl: j.html_url,
        steps: (j.steps ?? []).map((st) => ({
          number: st.number,
          name: st.name,
          status: st.status,
          conclusion: st.conclusion ?? null,
        })),
      }));
    },

    async dispatchWorkflow(repo: RepoRef, workflowFile: string, ref?: string): Promise<void> {
      const branch = ref ?? (await client.getDefaultBranch(repo));
      await request(
        'POST',
        `/repos/${repo.owner}/${repo.repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
        { ref: branch },
      );
    },

    async cancelRun(repo: RepoRef, runId: number): Promise<void> {
      await request('POST', `/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/cancel`);
    },

    async listVariables(repo: RepoRef): Promise<RepoVariable[]> {
      try {
        const body = await request<{ variables?: { name: string; value: string }[] }>(
          'GET',
          `/repos/${repo.owner}/${repo.repo}/actions/variables?per_page=100`,
        );
        const raw = Array.isArray(body?.variables) ? body.variables : [];
        return raw.map((v) => ({ name: v.name, value: v.value }));
      } catch (err) {
        // No Actions, no permission, or no variables — report an empty set, don't throw.
        if (err instanceof GithubError && (err.status === 403 || err.status === 404)) return [];
        throw err;
      }
    },

    async getVariable(repo: RepoRef, name: string): Promise<RepoVariable | null> {
      try {
        const v = await request<{ name: string; value: string }>(
          'GET',
          `/repos/${repo.owner}/${repo.repo}/actions/variables/${encodeURIComponent(name)}`,
        );
        return { name: v.name, value: v.value };
      } catch (err) {
        if (err instanceof GithubError && err.status === 404) return null;
        throw err;
      }
    },

    async setVariable(repo: RepoRef, name: string, value: string): Promise<void> {
      // PATCH updates an existing variable; POST creates it. Probe first, then choose.
      const existing = await client.getVariable(repo, name);
      if (existing) {
        await request(
          'PATCH',
          `/repos/${repo.owner}/${repo.repo}/actions/variables/${encodeURIComponent(name)}`,
          { name, value },
        );
      } else {
        await request('POST', `/repos/${repo.owner}/${repo.repo}/actions/variables`, { name, value });
      }
    },
  };

  return client;
}

/** The subset of the Actions `jobs` payload this client consumes. */
interface RawRunJob {
  id: number;
  name: string;
  status: string;
  conclusion: RunConclusion;
  started_at?: string | null;
  completed_at?: string | null;
  html_url: string;
  steps?: { number: number; name: string; status: string; conclusion: RunConclusion | null }[];
}

/** The subset of the Actions `workflow_runs` payload this client consumes. */
interface RawWorkflowRun {
  id: number;
  run_number: number;
  status: string;
  conclusion: RunConclusion;
  event: string;
  html_url: string;
  path: string;
  run_started_at?: string | null;
  updated_at: string;
  created_at: string;
}
