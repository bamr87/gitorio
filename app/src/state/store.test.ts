import { beforeEach, describe, expect, it } from 'vitest';
import { useFactoryStore } from './store';
import { EXAMPLE_BLUEPRINT } from '../blueprint/example';

// The store is a module singleton — reset to the example blueprint between tests. Each
// loadBlueprint pushes history, so drain the undo stack afterwards by loading then
// clearing via direct undo calls until inert.
function reset() {
  const s = useFactoryStore.getState();
  s.loadBlueprint(JSON.parse(JSON.stringify(EXAMPLE_BLUEPRINT)));
  // drain history so tests start from a clean past/future
  for (let i = 0; i < 60 && useFactoryStore.getState().canUndo; i++) useFactoryStore.getState().undo();
  s.loadBlueprint(JSON.parse(JSON.stringify(EXAMPLE_BLUEPRINT)));
}

describe('factory store: node actions + undo/redo', () => {
  beforeEach(reset);

  it('addMachineAuto adds and selects; deleteNode removes node and its belts', () => {
    const before = useFactoryStore.getState().nodes.length;
    useFactoryStore.getState().addMachineAuto('trigger.manual');
    const st = useFactoryStore.getState();
    expect(st.nodes.length).toBe(before + 1);
    const added = st.nodes[st.nodes.length - 1];
    expect(st.selectedId).toBe(added.id);

    useFactoryStore.getState().deleteNode(added.id);
    expect(useFactoryStore.getState().nodes.length).toBe(before);
    expect(useFactoryStore.getState().selectedId).toBeNull();
  });

  it('duplicateNode copies type + config at an offset', () => {
    const src = useFactoryStore.getState().nodes.find((n) => n.data.machineType === 'agent.claude')!;
    useFactoryStore.getState().duplicateNode(src.id);
    const st = useFactoryStore.getState();
    const copy = st.nodes[st.nodes.length - 1];
    expect(copy.data.machineType).toBe('agent.claude');
    expect(copy.data.config).toEqual(src.data.config);
    expect(copy.id).not.toBe(src.id);
    expect(copy.position.x).toBe(src.position.x + 36);
  });

  it('undo reverses an add; redo replays it', () => {
    const before = useFactoryStore.getState().nodes.length;
    useFactoryStore.getState().addMachineAuto('sink.comment');
    expect(useFactoryStore.getState().nodes.length).toBe(before + 1);
    expect(useFactoryStore.getState().canUndo).toBe(true);

    useFactoryStore.getState().undo();
    expect(useFactoryStore.getState().nodes.length).toBe(before);
    expect(useFactoryStore.getState().canRedo).toBe(true);

    useFactoryStore.getState().redo();
    expect(useFactoryStore.getState().nodes.length).toBe(before + 1);
  });

  it('coalesces consecutive edits to the same config field into one undo step', () => {
    const agent = useFactoryStore.getState().nodes.find((n) => n.data.machineType === 'agent.claude')!;
    const original = agent.data.config.maxTurns;
    useFactoryStore.getState().updateNodeConfig(agent.id, 'maxTurns', 9);
    useFactoryStore.getState().updateNodeConfig(agent.id, 'maxTurns', 10);
    useFactoryStore.getState().updateNodeConfig(agent.id, 'maxTurns', 11);
    useFactoryStore.getState().undo(); // one undo unwinds the whole burst
    const after = useFactoryStore.getState().nodes.find((n) => n.id === agent.id)!;
    expect(after.data.config.maxTurns).toBe(original);
  });

  it('a different field breaks coalescing (two separate undo steps)', () => {
    const agent = useFactoryStore.getState().nodes.find((n) => n.data.machineType === 'agent.claude')!;
    useFactoryStore.getState().updateNodeConfig(agent.id, 'maxTurns', 9);
    useFactoryStore.getState().updateNodeConfig(agent.id, 'model', 'claude-opus-4-8');
    useFactoryStore.getState().undo();
    let now = useFactoryStore.getState().nodes.find((n) => n.id === agent.id)!;
    expect(now.data.config.maxTurns).toBe(9); // second step undone first
    useFactoryStore.getState().undo();
    now = useFactoryStore.getState().nodes.find((n) => n.id === agent.id)!;
    expect(now.data.config.maxTurns).toBe(8);
  });
});
