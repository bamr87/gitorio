import { create } from 'zustand';
import { connectWithPat } from '../github/client';
import type { DriftItem, GithubClient, Preflight, RepoRef } from '../github/types';
import { GithubError, parseRepo, repoSlug } from '../github/types';
import { BLUEPRINT_PATH, detectDrift } from '../github/deploy';
import { gatherRepoState } from '../github/execute';
import { useFactoryStore } from './store';
import type { Blueprint } from '../blueprint/types';

// PAT persistence: sessionStorage ONLY (CLAUDE.md golden rule #7). Tab-scoped, wiped on
// disconnect. The repo slug is not a secret, so it rides along for reconnect-on-reload.
const TOKEN_KEY = 'gitfactory.pat';
const REPO_KEY = 'gitfactory.repo';

export type Power = 'on' | 'off' | 'unknown';

function errMessage(e: unknown): string {
  if (e instanceof GithubError) {
    if (e.status === 401) return 'Token rejected (401). Check the PAT is valid and not expired.';
    if (e.status === 404) return 'Repo not found (404), or the token cannot see it.';
    return `${e.message} (HTTP ${e.status})`;
  }
  return e instanceof Error ? e.message : String(e);
}

interface GithubState {
  client: GithubClient | null;
  login: string | null;
  repo: RepoRef | null;
  preflight: Preflight | null;
  power: Power;
  connecting: boolean;
  error: string | null;
  /** Deployed factory workflows that no longer match the canvas blueprint's hash. */
  drift: DriftItem[];

  connect: (token: string, repoInput: string) => Promise<boolean>;
  disconnect: () => void;
  restore: () => void;
  setPower: (p: Power) => void;
  /** Fetch .factory/blueprint.json into the canvas and recompute drift. */
  loadFactory: () => Promise<boolean>;
  clearDrift: () => void;
}

export const useGithubStore = create<GithubState>((set, get) => ({
  client: null,
  login: null,
  repo: null,
  preflight: null,
  power: 'unknown',
  connecting: false,
  error: null,
  drift: [],

  connect: async (token, repoInput) => {
    const repo = parseRepo(repoInput);
    if (!token.trim()) {
      set({ error: 'Paste a fine-grained personal access token.' });
      return false;
    }
    if (!repo) {
      set({ error: 'Enter a repository as owner/name.' });
      return false;
    }
    set({ connecting: true, error: null });
    try {
      const client = await connectWithPat(token.trim());
      const preflight = await client.preflight(repo);
      let power: Power = 'unknown';
      try {
        power = (await client.hasSecret(repo, 'ANTHROPIC_API_KEY')) ? 'on' : 'off';
      } catch {
        power = 'unknown';
      }
      sessionStorage.setItem(TOKEN_KEY, token.trim());
      sessionStorage.setItem(REPO_KEY, repoSlug(repo));
      set({ client, login: client.login, repo, preflight, power, connecting: false, error: null, drift: [] });
      return true;
    } catch (e) {
      set({ connecting: false, error: errMessage(e) });
      return false;
    }
  },

  disconnect: () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REPO_KEY);
    set({ client: null, login: null, repo: null, preflight: null, power: 'unknown', error: null, drift: [] });
  },

  loadFactory: async () => {
    const { client, repo } = get();
    if (!client || !repo) return false;
    set({ error: null });
    try {
      const file = await client.getFile(repo, BLUEPRINT_PATH);
      if (!file) {
        set({ error: `No ${BLUEPRINT_PATH} in ${repoSlug(repo)} yet — deploy will create it.` });
        return false;
      }
      const bp = JSON.parse(file.content) as Blueprint;
      useFactoryStore.getState().loadBlueprint(bp);
      const state = await gatherRepoState(client, repo);
      set({ drift: detectDrift(state.workflowFiles, bp).filter((d) => d.drifted) });
      return true;
    } catch (e) {
      set({ error: errMessage(e) });
      return false;
    }
  },

  clearDrift: () => set({ drift: [] }),

  restore: () => {
    if (get().client) return;
    const token = sessionStorage.getItem(TOKEN_KEY);
    const repo = sessionStorage.getItem(REPO_KEY);
    if (token && repo) {
      void get().connect(token, repo);
      return;
    }
    // Dev-only convenience: auto-connect from .env for local testing. Guarded by
    // import.meta.env.DEV so the whole branch (and any inlined VITE_GH_PAT value) is
    // dead-code-eliminated from production builds; vite.config also refuses to `build`
    // if a secret VITE_ var is set. The token still only ever lands in sessionStorage.
    if (import.meta.env.DEV) {
      const envPat = import.meta.env.VITE_GH_PAT;
      const envRepo = import.meta.env.VITE_GH_REPO;
      if (envPat && envRepo) {
        // eslint-disable-next-line no-console
        console.warn('[gitfactory] dev auto-connect from VITE_GH_PAT (.env) — never ship a build with this set.');
        void get().connect(envPat, envRepo);
      }
    }
  },

  setPower: (power) => set({ power }),
}));
