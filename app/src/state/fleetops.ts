// Fleet Command state: the multi-repo cockpit behind the Fleet tab's Command mode.
// Holds a persisted roster of repos (slugs only — never tokens, golden rule #7), scans
// each one on demand (workflows → facts → audit; runs → metrics), and keeps fleet-wide
// derived views (flagged metrics, totals, type rollup) recomputed after every scan.
//
// Scanning is explicitly user-driven (a "Scan fleet" action), not a background poller:
// a 40-repo sweep costs ~3 API calls per repo, so it runs when asked and shows the
// remaining rate budget instead of silently burning it (ARCHITECTURE §6 rate hygiene).
//
// Fleet-wide metric identity: runs/labels are keyed `owner/name::path` before they hit
// the pure metrics engine, because bare workflow paths collide across repos (every repo
// has a .github/workflows/ci.yml). The `::` key is split back out for display.

import { create } from 'zustand';
import { auditRepo } from '../fleet/audit';
import { importFleetDeep } from '../fleet/import';
import { mergeRoster, parseGitmodules, parseRosterText } from '../fleet/manifest';
import { assignFlags, computeWorkflowMetrics, rollup, rollupByType } from '../fleet/metrics';
import type {
  DashType,
  Fleet,
  MetricsRollup,
  RepoAudit,
  RosterEntry,
  WorkflowFacts,
  WorkflowMetrics,
} from '../fleet/types';
import type {
  FactoryRun,
  RepoVariable,
  RepoWorkflow,
  RunConclusion,
  RunJob,
} from '../github/types';
import { parseRepo } from '../github/types';
import { useGithubStore } from './github';

/** Everything the cockpit holds for one scanned repo. */
export interface RepoSnapshot {
  slug: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  fleet: Fleet | null;
  facts: WorkflowFacts[];
  audit: RepoAudit | null;
  /** Registered workflows from the Actions API (carries the enabled/disabled state). */
  workflowStates: RepoWorkflow[];
  /**
   * Repo Actions variables — the kill-switch armed/disarmed readout. `null` means they
   * could not be read, which must render as "unknown", never as "disarmed".
   */
  variables: RepoVariable[] | null;
  runs: FactoryRun[];
  /** Lazy per-run job cache for the workflow drill-down — 'loading' while in flight. */
  jobsByRun: Record<number, RunJob[] | 'loading'>;
  etag: string | null;
  scannedAt: number | null;
}

/** A fleet-scoped metrics row: repo attribution + the display path split back out. */
export interface FleetWorkflowMetrics extends WorkflowMetrics {
  repo: string;
  displayPath: string;
}

export const FLEETOPS_KEY = 'gitfactory.fleetops.v1';
const SCAN_CONCURRENCY = 3;

interface PersistedFleetOps {
  roster: RosterEntry[];
  hubSlug: string;
  windowDays: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PERSIST_DEFAULTS: PersistedFleetOps = { roster: [], hubSlug: '', windowDays: 14 };

function loadPersisted(storage: StorageLike | null): PersistedFleetOps {
  if (!storage) return { ...PERSIST_DEFAULTS };
  try {
    const raw = storage.getItem(FLEETOPS_KEY);
    if (!raw) return { ...PERSIST_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PersistedFleetOps>;
    const roster = Array.isArray(parsed.roster)
      ? parsed.roster.filter(
          (e): e is RosterEntry =>
            !!e && typeof e === 'object' && typeof (e as RosterEntry).slug === 'string',
        )
      : [];
    return {
      roster,
      hubSlug: typeof parsed.hubSlug === 'string' ? parsed.hubSlug : '',
      windowDays:
        typeof parsed.windowDays === 'number' && parsed.windowDays >= 1 && parsed.windowDays <= 90
          ? Math.round(parsed.windowDays)
          : PERSIST_DEFAULTS.windowDays,
    };
  } catch {
    return { ...PERSIST_DEFAULTS };
  }
}

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Shown when a maintenance action is attempted without a connected client. */
const NO_CLIENT = 'Connect with a token first — fleet maintenance actions run through the session client.';

/** Conclusions the "re-run last failure" action treats as a retryable jam. */
const RETRYABLE: RunConclusion[] = ['failure', 'timed_out', 'startup_failure'];

/** `actionBusy` key for a repo action, so a maintenance button can disable itself. */
export const busyKey = (slug: string, action: string): string => `${slug}:${action}`;

/** Newest retryable-failure run for one workflow path, or null when the path is clean. */
function newestFailedRun(runs: FactoryRun[], path: string): FactoryRun | null {
  let best: FactoryRun | null = null;
  for (const r of runs) {
    if (r.path !== path || !RETRYABLE.includes(r.conclusion)) continue;
    if (!best || r.createdAt > best.createdAt) best = r;
  }
  return best;
}

function emptySnapshot(slug: string): RepoSnapshot {
  return {
    slug,
    status: 'idle',
    error: null,
    fleet: null,
    facts: [],
    audit: null,
    workflowStates: [],
    variables: null,
    runs: [],
    jobsByRun: {},
    etag: null,
    scannedAt: null,
  };
}

/** Fleet-wide derived views recomputed after each scan. */
interface DerivedViews {
  fleetMetrics: FleetWorkflowMetrics[];
  totals: MetricsRollup | null;
  byType: ({ type: DashType; sharePct: number } & MetricsRollup)[];
}

function deriveViews(
  snapshots: Record<string, RepoSnapshot>,
  windowDays: number,
  nowIso: string,
): DerivedViews {
  const runsUnion: FactoryRun[] = [];
  const labels = new Map<string, { name: string; dashType: DashType }>();
  for (const snap of Object.values(snapshots)) {
    if (snap.status !== 'ready') continue;
    for (const f of snap.facts) {
      labels.set(`${snap.slug}::${f.path}`, { name: f.name, dashType: f.dashType });
    }
    for (const r of snap.runs) {
      runsUnion.push({ ...r, path: `${snap.slug}::${r.path}` });
    }
  }
  if (runsUnion.length === 0 && labels.size === 0) {
    return { fleetMetrics: [], totals: null, byType: [] };
  }
  const metrics = computeWorkflowMetrics(runsUnion, labels, {
    nowIso,
    windowDays,
  });
  const flagged = assignFlags(metrics);
  const fleetMetrics: FleetWorkflowMetrics[] = flagged.map((m) => {
    const cut = m.path.indexOf('::');
    return {
      ...m,
      repo: cut >= 0 ? m.path.slice(0, cut) : '',
      displayPath: cut >= 0 ? m.path.slice(cut + 2) : m.path,
    };
  });
  return {
    fleetMetrics,
    totals: flagged.length > 0 ? rollup(flagged) : null,
    byType: rollupByType(flagged),
  };
}

export interface FleetOpsState extends DerivedViews {
  roster: RosterEntry[];
  hubSlug: string;
  windowDays: number;
  snapshots: Record<string, RepoSnapshot>;
  scanning: boolean;
  progress: { done: number; total: number } | null;
  rateRemaining: number | null;
  error: string | null;
  /** Issue html_urls already filed this session, keyed by finding — disables re-filing. */
  filedWorkOrders: Record<string, string>;
  /** In-flight maintenance actions, keyed `slug:action` — drives per-button disabling. */
  actionBusy: Record<string, boolean>;

  addRepos: (text: string) => void;
  removeRepo: (slug: string) => void;
  /** Import a hub repo's .gitmodules as the roster (the monorepo → fleet bridge). */
  importFromHub: (hub: string) => Promise<boolean>;
  setWindowDays: (days: number) => void;
  scanRepo: (slug: string) => Promise<void>;
  scanFleet: () => Promise<void>;
  /** File an audit finding as a work-order issue in the offending repo. */
  fileWorkOrder: (
    slug: string,
    key: string,
    title: string,
    body: string,
  ) => Promise<string | null>;

  // ── workflow maintenance (the parked "maintain" actions, wired) ──
  /** Re-run the newest failed/timed-out/startup-failure run of `path`; no-op if clean. */
  rerunLatestFailed: (slug: string, path: string) => Promise<void>;
  /** `workflow_dispatch` a workflow file on its default branch, then re-scan. */
  dispatchWorkflowFile: (slug: string, file: string) => Promise<void>;
  /** Cancel one in-progress run, then re-scan. */
  cancelRunById: (slug: string, runId: number) => Promise<void>;
  /** Arm/disarm a `vars.*_ENABLED` kill switch by writing "true"/"false", then re-scan. */
  setKillSwitch: (slug: string, varName: string, on: boolean) => Promise<void>;
  /** Enable/disable a registered workflow by id (distinct from the kill switch), then re-scan. */
  setWorkflowEnabledById: (slug: string, workflowId: number, enabled: boolean) => Promise<void>;
  /** Load one run's jobs (with steps) into the snapshot's `jobsByRun` cache. */
  loadRunJobs: (slug: string, runId: number) => Promise<void>;
  /**
   * Pin (or, with null, release) the clock the metrics window is measured from. Demo mode
   * pins it to the fixture clock so a dated fixture fleet never rots out of the window.
   */
  setClock: (clock: (() => string) | null) => void;
}

export function createFleetOpsStore(
  storage: StorageLike | null,
  // Injectable clock. Every other engine here takes its `now` (see metrics.ts
  // `opts.nowIso`); this is the one place that used to read the wall clock, which
  // is why a dated-fixture test rotted out of the metrics window and went red.
  defaultNow: () => string = () => new Date().toISOString(),
) {
  let clock = defaultNow;
  const now = (): string => clock();
  const persist = (state: Pick<FleetOpsState, 'roster' | 'hubSlug' | 'windowDays'>) => {
    try {
      storage?.setItem(
        FLEETOPS_KEY,
        JSON.stringify({
          roster: state.roster,
          hubSlug: state.hubSlug,
          windowDays: state.windowDays,
        }),
      );
    } catch {
      /* storage full/unavailable — roster becomes session-only */
    }
  };

  return create<FleetOpsState>((set, get) => {
    // Every maintenance action shares one shape: flag the button busy, call the client,
    // then re-scan so the board reflects reality; a failure surfaces as the store error.
    const runAction = async (
      slug: string,
      action: string,
      fn: () => Promise<void>,
    ): Promise<void> => {
      const key = busyKey(slug, action);
      set({ actionBusy: { ...get().actionBusy, [key]: true }, error: null });
      try {
        await fn();
        await get().scanRepo(slug);
      } catch (e) {
        set({ error: errMessage(e) });
      } finally {
        set({ actionBusy: { ...get().actionBusy, [key]: false } });
      }
    };

    return {
    ...loadPersisted(storage),
    snapshots: {},
    scanning: false,
    progress: null,
    rateRemaining: null,
    error: null,
    filedWorkOrders: {},
    actionBusy: {},
    fleetMetrics: [],
    totals: null,
    byType: [],

    addRepos: (text) => {
      const incoming = parseRosterText(text);
      if (incoming.length === 0) return;
      const roster = mergeRoster(get().roster, incoming);
      set({ roster });
      persist({ ...get(), roster });
    },

    removeRepo: (slug) => {
      const roster = get().roster.filter((e) => e.slug.toLowerCase() !== slug.toLowerCase());
      const snapshots = { ...get().snapshots };
      delete snapshots[slug];
      set({ roster, snapshots, ...deriveViews(snapshots, get().windowDays, now()) });
      persist({ ...get(), roster });
    },

    importFromHub: async (hub) => {
      const { client } = useGithubStore.getState();
      if (!client) {
        set({ error: 'Connect with a token first — the roster import reads the hub repo.' });
        return false;
      }
      const ref = parseRepo(hub);
      if (!ref) {
        set({ error: `Bad hub "${hub}" — expected owner/name.` });
        return false;
      }
      set({ error: null });
      try {
        const file = await client.getFile(ref, '.gitmodules');
        if (!file) {
          set({ error: `${hub} has no .gitmodules — not a submodule hub.` });
          return false;
        }
        const incoming = parseGitmodules(file.content);
        if (incoming.length === 0) {
          set({ error: `${hub}/.gitmodules lists no GitHub submodules.` });
          return false;
        }
        const roster = mergeRoster(get().roster, incoming);
        set({ roster, hubSlug: hub });
        persist({ ...get(), roster, hubSlug: hub });
        return true;
      } catch (e) {
        set({ error: errMessage(e) });
        return false;
      }
    },

    setWindowDays: (days) => {
      const windowDays = Math.min(90, Math.max(1, Math.round(days)));
      set({ windowDays, ...deriveViews(get().snapshots, windowDays, now()) });
      persist({ ...get(), windowDays });
    },

    scanRepo: async (slug) => {
      const { client } = useGithubStore.getState();
      if (!client) {
        set({ error: 'Connect with a token first — scanning reads each repo via the session client.' });
        return;
      }
      const ref = parseRepo(slug);
      if (!ref) return;
      const prev = get().snapshots[slug] ?? emptySnapshot(slug);
      set({ snapshots: { ...get().snapshots, [slug]: { ...prev, status: 'loading', error: null } } });
      try {
        const [deep, workflowStates, variables, poll] = await Promise.all([
          importFleetDeep(client, ref),
          client.listRepoWorkflows(ref),
          client.listVariables(ref),
          client.listFactoryRuns(ref, {
            etag: prev.etag,
            pathPrefix: '.github/workflows/',
            perPage: 100,
          }),
        ]);
        const runs = poll.notModified ? prev.runs : poll.runs;
        const states: Record<string, string> = {};
        for (const w of workflowStates) {
          if (!w.path.startsWith('dynamic/')) states[w.path] = w.state;
        }
        const snapshot: RepoSnapshot = {
          slug,
          status: 'ready',
          error: null,
          fleet: deep.fleet,
          facts: deep.facts,
          audit: auditRepo(deep.facts, { workflowStates: states }),
          workflowStates,
          variables,
          runs,
          jobsByRun: {},
          etag: poll.notModified ? prev.etag : poll.etag,
          scannedAt: Date.now(),
        };
        const snapshots = { ...get().snapshots, [slug]: snapshot };
        set({
          snapshots,
          rateRemaining: poll.rateRemaining ?? get().rateRemaining,
          ...deriveViews(snapshots, get().windowDays, now()),
        });
      } catch (e) {
        const snapshots = {
          ...get().snapshots,
          [slug]: { ...prev, status: 'error' as const, error: errMessage(e) },
        };
        set({ snapshots });
      }
    },

    scanFleet: async () => {
      const slugs = get().roster.map((e) => e.slug);
      if (slugs.length === 0 || get().scanning) return;
      set({ scanning: true, progress: { done: 0, total: slugs.length }, error: null });
      // Small worker pool: bounded parallelism keeps a 40-repo sweep quick without
      // bursting the API (each repo costs a listDir + per-file reads + 2 list calls).
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < slugs.length) {
          const slug = slugs[next];
          next += 1;
          await get().scanRepo(slug);
          const p = get().progress;
          set({ progress: { done: (p?.done ?? 0) + 1, total: slugs.length } });
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(SCAN_CONCURRENCY, slugs.length) }, () => worker()),
      );
      set({ scanning: false, progress: null });
    },

    fileWorkOrder: async (slug, key, title, body) => {
      const { client } = useGithubStore.getState();
      if (!client) {
        set({ error: 'Connect with a token first.' });
        return null;
      }
      const ref = parseRepo(slug);
      if (!ref) return null;
      try {
        // Marker mirrors the fleet's actions-review dedup convention so a future
        // sweep (or a human) can find and reconcile filed work orders.
        const marked = `<!-- gitorio-fleet-audit key="${key}" -->\n\n${body}`;
        const url = await client.createIssue(ref, {
          title,
          body: marked,
          labels: ['gitorio-audit'],
        });
        set({ filedWorkOrders: { ...get().filedWorkOrders, [key]: url } });
        return url;
      } catch (e) {
        set({ error: errMessage(e) });
        return null;
      }
    },

    rerunLatestFailed: async (slug, path) => {
      const { client } = useGithubStore.getState();
      if (!client) {
        set({ error: NO_CLIENT });
        return;
      }
      const ref = parseRepo(slug);
      if (!ref) return;
      const failed = newestFailedRun(get().snapshots[slug]?.runs ?? [], path);
      if (!failed) {
        // Nothing to re-run — clear any stale error rather than acting on a healthy line.
        set({ error: null });
        return;
      }
      await runAction(slug, 'rerun', () => client.rerunRun(ref, failed.runId));
    },

    dispatchWorkflowFile: async (slug, file) => {
      const { client } = useGithubStore.getState();
      if (!client) {
        set({ error: NO_CLIENT });
        return;
      }
      const ref = parseRepo(slug);
      if (!ref) return;
      await runAction(slug, 'dispatch', () => client.dispatchWorkflow(ref, file));
    },

    cancelRunById: async (slug, runId) => {
      const { client } = useGithubStore.getState();
      if (!client) {
        set({ error: NO_CLIENT });
        return;
      }
      const ref = parseRepo(slug);
      if (!ref) return;
      await runAction(slug, 'cancel', () => client.cancelRun(ref, runId));
    },

    setKillSwitch: async (slug, varName, on) => {
      const { client } = useGithubStore.getState();
      if (!client) {
        set({ error: NO_CLIENT });
        return;
      }
      const ref = parseRepo(slug);
      if (!ref) return;
      // Arms/disarms the vars.*_ENABLED gate (the fleet convention) — distinct from
      // disabling the workflow file itself; a disarmed line still exists, just short-circuits.
      await runAction(slug, `kill:${varName}`, () =>
        client.setVariable(ref, varName, on ? 'true' : 'false'),
      );
    },

    setWorkflowEnabledById: async (slug, workflowId, enabled) => {
      const { client } = useGithubStore.getState();
      if (!client) {
        set({ error: NO_CLIENT });
        return;
      }
      const ref = parseRepo(slug);
      if (!ref) return;
      await runAction(slug, `enable:${workflowId}`, () =>
        client.setWorkflowEnabled(ref, workflowId, enabled),
      );
    },

    setClock: (next) => {
      clock = next ?? defaultNow;
      set({ ...deriveViews(get().snapshots, get().windowDays, now()) });
    },
    loadRunJobs: async (slug, runId) => {
      const { client } = useGithubStore.getState();
      if (!client) {
        set({ error: NO_CLIENT });
        return;
      }
      const ref = parseRepo(slug);
      if (!ref) return;
      const snap = get().snapshots[slug];
      if (!snap || snap.jobsByRun[runId]) return; // absent snapshot or already cached
      const setJobs = (v: RunJob[] | 'loading'): void => {
        const cur = get().snapshots[slug];
        if (!cur) return;
        set({
          snapshots: {
            ...get().snapshots,
            [slug]: { ...cur, jobsByRun: { ...cur.jobsByRun, [runId]: v } },
          },
        });
      };
      setJobs('loading');
      try {
        setJobs(await client.listRunJobs(ref, runId));
      } catch (e) {
        // Clear the cache entry (don't leave []) so the guard above lets a later click retry —
        // a cached [] would masquerade as "No jobs." forever after a transient failure.
        const cur = get().snapshots[slug];
        if (cur) {
          const rest = { ...cur.jobsByRun };
          delete rest[runId];
          set({ snapshots: { ...get().snapshots, [slug]: { ...cur, jobsByRun: rest } } });
        }
        set({ error: errMessage(e) });
      }
    },
    };
  });
}

export const useFleetOpsStore = createFleetOpsStore(
  typeof localStorage !== 'undefined' ? localStorage : null,
);

// Dev-only: lets a smoke test seed a demo fleet (roster + snapshots + derived views)
// from the console without a PAT — the tokenless-UI-smoke pattern from ADR-011's
// __fleetStore. Stripped from prod builds.
if (import.meta.env.DEV) {
  (globalThis as unknown as { __fleetOpsStore?: typeof useFleetOpsStore }).__fleetOpsStore =
    useFleetOpsStore;
}
