// Content cockpit store (ADR-017): the headless-CMS control surface.
//   • central config  (.factory/config.yml)  — model/budget/voice/paths the agents honor
//   • content backlog (.factory/backlog.yml)  — the work queue the writer pulls from
//   • kill switches — the gate.enablement repo variables that arm/disarm each line
// All GitHub I/O lives here. Writes go through a PR by default (like Prompt Studio) except the
// kill-switch toggles, which set a repo variable directly (instant, no redeploy — the point).

import { create } from 'zustand';
import { useGithubStore } from './github';
import { useFactoryStore } from './store';
import {
  BACKLOG_PATH,
  CONFIG_PATH,
  defaultConfig,
  parseBacklog,
  parseConfig,
  serializeBacklog,
  serializeConfig,
  slugId,
  type BacklogItem,
  type FactoryConfig,
} from '../content/model';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const stamp = () => Date.now().toString(36).slice(-5);

/** One enablement-gate variable and its live state. `known:false` = the variable isn't set yet. */
export interface KillSwitch {
  variable: string;
  on: boolean;
  known: boolean;
  busy: boolean;
}

type Mode = 'pr' | 'commit';

interface ContentState {
  loading: boolean;
  error: string | null;
  saving: boolean;
  prUrl: string | null;
  mode: Mode;

  config: FactoryConfig;
  configSha: string | null;
  backlog: BacklogItem[];
  backlogSha: string | null;
  switches: KillSwitch[];

  refresh: () => Promise<void>;
  setMode: (m: Mode) => void;
  clearPr: () => void;

  setConfig: (patch: Partial<FactoryConfig>) => void;
  saveConfig: () => Promise<void>;

  addBacklogItem: () => void;
  updateBacklogItem: (id: string, patch: Partial<BacklogItem>) => void;
  removeBacklogItem: (id: string) => void;
  saveBacklog: () => Promise<void>;

  toggleSwitch: (variable: string) => Promise<void>;
}

/** Enablement-gate variables referenced by the current blueprint, deduped + in a stable order. */
function blueprintSwitchVars(): string[] {
  const bp = useFactoryStore.getState().toBlueprint();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of bp.nodes) {
    if (n.type !== 'gate.enablement') continue;
    const v = typeof n.config.variable === 'string' ? n.config.variable.trim() : '';
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export const useContentStore = create<ContentState>((set, get) => ({
  loading: false,
  error: null,
  saving: false,
  prUrl: null,
  mode: 'pr',

  config: defaultConfig(),
  configSha: null,
  backlog: [],
  backlogSha: null,
  switches: [],

  refresh: async () => {
    const { client, repo } = useGithubStore.getState();
    if (!client || !repo) return;
    set({ loading: true, error: null, prUrl: null });
    try {
      const [cfgFile, backlogFile, repoVars] = await Promise.all([
        client.getFile(repo, CONFIG_PATH),
        client.getFile(repo, BACKLOG_PATH),
        client.listVariables(repo),
      ]);
      const byName = new Map((repoVars ?? []).map((v) => [v.name, v.value]));
      const switches: KillSwitch[] = blueprintSwitchVars().map((variable) => ({
        variable,
        on: byName.get(variable) === 'true',
        known: byName.has(variable),
        busy: false,
      }));
      set({
        config: cfgFile ? parseConfig(cfgFile.content) : defaultConfig(),
        configSha: cfgFile?.sha ?? null,
        backlog: backlogFile ? parseBacklog(backlogFile.content) : [],
        backlogSha: backlogFile?.sha ?? null,
        switches,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: errMessage(e) });
    }
  },

  setMode: (mode) => set({ mode }),
  clearPr: () => set({ prUrl: null }),

  setConfig: (patch) => set({ config: { ...get().config, ...patch } }),

  saveConfig: async () => {
    await writeFile(get, set, {
      path: CONFIG_PATH,
      content: serializeConfig(get().config),
      sha: get().configSha,
      branchHint: 'content-config',
      message: 'content: update .factory/config.yml',
      onCommitted: (sha) => set({ configSha: sha }),
    });
  },

  addBacklogItem: () => {
    const items = get().backlog;
    const item: BacklogItem = {
      id: slugId('new item', items.length + 1),
      kind: 'post',
      title: '',
      brief: '',
      priority: 'normal',
      status: 'todo',
    };
    set({ backlog: [...items, item] });
  },

  updateBacklogItem: (id, patch) =>
    set({ backlog: get().backlog.map((it) => (it.id === id ? { ...it, ...patch } : it)) }),

  removeBacklogItem: (id) => set({ backlog: get().backlog.filter((it) => it.id !== id) }),

  saveBacklog: async () => {
    // Drop rows the user never titled so we never persist empty work items.
    const items = get().backlog.filter((it) => it.title.trim() !== '');
    await writeFile(get, set, {
      path: BACKLOG_PATH,
      content: serializeBacklog(items),
      sha: get().backlogSha,
      branchHint: 'content-backlog',
      message: 'content: update .factory/backlog.yml',
      onCommitted: (sha) => set({ backlog: items, backlogSha: sha }),
    });
  },

  toggleSwitch: async (variable) => {
    const { client, repo } = useGithubStore.getState();
    if (!client || !repo) return;
    const current = get().switches.find((s) => s.variable === variable);
    const next = !(current?.on ?? false);
    set({
      error: null,
      switches: get().switches.map((s) => (s.variable === variable ? { ...s, busy: true } : s)),
    });
    try {
      await client.setVariable(repo, variable, next ? 'true' : 'false');
      set({
        switches: get().switches.map((s) =>
          s.variable === variable ? { ...s, on: next, known: true, busy: false } : s,
        ),
      });
    } catch (e) {
      set({
        error: errMessage(e),
        switches: get().switches.map((s) => (s.variable === variable ? { ...s, busy: false } : s)),
      });
    }
  },
}));

/** Shared PR-or-commit write for the config + backlog files (mirrors Prompt Studio). */
async function writeFile(
  get: () => ContentState,
  set: (partial: Partial<ContentState>) => void,
  args: {
    path: string;
    content: string;
    sha: string | null;
    branchHint: string;
    message: string;
    onCommitted: (sha: string | null) => void;
  },
): Promise<void> {
  const { client, repo } = useGithubStore.getState();
  if (!client || !repo) return;
  set({ saving: true, error: null, prUrl: null });
  try {
    if (get().mode === 'commit') {
      await client.putFile(repo, args.path, args.content, args.message, args.sha ? { sha: args.sha } : undefined);
      // The blob sha changes on a direct commit; re-read it lazily on the next refresh.
      args.onCommitted(null);
      set({ saving: false });
    } else {
      const base = await client.getDefaultBranch(repo);
      const branch = `factory/${args.branchHint}-${stamp()}`;
      await client.createBranch(repo, branch, base);
      await client.putFile(repo, args.path, args.content, args.message, {
        branch,
        ...(args.sha ? { sha: args.sha } : {}),
      });
      const prUrl = await client.createPullRequest(repo, {
        title: args.message,
        head: branch,
        base,
        body: `Updates \`${args.path}\` via the Content cockpit.`,
      });
      // The change lives on a branch; the base file (and its sha) is unchanged until merge.
      args.onCommitted(args.sha);
      set({ saving: false, prUrl });
    }
  } catch (e) {
    set({ saving: false, error: errMessage(e) });
  }
}
