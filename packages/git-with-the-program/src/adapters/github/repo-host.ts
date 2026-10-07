// Implements: docs/spec/06-upkeep.md §1.2 and §3.3 — the GitHub `RepoHostPort` for repository
// upkeep — and INV-005 ("GitHub access lives in adapters/"). Every REST route, the repository
// slug, and the remote-URL parsing upkeep needs live in this file; src/upkeep names none of them.
//
// It rides the transports issues.ts already built (`gh api` when present, `fetch` + token
// otherwise), so authentication is resolved exactly once in the codebase and a token is never
// read, logged or passed around by upkeep code.
//
// Like `GitHubIssuesClient`, the port this returns has no delete: it cannot remove a label, a
// topic it was not told to drop in `exact` mode, a tag, or a release.

import type { DeliveryFailure } from '../../core/delivery.js';
import type { ProposalKind } from '../../core/proposal.js';
import { type Result, err, ok } from '../../core/result.js';
import type { CreateReleaseInput, RepoHostPort } from '../../upkeep/host.js';
import type { HostFacts, HostLabel, HostRelease, LabelSpec } from '../../upkeep/types.js';
import {
  type CommandRunner,
  type FetchLike,
  type GitHubRepo,

  type GitHubTransport,
  nodeCommandRunner,
  parseGitHubRepo,
  repoSlug,
  resolveGitHubTransport,
} from './issues.js';
import { LABEL_ROOT, proposalLabels } from './render.js';

const PER_PAGE = 100;
const MAX_PAGES = 10;

// ---------------------------------------------------------------------------
// Repository coordinates
// ---------------------------------------------------------------------------

/** `https://github.com/o/n(.git)`, `git@github.com:o/n(.git)`, `ssh://git@github.com/o/n` → o/n. */
export function slugFromRemoteUrl(url: string): string | null {
  const m = /github\.com[:/]+([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/.exec(url.trim());
  return m === null ? null : `${m[1]}/${m[2]}`;
}

/**
 * Which repository upkeep is about: the config's explicit `repository`, then the Actions
 * environment's GITHUB_REPOSITORY, then the origin remote. The first that parses wins.
 */
export function resolveRepository(candidates: {
  readonly explicit?: string | undefined;
  readonly env?: string | undefined;
  readonly remoteUrl?: string | null | undefined;
}): GitHubRepo | null {
  for (const raw of [candidates.explicit, candidates.env, candidates.remoteUrl != null ? slugFromRemoteUrl(candidates.remoteUrl) : null]) {
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = parseGitHubRepo(raw);
    if (parsed.ok) return parsed.value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the engine itself files with — the labels a repository must carry
// ---------------------------------------------------------------------------

const PROPOSAL_KINDS = ['refactor', 'reprogram'] as const satisfies readonly ProposalKind[];

const KIND_LABEL: Readonly<Record<ProposalKind, { color: string; description: string }>> = {
  refactor: { color: '1d76db', description: 'GWTP refactoring recommendation: the code drifted from the program' },
  reprogram: { color: 'b60205', description: 'GWTP reprogramming proposal: the program itself should change' },
};

/**
 * Extracted from the delivery code rather than restated: `proposalLabels` is what
 * src/adapters/github/render.ts actually stamps on every filed proposal, so if that changes, the
 * label set upkeep maintains changes with it.
 */
export function engineLabels(): readonly LabelSpec[] {
  const seen = new Map<string, LabelSpec>();
  for (const kind of PROPOSAL_KINDS) {
    for (const name of proposalLabels(kind)) {
      if (seen.has(name)) continue;
      seen.set(
        name,
        name === LABEL_ROOT
          ? { name, color: '5319e7', description: 'Filed by Git with the Program from a ledger threshold crossing' }
          : { name, ...KIND_LABEL[kind] },
      );
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Response decoding — structural, forgiving of extra fields, strict on the ones used
// ---------------------------------------------------------------------------

type Json = Readonly<Record<string, unknown>>;

function asRecord(v: unknown): Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {};
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export function decodeRelease(raw: unknown): HostRelease | null {
  const r = asRecord(raw);
  if (typeof r['id'] !== 'number' || typeof r['tag_name'] !== 'string') return null;
  return {
    id: r['id'],
    tag: r['tag_name'],
    name: strOrNull(r['name']),
    body_empty: typeof r['body'] !== 'string' || r['body'].trim() === '',
    draft: r['draft'] === true,
    prerelease: r['prerelease'] === true,
  };
}

export function decodeLabel(raw: unknown): HostLabel | null {
  const l = asRecord(raw);
  if (typeof l['name'] !== 'string') return null;
  return {
    name: l['name'],
    color: typeof l['color'] === 'string' ? l['color'] : '',
    description: strOrNull(l['description']),
  };
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

async function paged(transport: GitHubTransport, path: string): Promise<readonly unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await transport({ method: 'GET', path, query: { per_page: String(PER_PAGE), page: String(page) } });
    const items = Array.isArray(res.body) ? (res.body as unknown[]) : [];
    all.push(...items);
    if (items.length < PER_PAGE) break;
  }
  return all;
}

export function githubRepoHost(repo: GitHubRepo, transport: GitHubTransport): RepoHostPort {
  const base = `repos/${repo.owner}/${repo.name}`;
  return {
    host: `github:${repoSlug(repo)}`,

    async read(): Promise<HostFacts> {
      const res = await transport({ method: 'GET', path: base });
      const r = asRecord(res.body);
      const releases = (await paged(transport, `${base}/releases`)).map(decodeRelease).filter((x): x is HostRelease => x !== null);
      const labels = (await paged(transport, `${base}/labels`)).map(decodeLabel).filter((x): x is HostLabel => x !== null);
      return {
        host: 'github',
        description: strOrNull(r['description']),
        homepage: strOrNull(r['homepage']),
        topics: Array.isArray(r['topics']) ? r['topics'].filter((t): t is string => typeof t === 'string') : [],
        default_branch: strOrNull(r['default_branch']),
        license: strOrNull(asRecord(r['license'])['spdx_id']),
        releases,
        labels,
      };
    },

    async updateMetadata(fields) {
      await transport({ method: 'PATCH', path: base, body: { ...fields } });
    },

    async replaceTopics(names) {
      await transport({ method: 'PUT', path: `${base}/topics`, body: { names: [...names] } });
    },

    async createLabel(label) {
      await transport({ method: 'POST', path: `${base}/labels`, body: { ...label } });
    },

    async updateLabel(label) {
      await transport({
        method: 'PATCH',
        path: `${base}/labels/${encodeURIComponent(label.name)}`,
        body: { color: label.color, description: label.description },
      });
    },

    async createTag(tag, sha) {
      // A lightweight tag via the refs API: one call, and no tagger identity to invent.
      await transport({ method: 'POST', path: `${base}/git/refs`, body: { ref: `refs/tags/${tag}`, sha } });
    },

    async createRelease(input: CreateReleaseInput) {
      const res = await transport({
        method: 'POST',
        path: `${base}/releases`,
        body: {
          tag_name: input.tag,
          name: input.name,
          body: input.body,
          draft: false,
          prerelease: input.prerelease,
          make_latest: input.make_latest ? 'true' : 'false',
        },
      });
      const url = asRecord(res.body)['html_url'];
      return typeof url === 'string' ? url : '';
    },

    async updateReleaseBody(id, body) {
      await transport({ method: 'PATCH', path: `${base}/releases/${id}`, body: { body } });
    },
  };
}

/** The whole assembly: a port, or the honest reason there is none. */
export async function openGitHubRepoHost(opts: {
  readonly repo: GitHubRepo;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly run?: CommandRunner;
  readonly fetch?: FetchLike;
  readonly ghAvailable?: () => Promise<boolean>;
}): Promise<Result<RepoHostPort, DeliveryFailure>> {
  const resolved = await resolveGitHubTransport({
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    run: opts.run ?? nodeCommandRunner(),
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    ...(opts.ghAvailable !== undefined ? { ghAvailable: opts.ghAvailable } : {}),
  });
  if (!resolved.ok) return err(resolved.error);
  return ok(githubRepoHost(opts.repo, resolved.value.transport));
}


