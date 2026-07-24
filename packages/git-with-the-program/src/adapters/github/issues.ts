// Implements: docs/spec/02-ledger.md §5 ("v0 delivery: open a GitHub issue via the adapter
// containing the full evidence bundle" — seeds/SEED-02-ledger-engine.md deliverable 3) and
// INV-005 ("Engine core imports no forge-specific APIs; GitHub access lives in adapters/").
//
// EVERY forge-shaped fact in the delivery path lives in this file: the repository slug, the
// REST route names, the auth header, the `gh` CLI, the issue number. `src/core/delivery.ts`
// declares `DeliveryPort` and knows none of it, which is what makes INV-005 a deliverable here
// rather than a promise — src/ledger can hold the port and could not name GitHub if it tried.
//
// TWO TRANSPORTS, ONE CLIENT. The REST shapes are written once against a `GitHubTransport`
// (`request -> response`), and the two ways of speaking to GitHub — the `gh` CLI when it is on
// PATH, plain `fetch` with `GITHUB_TOKEN` otherwise — are two implementations of that one
// function type. Everything is injectable to the point where the tests make no network call
// and spawn no process: a fake transport is a function, and a fake client is an object with
// two methods.
//
// IDEMPOTENCY IS THE POINT. Content addressing already makes the ledger idempotent (spec 02 §1
// property 1) — nothing makes a forge idempotent. A CI retry, a re-run of `gwtp ledger fold`,
// or two concurrent workers folding the same event set would each file an issue about the same
// firing. So every document carries `deliveryMarker(key)` (assertion + firing event id) in its
// body, and `deliver` SEARCHES BEFORE IT CREATES.

import type {
  DeliveryDocument,
  DeliveryFailure,
  DeliveryOutcome,
  DeliveryPort,
} from '../../core/delivery.js';
import {
  deliveryFailure,
  deliveryMarker,
  deliveryReceipt,
  findDeliveryMarker,
} from '../../core/delivery.js';
import { type Result, err, fail, ok, type Parsed } from '../../core/result.js';

/** GitHub refuses an issue body over 65536 characters. Fail loudly rather than truncate evidence. */
export const GITHUB_ISSUE_BODY_LIMIT = 65_536;

export const GITHUB_API_BASE = 'https://api.github.com';

export const GITHUB_API_VERSION = '2022-11-28';

export const ISSUE_CHANNEL = 'github-issue';

// ---------------------------------------------------------------------------
// Repository coordinates — the forge-shaped fact core must never learn
// ---------------------------------------------------------------------------

export interface GitHubRepo {
  readonly owner: string;
  readonly name: string;
}

const SLUG = /^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;

export function parseGitHubRepo(raw: unknown, at?: string): Parsed<GitHubRepo> {
  if (typeof raw !== 'string') return fail('wrong-type', 'expected an owner/name slug', at);
  const m = SLUG.exec(raw.trim());
  if (m === null) {
    return fail('invalid-id', `expected <owner>/<name>, got ${JSON.stringify(raw)}`, at);
  }
  return ok({ owner: m[1] as string, name: m[2] as string });
}

export function repoSlug(repo: GitHubRepo): string {
  return `${repo.owner}/${repo.name}`;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface HttpRequest {
  readonly method: 'GET' | 'POST';
  /** API-relative, no leading slash: `search/issues`, `repos/o/n/issues`. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface HttpResponse {
  readonly status: number;
  /** Parsed JSON, or `null` for an empty body. */
  readonly body: unknown;
}

export type GitHubTransport = (req: HttpRequest) => Promise<HttpResponse>;

/**
 * A non-2xx carried as a value with its status intact, so `deliver` can tell an expired token
 * (401) from a rate limit (429) from a 502 worth retrying — the distinction `DeliveryFailure`
 * exists to preserve.
 */
export class GitHubApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`GitHub API ${status}: ${detail}`);
    this.name = 'GitHubApiError';
    this.status = status;
    this.detail = detail;
  }
}

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  stdin?: string,
) => Promise<CommandResult>;

export interface FetchResponseLike {
  readonly status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<FetchResponseLike>;

function queryString(query: Readonly<Record<string, string>> | undefined): string {
  if (query === undefined) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.append(k, v);
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * `gh api` — the preferred transport when the CLI is present, because it already holds the
 * user's credentials (keychain, `gh auth login`, or `GH_TOKEN`) and this tool then never has to
 * see a token, let alone log one.
 */
export function ghCliTransport(run: CommandRunner, ghPath = 'gh'): GitHubTransport {
  return async (req) => {
    const args = ['api', '--method', req.method, `${req.path}${queryString(req.query)}`];
    args.push('-H', `X-GitHub-Api-Version: ${GITHUB_API_VERSION}`);
    let stdin: string | undefined;
    if (req.body !== undefined) {
      // `--input -` posts a raw JSON body; `-f k=v` would flatten `labels: []` into strings.
      args.push('--input', '-');
      stdin = JSON.stringify(req.body);
    }
    const result = await run(ghPath, args, stdin);
    if (result.code !== 0) {
      const status = ghExitStatus(result.stderr);
      throw new GitHubApiError(status, (result.stderr || result.stdout).trim() || 'gh api failed');
    }
    return { status: 200, body: parseJson(result.stdout) };
  };
}

/** `gh api` prints `gh: ... (HTTP 404)`; recovering the code keeps failure classification honest. */
export function ghExitStatus(stderr: string): number {
  const m = /HTTP (\d{3})/.exec(stderr);
  if (m !== null) return Number.parseInt(m[1] as string, 10);
  if (/not logged|authentication|gh auth login/i.test(stderr)) return 401;
  return 0;
}

/** Plain REST with a bearer token. The fallback when `gh` is absent — CI containers, mostly. */
export function fetchTransport(opts: {
  readonly token: string;
  readonly fetch: FetchLike;
  readonly apiBase?: string;
}): GitHubTransport {
  const base = (opts.apiBase ?? GITHUB_API_BASE).replace(/\/$/, '');
  return async (req) => {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${opts.token}`,
      'x-github-api-version': GITHUB_API_VERSION,
      'user-agent': 'gwtp',
    };
    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method: req.method,
      headers,
    };
    if (req.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(req.body);
    }
    const res = await opts.fetch(`${base}/${req.path}${queryString(req.query)}`, init);
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new GitHubApiError(res.status, text.slice(0, 500));
    }
    return { status: res.status, body: parseJson(text) };
  };
}

/** Node's `child_process`, kept behind `CommandRunner` so no test ever spawns anything. */
export function nodeCommandRunner(): CommandRunner {
  return async (command, args, stdin) => {
    const { execFile } = await import('node:child_process');
    return new Promise<CommandResult>((resolve) => {
      const child = execFile(
        command,
        [...args],
        { maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code =
            error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
      if (stdin !== undefined) {
        child.stdin?.end(stdin);
      }
    });
  };
}

export interface TransportResolution {
  readonly transport: GitHubTransport;
  /** `gh` or `fetch` — reported so a run can say how it authenticated without printing secrets. */
  readonly via: 'gh' | 'fetch';
}

/**
 * `gh` if present, `fetch` + `GITHUB_TOKEN` otherwise, and an honest `unconfigured` failure if
 * neither — never a silent no-op. A governance tool that quietly fails to file its proposals is
 * indistinguishable from a repository with no drift, which is the worst outcome available.
 */
export async function resolveGitHubTransport(opts: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly run?: CommandRunner;
  readonly fetch?: FetchLike;
  readonly apiBase?: string;
  /** Overridable so a test can force either branch without touching PATH. */
  readonly ghAvailable?: () => Promise<boolean>;
}): Promise<Result<TransportResolution, DeliveryFailure>> {
  const env = opts.env ?? process.env;
  const run = opts.run;

  const probe =
    opts.ghAvailable ??
    (async () => {
      if (run === undefined) return false;
      try {
        const r = await run('gh', ['--version']);
        return r.code === 0;
      } catch {
        return false;
      }
    });

  if (run !== undefined && (await probe())) {
    return ok({ transport: ghCliTransport(run), via: 'gh' });
  }

  const token = env['GITHUB_TOKEN'] ?? env['GH_TOKEN'];
  const fetchImpl = opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (token !== undefined && token !== '' && fetchImpl !== undefined) {
    const t: { token: string; fetch: FetchLike; apiBase?: string } = { token, fetch: fetchImpl };
    if (opts.apiBase !== undefined) t.apiBase = opts.apiBase;
    return ok({ transport: fetchTransport(t), via: 'fetch' });
  }

  return deliveryFailure(
    'unconfigured',
    'no GitHub transport: the `gh` CLI is not available and neither GITHUB_TOKEN nor GH_TOKEN ' +
      'is set. Use the bare-repo delivery port (src/adapters/github/bare.ts) to write proposals ' +
      'to disk instead — docs/vision.md: "a bare repo degrades gracefully to commits-only".',
    false,
  );
}

// ---------------------------------------------------------------------------
// The issues client
// ---------------------------------------------------------------------------

export interface GitHubIssueRef {
  readonly number: number;
  readonly url: string;
}

export interface CreateIssueInput {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

/**
 * Two methods, and the first one is the idempotency guard. Narrow on purpose: a port that could
 * also EDIT or CLOSE an issue would be a port through which the machine could retract its own
 * evidence, and the ledger's whole posture (INV-002) is that corrections supersede rather than
 * overwrite. Delivery inherits the posture.
 */
export interface GitHubIssuesClient {
  findByMarker(marker: string): Promise<readonly GitHubIssueRef[]>;
  create(input: CreateIssueInput): Promise<GitHubIssueRef>;
}

interface SearchItem {
  readonly number?: unknown;
  readonly html_url?: unknown;
  readonly body?: unknown;
}

function toIssueRef(item: SearchItem): GitHubIssueRef | null {
  const n = item.number;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  const url = typeof item.html_url === 'string' ? item.html_url : '';
  return { number: n, url };
}

export function restIssuesClient(
  repo: GitHubRepo,
  transport: GitHubTransport,
): GitHubIssuesClient {
  return {
    async findByMarker(marker) {
      const q = `repo:${repoSlug(repo)} is:issue in:body ${JSON.stringify(marker)}`;
      const res = await transport({
        method: 'GET',
        path: 'search/issues',
        query: { q, per_page: '20' },
      });
      const body = res.body as { items?: unknown } | null;
      const items = Array.isArray(body?.items) ? (body.items as SearchItem[]) : [];
      const refs: GitHubIssueRef[] = [];
      for (const item of items) {
        // The search index TOKENISES, so `in:body "<marker>"` can match a near-neighbour. When
        // the payload carries the body, re-check the marker literally; when it does not, trust
        // the index rather than drop a hit — a false "not found" files a duplicate, which is
        // the failure this whole path exists to prevent.
        if (typeof item.body === 'string' && !item.body.includes(marker)) continue;
        const ref = toIssueRef(item);
        if (ref !== null) refs.push(ref);
      }
      return refs;
    },

    async create(input) {
      const res = await transport({
        method: 'POST',
        path: `repos/${repo.owner}/${repo.name}/issues`,
        body: { title: input.title, body: input.body, labels: [...input.labels] },
      });
      const ref = toIssueRef((res.body ?? {}) as SearchItem);
      if (ref === null) {
        throw new GitHubApiError(res.status, 'issue creation returned no issue number');
      }
      return ref;
    },
  };
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

export function deliveryFailureFromError(e: unknown): ReturnType<typeof deliveryFailure> {
  if (e instanceof GitHubApiError) {
    const detail = e.detail;
    if (e.status === 401) {
      return deliveryFailure('unauthenticated', 'GitHub rejected the credentials', false, detail);
    }
    if (e.status === 403) {
      return /rate limit|secondary rate/i.test(detail)
        ? deliveryFailure('rate-limited', 'GitHub rate limit reached', true, detail)
        : deliveryFailure('unauthenticated', 'GitHub forbade the request', false, detail);
    }
    if (e.status === 404) {
      return deliveryFailure(
        'not-found',
        'repository not found, or the token cannot see it',
        false,
        detail,
      );
    }
    if (e.status === 429) {
      return deliveryFailure('rate-limited', 'GitHub rate limit reached', true, detail);
    }
    if (e.status === 422) {
      return deliveryFailure('rejected', 'GitHub refused the issue payload', false, detail);
    }
    if (e.status === 0 || e.status >= 500) {
      return deliveryFailure('transport', `GitHub is unavailable (${e.status})`, true, detail);
    }
    return deliveryFailure('rejected', e.message, false, detail);
  }
  return deliveryFailure('transport', (e as Error)?.message ?? String(e), true);
}

export interface GitHubIssueDeliveryOptions {
  readonly repo: GitHubRepo;
  readonly client: GitHubIssuesClient;
  /** Overridable so a caller can point at a mirror or a test double's own naming. */
  readonly channel?: string;
}

/**
 * `DeliveryPort` over GitHub issues.
 *
 * `deliver` is idempotent on `doc.key`: it looks for the delivery marker first and returns
 * `status: 'existing'` — a SUCCESS — when the firing has already been filed. Two honest
 * limitations, stated rather than papered over:
 *
 *  - GitHub's search index is eventually consistent, so two workers racing within seconds of
 *    each other can both miss and both create. The key is still in both bodies, so the
 *    duplicate is detectable and collapsible; the alternative (a distributed lock on a forge)
 *    is not something a bare-git-first design gets to assume.
 *  - A human who deletes the marker from an issue body has un-keyed that delivery. That is a
 *    human editing evidence, which no adapter can prevent and the ledger does not depend on.
 */
export function githubIssueDelivery(opts: GitHubIssueDeliveryOptions): DeliveryPort {
  const channel = opts.channel ?? ISSUE_CHANNEL;
  return {
    channel,
    async deliver(doc: DeliveryDocument): Promise<DeliveryOutcome> {
      const marker = deliveryMarker(doc.key);

      // The marker is what makes the next run idempotent, so its presence is not left to the
      // renderer's good manners.
      const body = findDeliveryMarker(doc.body) === doc.key ? doc.body : `${doc.body}\n\n${marker}`;

      if (body.length > GITHUB_ISSUE_BODY_LIMIT) {
        return deliveryFailure(
          'rejected',
          `issue body is ${body.length} characters; GitHub's limit is ${GITHUB_ISSUE_BODY_LIMIT}`,
          false,
        );
      }

      let existing: readonly GitHubIssueRef[];
      try {
        existing = await opts.client.findByMarker(marker);
      } catch (e) {
        return deliveryFailureFromError(e);
      }
      const already = existing[0];
      if (already !== undefined) {
        return ok(
          deliveryReceipt(
            doc.key,
            'existing',
            channel,
            already.url === '' ? issueUrl(opts.repo, already.number) : already.url,
            String(already.number),
          ),
        );
      }

      try {
        const created = await opts.client.create({
          title: doc.title,
          body,
          labels: doc.labels,
        });
        return ok(
          deliveryReceipt(
            doc.key,
            'created',
            channel,
            created.url === '' ? issueUrl(opts.repo, created.number) : created.url,
            String(created.number),
          ),
        );
      } catch (e) {
        return deliveryFailureFromError(e);
      }
    },
  };
}

export function issueUrl(repo: GitHubRepo, number: number): string {
  return `https://github.com/${repo.owner}/${repo.name}/issues/${number}`;
}

/**
 * The whole assembly, for a caller that has a slug and nothing else. Returns the port or the
 * reason it could not be built — never a port that silently drops proposals.
 */
export async function openGitHubIssueDelivery(opts: {
  readonly repo: GitHubRepo;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly run?: CommandRunner;
  readonly fetch?: FetchLike;
  readonly apiBase?: string;
  readonly ghAvailable?: () => Promise<boolean>;
}): Promise<Result<DeliveryPort, DeliveryFailure>> {
  const resolved = await resolveGitHubTransport({
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    run: opts.run ?? nodeCommandRunner(),
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    ...(opts.apiBase !== undefined ? { apiBase: opts.apiBase } : {}),
    ...(opts.ghAvailable !== undefined ? { ghAvailable: opts.ghAvailable } : {}),
  });
  if (!resolved.ok) return err(resolved.error);
  return ok(
    githubIssueDelivery({
      repo: opts.repo,
      client: restIssuesClient(opts.repo, resolved.value.transport),
    }),
  );
}
