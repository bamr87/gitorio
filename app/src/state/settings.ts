// User preferences + connection history, persisted to localStorage. NEVER tokens — the
// PAT stays in sessionStorage only (golden rule #7); here we persist repo *slugs* and
// harmless preferences. `createSettingsStore(storage)` exists so tests can inject a fake
// storage; the app uses the singleton `useSettingsStore`.

import { create } from 'zustand';

export interface SettingsValues {
  /** Recently connected repo slugs (owner/name), newest first. Slugs only — never tokens. */
  recentRepos: string[];
  /** Preselect for the Deploy modal. */
  defaultDeployMode: 'pr' | 'commit';
  /** Telemetry poll interval (ms). */
  pollMs: number;
  /** Default model prefilled on new Claude-agent machines. */
  defaultModel: string;
  /** UI theme: follow the OS, or pin one (specs/011 — light is a peer, dark is archify's default). */
  theme: ThemePref;
}

export type ThemePref = 'system' | 'dark' | 'light';
const THEMES: ThemePref[] = ['system', 'dark', 'light'];

export interface SettingsState extends SettingsValues {
  addRecentRepo: (slug: string) => void;
  removeRecentRepo: (slug: string) => void;
  setDefaultDeployMode: (m: 'pr' | 'commit') => void;
  setPollMs: (ms: number) => void;
  setDefaultModel: (model: string) => void;
  setTheme: (theme: ThemePref) => void;
}

export const SETTINGS_KEY = 'gitfactory.settings.v1';
const MAX_RECENT = 8;

const DEFAULTS: SettingsValues = {
  recentRepos: [],
  defaultDeployMode: 'pr',
  pollMs: 15_000,
  defaultModel: 'claude-sonnet-4-6',
  theme: 'system',
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function load(storage: StorageLike | null): SettingsValues {
  if (!storage) return { ...DEFAULTS };
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SettingsValues>;
    return {
      recentRepos: Array.isArray(parsed.recentRepos)
        ? parsed.recentRepos.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENT)
        : DEFAULTS.recentRepos,
      defaultDeployMode: parsed.defaultDeployMode === 'commit' ? 'commit' : 'pr',
      pollMs:
        typeof parsed.pollMs === 'number' && parsed.pollMs >= 5_000 && parsed.pollMs <= 120_000
          ? parsed.pollMs
          : DEFAULTS.pollMs,
      defaultModel:
        typeof parsed.defaultModel === 'string' && parsed.defaultModel
          ? parsed.defaultModel
          : DEFAULTS.defaultModel,
      theme: THEMES.includes(parsed.theme as ThemePref)
        ? (parsed.theme as ThemePref)
        : DEFAULTS.theme,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function createSettingsStore(storage: StorageLike | null) {
  const persist = (values: SettingsValues) => {
    try {
      storage?.setItem(SETTINGS_KEY, JSON.stringify(values));
    } catch {
      /* storage full/unavailable — settings become session-only */
    }
  };
  return create<SettingsState>((set, get) => {
    const commit = (patch: Partial<SettingsValues>) => {
      const next = { ...pick(get()), ...patch };
      persist(next);
      set(patch);
    };
    const pick = (s: SettingsState): SettingsValues => ({
      recentRepos: s.recentRepos,
      defaultDeployMode: s.defaultDeployMode,
      pollMs: s.pollMs,
      defaultModel: s.defaultModel,
      theme: s.theme,
    });
    return {
      ...load(storage),
      addRecentRepo: (slug) => {
        const cleaned = slug.trim();
        if (!/^[^/\s]+\/[^/\s]+$/.test(cleaned)) return;
        const rest = get().recentRepos.filter((r) => r !== cleaned);
        commit({ recentRepos: [cleaned, ...rest].slice(0, MAX_RECENT) });
      },
      removeRecentRepo: (slug) =>
        commit({ recentRepos: get().recentRepos.filter((r) => r !== slug) }),
      setDefaultDeployMode: (defaultDeployMode) => commit({ defaultDeployMode }),
      setPollMs: (ms) => commit({ pollMs: Math.min(120_000, Math.max(5_000, Math.round(ms))) }),
      setDefaultModel: (defaultModel) => commit({ defaultModel }),
      setTheme: (theme) => commit({ theme: THEMES.includes(theme) ? theme : 'system' }),
    };
  });
}

export const useSettingsStore = createSettingsStore(
  typeof localStorage !== 'undefined' ? localStorage : null,
);

/** Stamp the preference on <html>: dark/light pin a theme, system removes the attribute. */
export function applyTheme(
  theme: ThemePref,
  root: { dataset: DOMStringMap } = document.documentElement,
): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
