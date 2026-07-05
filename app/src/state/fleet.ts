import { create } from 'zustand';
import { importFleet } from '../fleet/import';
import type { Fleet } from '../fleet/types';
import { ledForRun } from '../github/telemetry';
import { parseRepo, repoSlug, type FactoryRun, type LedState, type RepoRef } from '../github/types';
import { useGithubStore } from './github';

// Observe mode: reverse-import the connected repo's workflow fleet and poll its runs.
// Polling is path-keyed (every workflow, not just factory--*) and follows the view.
const POLL_MS = 15_000;
let timer: ReturnType<typeof setInterval> | null = null;

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Newest run per workflow path. */
function latestByPath(runs: FactoryRun[]): Map<string, FactoryRun> {
  const m = new Map<string, FactoryRun>();
  for (const r of runs) {
    const cur = m.get(r.path);
    if (!cur || r.createdAt > cur.createdAt || (r.createdAt === cur.createdAt && r.runId > cur.runId)) {
      m.set(r.path, r);
    }
  }
  return m;
}

interface FleetState {
  mode: 'author' | 'observe';
  fleet: Fleet | null;
  /** The repo currently being observed — may differ from the connected repo (fleet switcher). */
  observedRepo: RepoRef | null;
  loading: boolean;
  error: string | null;

  runs: FactoryRun[];
  statusByPath: Record<string, LedState>;
  etag: string | null;
  polling: boolean;
  lastPolledAt: number | null;

  /** Import the currently-connected repo's fleet and switch to observe mode. */
  observeCurrentRepo: () => Promise<boolean>;
  /** Observe an arbitrary repo (owner/name) using the connected session's client. */
  observeRepo: (slug: string) => Promise<boolean>;
  exitObserve: () => void;
  poll: () => Promise<void>;
}

export const useFleetStore = create<FleetState>((set, get) => ({
  mode: 'author',
  fleet: null,
  observedRepo: null,
  loading: false,
  error: null,
  runs: [],
  statusByPath: {},
  etag: null,
  polling: false,
  lastPolledAt: null,

  observeCurrentRepo: async () => {
    const { repo } = useGithubStore.getState();
    if (!repo) {
      set({ error: 'Connect a repository first.' });
      return false;
    }
    return get().observeRepo(repoSlug(repo));
  },

  observeRepo: async (slug) => {
    const { client } = useGithubStore.getState();
    if (!client) {
      set({ error: 'Connect with a token first — observing reads the repo via the session client.' });
      return false;
    }
    const target = parseRepo(slug);
    if (!target) {
      set({ error: `Bad repo "${slug}" — expected owner/name.` });
      return false;
    }
    set({ loading: true, error: null });
    try {
      const fleet = await importFleet(client, target);
      set({ fleet, observedRepo: target, mode: 'observe', loading: false, statusByPath: {}, runs: [], etag: null });
      // kick off polling for live status
      if (timer) clearInterval(timer);
      set({ polling: true });
      void get().poll();
      timer = setInterval(() => void get().poll(), POLL_MS);
      return true;
    } catch (e) {
      set({ loading: false, error: errMessage(e) });
      return false;
    }
  },

  exitObserve: () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    set({ mode: 'author', polling: false });
  },

  poll: async () => {
    const { client } = useGithubStore.getState();
    const repo = get().observedRepo;
    if (!client || !repo || get().mode !== 'observe') return;
    try {
      const res = await client.listFactoryRuns(repo, { etag: get().etag, pathPrefix: '.github/workflows/', perPage: 100 });
      if (res.notModified) {
        set({ lastPolledAt: Date.now(), error: null });
        return;
      }
      const latest = latestByPath(res.runs);
      const statusByPath: Record<string, LedState> = {};
      for (const [path, run] of latest) statusByPath[path] = ledForRun(run);
      set({ runs: res.runs, statusByPath, etag: res.etag, lastPolledAt: Date.now(), error: null });
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },
}));

// Dev-only: lets you seed a demo fleet from the console (or a smoke test) without a PAT.
// e.g. window.__fleetStore.setState({ fleet: <Fleet>, mode: 'observe' }). Stripped in prod.
if (import.meta.env.DEV) {
  (globalThis as unknown as { __fleetStore?: typeof useFleetStore }).__fleetStore = useFleetStore;
}
