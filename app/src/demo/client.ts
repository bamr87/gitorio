// The demo GithubClient — a full implementation of the transport contract that never
// touches the network (ADR-032, specs/009-demo-environment).
//
// The design decision this file embodies: the demo is ONE SUBSTITUTION, not a mode
// threaded through the UI. Every panel already talks to a `GithubClient` from the store,
// so swapping in this object makes all seven tabs live — and, critically, the compile /
// facts / metrics / audit engines then run FOR REAL over the fixture data. There is no
// second rendering path that could drift from the shipping one (spec G2, NG1).
//
// Security (golden rule #7, NFR-SEC-1): there is no `fetch` here, no token, and no
// credential of any kind. `client.test.ts` proves it by making `globalThis.fetch` throw
// and then calling every method.
//
// Writes land in an in-memory overlay that every read consults first, so Deploy, prompt
// edits and kill-switch toggles visibly persist — for the lifetime of the tab, and no
// further (spec section 11: the risk the demo carries is confusion, not leakage).

import type { Blueprint } from '../blueprint/types';
import { compile } from '../compiler/compile';
import type {
  ActionsPublicKey,
  FactoryRun,
  GithubClient,
  Preflight,
  RepoDirEntry,
  RepoFile,
  RepoRef,
  RepoVariable,
  RepoWorkflow,
  RunJob,
  RunsPoll,
} from '../github/types';
import { repoSlug } from '../github/types';
import {
  DEMO_BACKLOG_YML,
  DEMO_BLUEPRINT,
  DEMO_CONFIG_YML,
  DEMO_HUB,
  DEMO_LEDGER_JSON,
  DEMO_LOGIN,
  DEMO_PLAIN_WORKFLOWS,
  DEMO_PROMPTS,
  DEMO_REPOS,
  DEMO_VARIABLES,
  demoRunJobs,
  demoRuns,
  demoWorkflows,
  systemClock,
  type Clock,
  type DemoRepo,
} from './fixtures';

const WF_DIR = '.github/workflows';

/** Is this repo part of the demo fleet? Anything else reads as an empty repo. */
function isDemoRepo(slug: string): slug is DemoRepo {
  return (DEMO_REPOS as readonly string[]).includes(slug);
}

/**
 * Stable pseudo-sha for a file's content. The real client returns a git blob sha, which
 * callers only ever use as an update/delete token — so any content-derived value works,
 * as long as it changes when the content does (Deploy diffs depend on that).
 */
function fakeSha(path: string, content: string): string {
  let h = 0x811c9dc5;
  const s = `${path} ${content}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').repeat(5).slice(0, 40);
}

/**
 * design-system runs one line: the shipping Docs Gardener template, unmodified. Reusing
 * the gallery shape rather than inventing one means the demo shows a factory a visitor
 * can actually stamp onto their own canvas from the Templates button.
 */
const DOCS_GARDENER_BLUEPRINT: Blueprint = {
  version: 1,
  meta: {
    name: 'Docs Gardener',
    repo: 'acme/design-system',
    description: 'Daily: review + improve a few docs from the collection, as a reviewable PR.',
  },
  nodes: [
    { id: 'dd', type: 'trigger.cron', position: { x: 40, y: 90 }, config: { cron: '0 8 * * *' } },
    { id: 'dm', type: 'trigger.manual', position: { x: 40, y: 210 }, config: { mode: 'plan-first' } },
    {
      id: 'dg',
      type: 'gate.enablement',
      position: { x: 250, y: 150 },
      config: { variable: 'DOCS_GARDENER_ENABLED' },
    },
    { id: 'drl', type: 'rate.limiter', position: { x: 440, y: 150 }, config: { maxPerDay: 2 } },
    {
      id: 'da',
      type: 'agent.claude',
      position: { x: 630, y: 150 },
      config: {
        promptRef: '.factory/prompts/docs-gardener.md',
        model: 'claude-opus-5',
        maxTurns: 24,
      },
    },
    {
      id: 'dpr',
      type: 'sink.open_pr',
      position: { x: 870, y: 150 },
      config: { branchHint: 'factory/docs-*' },
    },
  ],
  edges: [
    { id: 'e1', from: { node: 'dd', port: 'out' }, to: { node: 'dg', port: 'in' } },
    { id: 'e2', from: { node: 'dm', port: 'out' }, to: { node: 'dg', port: 'in' } },
    { id: 'e3', from: { node: 'dg', port: 'out' }, to: { node: 'drl', port: 'in' } },
    { id: 'e4', from: { node: 'drl', port: 'out' }, to: { node: 'da', port: 'in' } },
    { id: 'e5', from: { node: 'da', port: 'out' }, to: { node: 'dpr', port: 'in' } },
  ],
};

/** Which blueprint (if any) this repo publishes. Only two of the three run a factory. */
export function demoBlueprintFor(slug: DemoRepo): Blueprint | null {
  if (slug === 'acme/storefront') return DEMO_BLUEPRINT;
  if (slug === 'acme/design-system') return DOCS_GARDENER_BLUEPRINT;
  return null;
}

const DEMO_PROMPT_LIBRARY: Record<DemoRepo, Record<string, string>> = {
  'acme/storefront': DEMO_PROMPTS,
  'acme/design-system': {
    '.factory/prompts/docs-gardener.md': `# Docs gardener

Improve the docs collection, a couple of pages at a time.

## Task
Pick the two most improvable files under \`docs/\`, apply the review criteria from
\`.factory/config.yml\`, and open ONE pull request.

## Rules
- Improve what is there. Do not invent new pages.
- Keep every code sample runnable.
- One paragraph per line, per the repo's markdown rule.
`,
  },
  'acme/infra': {},
};

/** The committed file tree of one demo repo, before any session writes. */
function initialFiles(slug: DemoRepo): Map<string, string> {
  const files = new Map<string, string>();

  // Compiler output is generated by the REAL compiler at construction time. That is the
  // point: the workflow YAML a visitor reads in Fleet or Monitor is literally what
  // compile() emits, so the demo cannot show a shape the shipping code would not.
  const blueprint = demoBlueprintFor(slug);
  if (blueprint) {
    files.set('.factory/blueprint.json', `${JSON.stringify(blueprint, null, 2)}\n`);
    for (const wf of compile(blueprint, { blueprintPath: '.factory/blueprint.json' }).workflows) {
      if (wf.yaml) files.set(`${WF_DIR}/${wf.filename}`, wf.yaml);
    }
  }

  for (const [file, yaml] of Object.entries(DEMO_PLAIN_WORKFLOWS[slug] ?? {})) {
    files.set(`${WF_DIR}/${file}`, yaml);
  }
  for (const [path, body] of Object.entries(DEMO_PROMPT_LIBRARY[slug] ?? {})) {
    files.set(path, body);
  }

  if (slug === 'acme/storefront') {
    files.set('.factory/config.yml', DEMO_CONFIG_YML);
    files.set('.factory/backlog.yml', DEMO_BACKLOG_YML);
    files.set('.factory/ledger.json', DEMO_LEDGER_JSON);
  }
  files.set('README.md', `# ${slug.split('/')[1]}\n\nPart of the GitFactory demo fleet.\n`);
  return files;
}

/** Mutable session state for one repo. Reads consult this; nothing is persisted. */
interface RepoState {
  files: Map<string, string>;
  variables: RepoVariable[];
  secrets: Set<string>;
  workflows: RepoWorkflow[];
  runs: FactoryRun[];
  /** Branches created this session, plus the default. */
  branches: Set<string>;
  /** Files whose generators are lazy chunks (the hub's tree, a repo's compiled manifest) land on first read — one shared seeding, so concurrent reads all wait for it. */
  seeding: Promise<void> | null;
  nextIssue: number;
  nextPr: number;
}

export interface DemoClientOptions {
  /** Pinned in tests and screenshot runs so the fleet tells the same story every time. */
  clock?: Clock;
}

/** Something the visitor changed this session — surfaced so the UI can say where it went. */
export interface DemoActivity {
  kind: 'file' | 'variable' | 'secret' | 'pr' | 'issue' | 'dispatch' | 'workflow';
  detail: string;
  at: string;
}

export interface DemoClient extends GithubClient {
  readonly isDemo: true;
  /** What the visitor has changed this session, oldest first. */
  activity(): DemoActivity[];
}

/**
 * Build a fixture-backed client. Every method resolves; none of them performs I/O.
 * Unknown repos behave like a repo with nothing in it rather than throwing, so a visitor
 * who types a slug into the roster gets an empty district, not a red error.
 */
export function createDemoClient(opts: DemoClientOptions = {}): DemoClient {
  const clock = opts.clock ?? systemClock;
  const states = new Map<string, RepoState>();
  const log: DemoActivity[] = [];

  const record = (kind: DemoActivity['kind'], detail: string) => {
    log.push({ kind, detail, at: new Date(clock()).toISOString() });
  };

  const stateOf = (repo: RepoRef): RepoState => {
    const slug = repoSlug(repo);
    let st = states.get(slug);
    if (!st) {
      const known = isDemoRepo(slug);
      st = {
        files: known ? initialFiles(slug) : new Map(),
        seeding: null,
        variables: known ? DEMO_VARIABLES[slug].map((v) => ({ ...v })) : [],
        secrets: new Set(known ? ['CLAUDE_CODE_OAUTH_TOKEN'] : []),
        workflows: known ? demoWorkflows(slug) : [],
        runs: known ? demoRuns(slug, clock()) : [],
        branches: new Set(['main']),
        nextIssue: 412,
        nextPr: 118,
      };
      states.set(slug, st);
    }
    return st;
  };

  /**
   * Two generators are lazy chunks and run on first touch, never on entry: the demo hub's tree
   * (the harness engine) and the fleet/v1 manifest GitFactory compiles for a blueprint-bearing
   * repo (specs/014) — what the hub would read for it. Session writes are never overwritten.
   */
  const seedFiles = async (st: RepoState, slug: string): Promise<void> => {
    if (slug === DEMO_HUB) {
      const { demoHubFiles } = await import('./hub');
      for (const [path, body] of demoHubFiles(clock())) {
        if (!st.files.has(path)) st.files.set(path, body);
      }
    }
    const blueprint = isDemoRepo(slug) ? demoBlueprintFor(slug) : null;
    if (blueprint && !st.files.has('fleet.manifest.yml')) {
      const { toFleetManifestYaml } = await import('../harness/manifest-yaml');
      st.files.set('fleet.manifest.yml', toFleetManifestYaml(blueprint, slug));
    }
  };

  /** The repo's files, seeded once; parallel reads (a fleet import, a hub refresh) share the wait. */
  const filesOf = async (repo: RepoRef): Promise<Map<string, string>> => {
    const st = stateOf(repo);
    if (!st.seeding) st.seeding = seedFiles(st, repoSlug(repo));
    await st.seeding;
    return st.files;
  };

  const client: DemoClient = {
    isDemo: true,
    login: DEMO_LOGIN,

    activity: () => [...log],

    async preflight(repo: RepoRef): Promise<Preflight> {
      // The demo grants everything: the point is to show the surfaces, and the overlay
      // makes every write harmless. The checklist a visitor sees is all green.
      const ok = 'ok' as const;
      return {
        repo,
        contents: ok,
        workflows: ok,
        issues: ok,
        pullRequests: ok,
        actions: ok,
        secrets: ok,
        canDeploy: true,
      };
    },

    async getFile(repo: RepoRef, path: string): Promise<RepoFile | null> {
      const content = (await filesOf(repo)).get(path);
      if (content === undefined) return null;
      return { path, content, sha: fakeSha(path, content) };
    },

    async listDir(repo: RepoRef, path: string): Promise<RepoDirEntry[]> {
      const prefix = path.replace(/\/$/, '');
      const seen = new Map<string, RepoDirEntry>();
      for (const [p, content] of await filesOf(repo)) {
        if (prefix && !p.startsWith(`${prefix}/`)) continue;
        const rest = prefix ? p.slice(prefix.length + 1) : p;
        const cut = rest.indexOf('/');
        if (cut === -1) {
          seen.set(rest, { path: p, name: rest, sha: fakeSha(p, content), type: 'file' });
        } else {
          const name = rest.slice(0, cut);
          const dirPath = prefix ? `${prefix}/${name}` : name;
          if (!seen.has(name)) {
            seen.set(name, { path: dirPath, name, sha: fakeSha(dirPath, ''), type: 'dir' });
          }
        }
      }
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    async putFile(repo: RepoRef, path: string, content: string, message: string): Promise<void> {
      (await filesOf(repo)).set(path, content);
      record('file', `${repoSlug(repo)} · ${path} — ${message}`);
    },

    async deleteFile(repo: RepoRef, path: string, _sha: string, message: string): Promise<void> {
      (await filesOf(repo)).delete(path);
      record('file', `${repoSlug(repo)} · deleted ${path} — ${message}`);
    },

    async getDefaultBranch(): Promise<string> {
      return 'main';
    },

    async createBranch(repo: RepoRef, newBranch: string): Promise<void> {
      stateOf(repo).branches.add(newBranch);
    },

    async createPullRequest(repo: RepoRef, args): Promise<string> {
      const st = stateOf(repo);
      const n = st.nextPr++;
      record('pr', `${repoSlug(repo)}#${n} — ${args.title}`);
      return `https://github.com/${repoSlug(repo)}/pull/${n}`;
    },

    async getActionsPublicKey(): Promise<ActionsPublicKey> {
      // A syntactically valid 32-byte base64 key, so the sealed-box helper runs for real
      // against it. What it seals never leaves this tab.
      return { key: 'ZGVtby1wdWJsaWMta2V5LWZvci1naXRmYWN0b3J5LWRlbW8h', keyId: 'demo-key-1' };
    },

    async hasSecret(repo: RepoRef, name: string): Promise<boolean> {
      return stateOf(repo).secrets.has(name);
    },

    async putSecret(repo: RepoRef, name: string): Promise<void> {
      stateOf(repo).secrets.add(name);
      record('secret', `${repoSlug(repo)} · ${name} set (in this tab only)`);
    },

    async listFactoryRuns(repo: RepoRef, opts): Promise<RunsPoll> {
      const prefix = opts?.pathPrefix ?? `${WF_DIR}/factory--`;
      const perPage = opts?.perPage ?? 30;
      const runs = stateOf(repo)
        .runs.filter((r) => r.path.startsWith(prefix))
        .slice(0, perPage);
      // A fresh etag every poll: the demo's run list barely changes, and answering 304
      // would leave a freshly seeded store empty on its first render.
      return { runs, etag: `"demo-${runs.length}"`, notModified: false, rateRemaining: null };
    },

    async listRunJobs(repo: RepoRef, runId: number): Promise<RunJob[]> {
      void repo;
      return demoRunJobs(runId, clock());
    },

    async dispatchWorkflow(repo: RepoRef, workflowFile: string): Promise<void> {
      // A dispatch produces a run, which is what makes "Run now" demonstrable: the
      // Monitor list grows by one in_progress row exactly as it would against GitHub.
      const st = stateOf(repo);
      const path = `${WF_DIR}/${workflowFile}`;
      const nowIso = new Date(clock()).toISOString();
      st.runs.unshift({
        path,
        slug: workflowFile.replace(/^factory--/, '').replace(/\.ya?ml$/, ''),
        runId: 990_000 + st.runs.length,
        runNumber: st.runs.filter((r) => r.path === path).length + 1,
        status: 'in_progress',
        conclusion: null,
        event: 'workflow_dispatch',
        htmlUrl: `https://github.com/${repoSlug(repo)}/actions`,
        runStartedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
        runAttempt: 1,
      });
      record('dispatch', `${repoSlug(repo)} · ran ${workflowFile}`);
    },

    async cancelRun(repo: RepoRef, runId: number): Promise<void> {
      const run = stateOf(repo).runs.find((r) => r.runId === runId);
      if (run) {
        run.status = 'completed';
        run.conclusion = 'cancelled';
      }
    },

    async listRepoWorkflows(repo: RepoRef): Promise<RepoWorkflow[]> {
      return stateOf(repo).workflows.map((w) => ({ ...w }));
    },

    async rerunRun(repo: RepoRef, runId: number): Promise<void> {
      const run = stateOf(repo).runs.find((r) => r.runId === runId);
      if (run) {
        run.runAttempt += 1;
        run.status = 'in_progress';
        run.conclusion = null;
      }
    },

    async setWorkflowEnabled(repo: RepoRef, workflowId: number, enabled: boolean): Promise<void> {
      const wf = stateOf(repo).workflows.find((w) => w.id === workflowId);
      if (wf) wf.state = enabled ? 'active' : 'disabled_manually';
      record(
        'workflow',
        `${repoSlug(repo)} · ${wf?.name ?? workflowId} ${enabled ? 'enabled' : 'disabled'}`,
      );
    },

    async createIssue(repo: RepoRef, args): Promise<string> {
      const st = stateOf(repo);
      const n = st.nextIssue++;
      record('issue', `${repoSlug(repo)}#${n} — ${args.title}`);
      return `https://github.com/${repoSlug(repo)}/issues/${n}`;
    },

    async listVariables(repo: RepoRef): Promise<RepoVariable[] | null> {
      // Always readable in the demo — so the Schedule board's armed/disarmed readout is
      // exercised, and its third state ("unknown", the ADR-021 false-disarmed fix) is
      // never reached here. Seeing that one needs a real permission gap.
      return stateOf(repo).variables.map((v) => ({ ...v }));
    },

    async getVariable(repo: RepoRef, name: string): Promise<RepoVariable | null> {
      const v = stateOf(repo).variables.find((x) => x.name === name);
      return v ? { ...v } : null;
    },

    async setVariable(repo: RepoRef, name: string, value: string): Promise<void> {
      const st = stateOf(repo);
      const existing = st.variables.find((x) => x.name === name);
      if (existing) existing.value = value;
      else st.variables.push({ name, value });
      record('variable', `${repoSlug(repo)} · ${name} = ${value}`);
    },
  };

  return client;
}
