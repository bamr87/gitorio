// Monitor tab store: the operations console. Polls factory runs (ETag-conditional, like
// state/telemetry.ts), caches per-run job drill-downs, and drives the dispatch/cancel
// controls. All GitHub I/O lives here; the panel stays declarative. Polling runs only while
// the tab is mounted (rate hygiene, ARCHITECTURE §6).

import { create } from 'zustand';
import { dashboardStats, type DashboardStats } from '../github/telemetry';
import type { FactoryRun, RunJob } from '../github/types';
import { useGithubStore } from './github';

let timer: ReturnType<typeof setInterval> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface MonitorState {
  runs: FactoryRun[];
  etag: string | null;
  stats: DashboardStats | null;
  polling: boolean;
  lastPolledAt: number | null;
  error: string | null;
  /** Lazy per-run job cache: 'loading' while in flight, then the jobs array. */
  jobsByRun: Record<number, RunJob[] | 'loading'>;
  expandedRunId: number | null;
  /** null = all lines; otherwise a single line slug. */
  filterSlug: string | null;
  /** Transient toast (e.g. "dispatched ✓"), cleared on the next poll. */
  flash: string | null;

  start: (pollMs: number) => void;
  stop: () => void;
  poll: () => Promise<void>;
  expand: (runId: number) => Promise<void>;
  dispatch: (workflowFile: string) => Promise<void>;
  cancel: (runId: number) => Promise<void>;
  setFilter: (slug: string | null) => void;
}

export const useMonitorStore = create<MonitorState>((set, get) => ({
  runs: [],
  etag: null,
  stats: null,
  polling: false,
  lastPolledAt: null,
  error: null,
  jobsByRun: {},
  expandedRunId: null,
  filterSlug: null,
  flash: null,

  poll: async () => {
    const { client, repo } = useGithubStore.getState();
    if (!client || !repo) {
      get().stop();
      return;
    }
    try {
      const res = await client.listFactoryRuns(repo, { etag: get().etag, perPage: 50 });
      if (res.notModified) {
        set({ lastPolledAt: Date.now(), error: null });
        return;
      }
      set({
        runs: res.runs,
        etag: res.etag,
        stats: dashboardStats(res.runs),
        lastPolledAt: Date.now(),
        error: null,
      });
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  start: (pollMs) => {
    if (get().polling) return;
    set({ polling: true });
    void get().poll();
    timer = setInterval(() => void get().poll(), Math.max(5_000, pollMs));
  },

  stop: () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (get().polling) set({ polling: false });
  },

  expand: async (runId) => {
    // Toggle: clicking an expanded run collapses it.
    if (get().expandedRunId === runId) {
      set({ expandedRunId: null });
      return;
    }
    set({ expandedRunId: runId });
    if (get().jobsByRun[runId]) return; // cached (array or 'loading')
    const { client, repo } = useGithubStore.getState();
    if (!client || !repo) return;
    set((s) => ({ jobsByRun: { ...s.jobsByRun, [runId]: 'loading' } }));
    try {
      const jobs = await client.listRunJobs(repo, runId);
      set((s) => ({ jobsByRun: { ...s.jobsByRun, [runId]: jobs } }));
    } catch (e) {
      set((s) => ({ jobsByRun: { ...s.jobsByRun, [runId]: [] }, error: errMessage(e) }));
    }
  },

  dispatch: async (workflowFile) => {
    const { client, repo } = useGithubStore.getState();
    if (!client || !repo) return;
    try {
      await client.dispatchWorkflow(repo, workflowFile);
      set({ flash: `Dispatched ${workflowFile} ✓`, error: null });
      // A dispatched run takes a moment to appear — re-poll shortly.
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void get().poll(), 3_000);
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  cancel: async (runId) => {
    const { client, repo } = useGithubStore.getState();
    if (!client || !repo) return;
    try {
      await client.cancelRun(repo, runId);
      set({ flash: `Cancel requested for run ${runId}`, error: null });
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void get().poll(), 3_000);
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  setFilter: (slug) => set({ filterSlug: slug }),
}));
