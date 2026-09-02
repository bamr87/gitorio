// The hub source (specs/014, FR-4): the Jekyll monorepo that presents and monitors the
// harness — `bamr87/bamr87` by default. GitFactory reads what the hub commits (`_data/*.yml`,
// `fleet.manifest.yml`, the fleet-pulse schedule) through the session client and never
// writes to it. Persisted: the hub slug only (golden rule #7). A refresh is eight reads, on
// demand — no polling — done by `harness/hubread.ts`, loaded lazily so the engine stays out of
// the first paint. The committed health file is re-derived in-app by the ported engine over
// the same committed signals, so the tab can say "matches the hub" and mean it.

import { create } from 'zustand';
import { parseRepo, repoSlug } from '../github/types';
import type { HarnessConfig, HarnessHealth, HarnessSignals, SignalName } from '../harness/health';
import type { FleetManifest } from '../harness/lanes';
import { useGithubStore } from './github';

export const HUB_KEY = 'gitfactory.hub.v1';
export const DEFAULT_HUB = 'bamr87/bamr87';

/** What the hub commits and GitFactory reads. */
export const HUB_PATHS = {
  config: '_data/fleet.yml',
  health: '_data/harness_health.yml',
  manifest: 'fleet.manifest.yml',
  pulse: '.github/workflows/fleet-pulse.yml',
} as const;
export const signalPath = (name: SignalName): string => `_data/${name}.yml`;

/** The hub's five archify diagrams, as its /harness/ page lists them. */
export const HUB_DIAGRAMS: { file: string; title: string }[] = [
  { file: 'harness-layers.architecture', title: 'The six layers, mapped onto the hub' },
  { file: 'fleet-pulse.workflow', title: 'fleet-pulse.yml — the daily loop' },
  { file: 'fleet-signals.dataflow', title: 'Fleet signals — from GitHub to the alarm panel' },
  { file: 'issue-pipeline.lifecycle', title: 'issue-pipeline.yml — labels as state' },
  {
    file: 'repo-evolution.sequence',
    title: 'repo-evolution.yml — a draft PR into a submodule’s own upstream',
  },
];

/** The hub's Pages URL for a path (`/harness/` by default); a user site drops the repo segment. */
export function hubPagesUrl(slug: string, path = '/harness/'): string | null {
  const ref = parseRepo(slug);
  if (!ref) return null;
  const site = `${ref.owner.toLowerCase()}.github.io`;
  const base = ref.repo.toLowerCase() === site ? `https://${site}` : `https://${site}/${ref.repo}`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
export const hubDiagramUrl = (slug: string, file: string): string | null =>
  hubPagesUrl(slug, `/diagrams/${file}.html`);
export const hubFileUrl = (slug: string, path: string): string =>
  `https://github.com/${slug}/blob/main/${path}`;

export interface ParityDiff {
  where: string;
  committed: string;
  recomputed: string;
}

export interface HubSnapshot {
  slug: string;
  fetchedAt: string;
  /** The hub's `_data/fleet.yml` → `harness:` thresholds (its defaults when the file is absent). */
  config: HarnessConfig;
  /** The health file the hub committed, or null when it has not published one. */
  committed: HarnessHealth | null;
  /** The same engine run in-app over the hub's committed signals, at the committed stamp. */
  recomputed: HarnessHealth;
  /** Where the committed file and the in-app recomputation disagree (empty = parity). */
  parity: ParityDiff[];
  signals: HarnessSignals;
  /** Which hub files were found, by path. */
  found: Record<string, boolean>;
  manifest: FleetManifest | null;
  /** The fleet-pulse cron (the hub's daily loop), when its workflow file was readable. */
  pulseCron: string | null;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function loadPersisted(storage: StorageLike | null): string {
  if (!storage) return DEFAULT_HUB;
  try {
    const raw = storage.getItem(HUB_KEY);
    if (!raw) return DEFAULT_HUB;
    const parsed = JSON.parse(raw) as { hubSlug?: unknown };
    const ref = typeof parsed.hubSlug === 'string' ? parseRepo(parsed.hubSlug) : null;
    return ref ? repoSlug(ref) : DEFAULT_HUB;
  } catch {
    return DEFAULT_HUB;
  }
}

export interface HubState {
  hubSlug: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  snapshot: HubSnapshot | null;
  /** Point at another hub. `persist: false` is a session-only override (a `?hub=` link, the demo). */
  setHubSlug: (slug: string, opts?: { persist?: boolean }) => boolean;
  /** Back to the persisted hub (leaving the demo). */
  restorePersisted: () => void;
  /** Read the hub through the session client. */
  refresh: () => Promise<boolean>;
}

export function createHubStore(storage: StorageLike | null, now: () => Date = () => new Date()) {
  const persist = (hubSlug: string) => {
    try {
      storage?.setItem(HUB_KEY, JSON.stringify({ hubSlug }));
    } catch {
      /* storage full/unavailable — the hub becomes session-only */
    }
  };
  return create<HubState>((set, get) => ({
    hubSlug: loadPersisted(storage),
    status: 'idle',
    error: null,
    snapshot: null,

    setHubSlug: (slug, opts = {}) => {
      const ref = parseRepo(slug);
      if (!ref) return false;
      const normalized = repoSlug(ref);
      if (normalized !== get().hubSlug) {
        set({ hubSlug: normalized, status: 'idle', error: null, snapshot: null });
      }
      if (opts.persist !== false) persist(normalized);
      return true;
    },

    restorePersisted: () => {
      const hubSlug = loadPersisted(storage);
      if (hubSlug !== get().hubSlug || get().snapshot) {
        set({ hubSlug, status: 'idle', error: null, snapshot: null });
      }
    },

    refresh: async () => {
      const { client } = useGithubStore.getState();
      if (!client) {
        set({ status: 'error', error: 'Connect with a token first — the hub is read through the session client.' });
        return false;
      }
      const slug = get().hubSlug;
      const ref = parseRepo(slug);
      if (!ref) {
        set({ status: 'error', error: `Bad hub "${slug}" — expected owner/name.` });
        return false;
      }
      set({ status: 'loading', error: null });
      try {
        const { readHub } = await import('../harness/hubread');
        const snapshot = await readHub(client, ref, now());
        // The slug moved while the read was in flight: that read is stale, drop it.
        if (get().hubSlug !== slug) return false;
        set({ status: 'ready', snapshot, error: null });
        return true;
      } catch (e) {
        set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
  }));
}

export const useHubStore = createHubStore(typeof localStorage !== 'undefined' ? localStorage : null);
