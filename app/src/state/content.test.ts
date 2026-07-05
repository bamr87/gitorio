import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContentStore } from './content';
import { useGithubStore } from './github';
import { useFactoryStore } from './store';
import type { Blueprint } from '../blueprint/types';

const bpWithGate: Blueprint = {
  version: 1,
  meta: { name: 'CMS' },
  nodes: [
    { id: 't', type: 'trigger.cron', position: { x: 0, y: 0 }, config: { cron: '0 9 * * *' } },
    { id: 'g', type: 'gate.enablement', position: { x: 1, y: 0 }, config: { variable: 'CONTENT_FACTORY_ENABLED' } },
    { id: 'a', type: 'agent.claude', position: { x: 2, y: 0 }, config: { promptRef: 'p.md' } },
    { id: 's', type: 'sink.open_pr', position: { x: 3, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'e1', from: { node: 't', port: 'out' }, to: { node: 'g', port: 'in' } },
    { id: 'e2', from: { node: 'g', port: 'out' }, to: { node: 'a', port: 'in' } },
    { id: 'e3', from: { node: 'a', port: 'out' }, to: { node: 's', port: 'in' } },
  ],
};

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    login: 'me',
    getFile: vi.fn(async (_r: unknown, path: string) =>
      path.endsWith('config.yml')
        ? { path, content: 'model: claude-sonnet-4-6\nmaxDailyRuns: 6', sha: 'c1' }
        : { path, content: 'items:\n  - title: Draft one\n    kind: post\n    status: todo', sha: 'b1' },
    ),
    listVariables: vi.fn(async () => [{ name: 'CONTENT_FACTORY_ENABLED', value: 'false' }]),
    setVariable: vi.fn(async () => {}),
    putFile: vi.fn(async () => {}),
    getDefaultBranch: vi.fn(async () => 'main'),
    createBranch: vi.fn(async () => {}),
    createPullRequest: vi.fn(async () => 'https://github.com/o/r/pull/1'),
    ...over,
  };
}

function connect(client: ReturnType<typeof fakeClient>) {
  useGithubStore.setState({ client: client as never, repo: { owner: 'o', repo: 'r' }, login: 'me' });
  useFactoryStore.getState().loadBlueprint(bpWithGate);
}

beforeEach(() => {
  useContentStore.setState({
    loading: false, error: null, saving: false, prUrl: null, mode: 'pr',
    config: { model: '', maxDailyRuns: 1, brandVoice: '', contentPaths: [], docsDir: '_docs', itemsPerRun: 3, reviewCriteria: [], skills: [] },
    configSha: null, backlog: [], backlogSha: null, switches: [],
  });
});

describe('content cockpit store', () => {
  it('refresh loads config, backlog, and the kill-switch from the blueprint + repo variables', async () => {
    connect(fakeClient());
    await useContentStore.getState().refresh();
    const s = useContentStore.getState();
    expect(s.config.model).toBe('claude-sonnet-4-6');
    expect(s.config.maxDailyRuns).toBe(6);
    expect(s.backlog).toHaveLength(1);
    expect(s.backlog[0].title).toBe('Draft one');
    expect(s.switches).toEqual([
      { variable: 'CONTENT_FACTORY_ENABLED', on: false, known: true, busy: false },
    ]);
  });

  it('toggleSwitch flips the repo variable via setVariable', async () => {
    const client = fakeClient();
    connect(client);
    await useContentStore.getState().refresh();
    await useContentStore.getState().toggleSwitch('CONTENT_FACTORY_ENABLED');
    expect(client.setVariable).toHaveBeenCalledWith({ owner: 'o', repo: 'r' }, 'CONTENT_FACTORY_ENABLED', 'true');
    expect(useContentStore.getState().switches[0].on).toBe(true);
  });

  it('saveConfig in commit mode writes .factory/config.yml', async () => {
    const client = fakeClient();
    connect(client);
    await useContentStore.getState().refresh();
    useContentStore.getState().setMode('commit');
    useContentStore.getState().setConfig({ brandVoice: 'wry' });
    await useContentStore.getState().saveConfig();
    expect(client.putFile).toHaveBeenCalled();
    const call = client.putFile.mock.calls[0] as unknown[];
    expect(call[1]).toBe('.factory/config.yml');
    expect(String(call[2])).toContain('brandVoice: wry');
  });

  it('addBacklogItem then saveBacklog (PR mode) opens a PR and drops untitled rows', async () => {
    const client = fakeClient();
    connect(client);
    await useContentStore.getState().refresh();
    useContentStore.getState().addBacklogItem(); // untitled — should be dropped on save
    const added = useContentStore.getState().backlog.at(-1)!;
    useContentStore.getState().updateBacklogItem(added.id, { title: '' });
    await useContentStore.getState().saveBacklog();
    expect(client.createPullRequest).toHaveBeenCalled();
    // the persisted backlog keeps only the titled item
    expect(useContentStore.getState().backlog).toHaveLength(1);
    expect(useContentStore.getState().prUrl).toContain('/pull/1');
  });
});
