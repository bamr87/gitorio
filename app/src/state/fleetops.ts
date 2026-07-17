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
import type { FactoryRun, RepoVariable, RepoWorkflow } from '../github/types';
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
  /** Repo Actions variables — the kill-switch armed/disarmed readout. */
  variables: RepoVariable[];
  runs: FactoryRun[];
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

function emptySnapshot(slug: string): RepoSnapshot {
  return {
    slug,
    status: 'idle',
    error: null,
    fleet: null,
    facts: [],
    audit: null,
    workflowStates: [],
    variables: [],
    runs: [],
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

function deriveViews(snapshots: Record<string, RepoSnapshot>, windowDays: number): DerivedViews {
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
    nowIso: new Date().toISOString(),
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
}

export function createFleetOpsStore(storage: StorageLike | null) {
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

  return create<FleetOpsState>((set, get) => ({
    ...loadPersisted(storage),
    snapshots: {},
    scanning: false,
    progress: null,
    rateRemaining: null,
    error: null,
    filedWorkOrders: {},
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
      set({ roster, snapshots, ...deriveViews(snapshots, get().windowDays) });
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
      set({ windowDays, ...deriveViews(get().snapshots, windowDays) });
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
          etag: poll.notModified ? prev.etag : poll.etag,
          scannedAt: Date.now(),
        };
        const snapshots = { ...get().snapshots, [slug]: snapshot };
        set({
          snapshots,
          rateRemaining: poll.rateRemaining ?? get().rateRemaining,
          ...deriveViews(snapshots, get().windowDays),
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
  }));
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
