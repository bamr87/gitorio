import { create } from 'zustand';
import { assemblyLines } from '../compiler/compile';
import { dashboardStats, statusBySlug, type DashboardStats } from '../github/telemetry';
import type { FactoryRun, LedState } from '../github/types';
import { useGithubStore } from './github';
import { useFactoryStore } from './store';

// "Real-time" = polite polling with ETag conditional requests (ARCHITECTURE §6). A 304
// costs no rate quota, so a tight-ish interval stays cheap.
const POLL_MS = 15_000;
let timer: ReturnType<typeof setInterval> | null = null;

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface TelemetryState {
  runs: FactoryRun[];
  /** LED per machine node id, derived from its assembly line's latest run. */
  statusByNode: Record<string, LedState>;
  stats: DashboardStats | null;
  etag: string | null;
  polling: boolean;
  lastPolledAt: number | null;
  error: string | null;

  poll: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  runs: [],
  statusByNode: {},
  stats: null,
  etag: null,
  polling: false,
  lastPolledAt: null,
  error: null,

  poll: async () => {
    const { client, repo } = useGithubStore.getState();
    if (!client || !repo) {
      get().stop();
      return;
    }
    try {
      const res = await client.listFactoryRuns(repo, { etag: get().etag });
      if (res.notModified) {
        set({ lastPolledAt: Date.now(), error: null });
        return;
      }
      const bp = useFactoryStore.getState().toBlueprint();
      const bySlug = statusBySlug(res.runs);
      const statusByNode: Record<string, LedState> = {};
      for (const line of assemblyLines(bp)) {
        const led = bySlug.get(line.slug) ?? 'idle';
        for (const id of line.nodeIds) statusByNode[id] = led;
      }
      set({
        runs: res.runs,
        statusByNode,
        stats: dashboardStats(res.runs),
        etag: res.etag,
        lastPolledAt: Date.now(),
        error: null,
      });
    } catch (e) {
      set({ error: errMessage(e) });
    }
  },

  start: () => {
    if (get().polling) return;
    set({ polling: true });
    void get().poll();
    timer = setInterval(() => void get().poll(), POLL_MS);
  },

  stop: () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (get().polling) set({ polling: false });
  },
}));
