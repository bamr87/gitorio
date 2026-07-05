import { create } from 'zustand';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { machineDef } from '../machines/registry';
import type { Blueprint, BlueprintMeta } from '../blueprint/types';
import { EXAMPLE_BLUEPRINT } from '../blueprint/example';

export type MachineData = {
  machineType: string;
  config: Record<string, unknown>;
  [key: string]: unknown;
};
export type MachineNodeType = Node<MachineData, 'machine'>;

let counter = 0;
const newId = (prefix: string) => `${prefix}${(++counter).toString(36)}${Date.now().toString(36).slice(-4)}`;

const HISTORY_MAX = 50;

interface FactoryState {
  meta: BlueprintMeta;
  nodes: MachineNodeType[];
  edges: Edge[];
  selectedId: string | null;
  /** Undo/redo depth — exposed so the UI can enable/disable controls. */
  canUndo: boolean;
  canRedo: boolean;

  onNodesChange: (changes: NodeChange<MachineNodeType>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;
  addMachine: (machineType: string, position: { x: number; y: number }) => void;
  addMachineAuto: (machineType: string) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  updateNodeConfig: (id: string, key: string, value: unknown) => void;
  setMeta: (patch: Partial<BlueprintMeta>) => void;
  setSelected: (id: string | null) => void;
  toBlueprint: () => Blueprint;
  loadBlueprint: (bp: Blueprint) => void;
  undo: () => void;
  redo: () => void;
}

function fromBlueprint(bp: Blueprint): { nodes: MachineNodeType[]; edges: Edge[] } {
  return {
    nodes: bp.nodes.map((n) => ({
      id: n.id,
      type: 'machine' as const,
      position: n.position,
      data: { machineType: n.type, config: { ...n.config } },
    })),
    edges: bp.edges.map((e) => ({
      id: e.id,
      source: e.from.node,
      target: e.to.node,
      animated: true,
    })),
  };
}

const initial = fromBlueprint(EXAMPLE_BLUEPRINT);

// Undo history lives OUTSIDE the store state: snapshots are full blueprints (cheap — the
// canvas is small), pushed before each semantic mutation. Consecutive edits to the same
// field coalesce into one undo step via `lastOpKey`.
let past: Blueprint[] = [];
let future: Blueprint[] = [];
let lastOpKey: string | null = null;

export const useFactoryStore = create<FactoryState>((set, get) => {
  /** Push an undo snapshot unless this op coalesces with the previous one. */
  const checkpoint = (opKey: string | null = null) => {
    if (opKey !== null && opKey === lastOpKey) return; // coalesce edit bursts
    lastOpKey = opKey;
    past = [...past.slice(-(HISTORY_MAX - 1)), get().toBlueprint()];
    future = [];
    set({ canUndo: true, canRedo: false });
  };

  /** Replace canvas state from a snapshot without touching history. */
  const restore = (bp: Blueprint) => {
    const { nodes, edges } = fromBlueprint(bp);
    const selected = get().selectedId;
    set({
      meta: { ...bp.meta },
      nodes,
      edges,
      selectedId: selected && nodes.some((n) => n.id === selected) ? selected : null,
    });
  };

  return {
    meta: { ...EXAMPLE_BLUEPRINT.meta },
    nodes: initial.nodes,
    edges: initial.edges,
    selectedId: null,
    canUndo: false,
    canRedo: false,

    onNodesChange: (changes) => {
      // Node removal via keyboard is a semantic change; drags/selections are not.
      if (changes.some((c) => c.type === 'remove')) checkpoint();
      set({ nodes: applyNodeChanges(changes, get().nodes) });
    },
    onEdgesChange: (changes) => {
      if (changes.some((c) => c.type === 'remove')) checkpoint();
      set({ edges: applyEdgeChanges(changes, get().edges) });
    },

    onConnect: (conn) => {
      const { edges } = get();
      const duplicate = edges.some((e) => e.source === conn.source && e.target === conn.target);
      if (duplicate || conn.source === conn.target) return;
      checkpoint();
      set({ edges: addEdge({ ...conn, animated: true }, edges) });
    },

    addMachine: (machineType, position) => {
      const def = machineDef(machineType);
      if (!def) return;
      checkpoint();
      const nodeItem: MachineNodeType = {
        id: newId('m'),
        type: 'machine',
        position,
        data: { machineType, config: { ...def.defaults } },
      };
      set({ nodes: [...get().nodes, nodeItem], selectedId: nodeItem.id });
    },

    // Click-to-add (no drag): drop the machine in a cascading spot so successive adds don't stack.
    addMachineAuto: (machineType) => {
      const n = get().nodes.length;
      get().addMachine(machineType, { x: 220 + (n % 5) * 36, y: 90 + (n % 8) * 44 });
    },

    deleteNode: (id) => {
      checkpoint();
      set({
        nodes: get().nodes.filter((n) => n.id !== id),
        edges: get().edges.filter((e) => e.source !== id && e.target !== id),
        selectedId: get().selectedId === id ? null : get().selectedId,
      });
    },

    duplicateNode: (id) => {
      const src = get().nodes.find((n) => n.id === id);
      if (!src) return;
      checkpoint();
      const copy: MachineNodeType = {
        id: newId('m'),
        type: 'machine',
        position: { x: src.position.x + 36, y: src.position.y + 36 },
        data: { machineType: src.data.machineType, config: { ...src.data.config } },
      };
      set({ nodes: [...get().nodes, copy], selectedId: copy.id });
    },

    updateNodeConfig: (id, key, value) => {
      checkpoint(`config:${id}:${key}`);
      set({
        nodes: get().nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } } : n,
        ),
      });
    },

    setMeta: (patch) => {
      checkpoint(`meta:${Object.keys(patch).join(',')}`);
      set({ meta: { ...get().meta, ...patch } });
    },
    setSelected: (id) => set({ selectedId: id }),

    toBlueprint: () => {
      const { meta, nodes, edges } = get();
      return {
        version: 1,
        meta: { ...meta },
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.data.machineType,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
          config: { ...n.data.config },
        })),
        edges: edges.map((e) => ({
          id: e.id,
          from: { node: e.source, port: 'out' },
          to: { node: e.target, port: 'in' },
        })),
      };
    },

    loadBlueprint: (bp) => {
      checkpoint();
      const { nodes, edges } = fromBlueprint(bp);
      set({ meta: { ...bp.meta }, nodes, edges, selectedId: null });
    },

    undo: () => {
      const prev = past[past.length - 1];
      if (!prev) return;
      past = past.slice(0, -1);
      future = [get().toBlueprint(), ...future.slice(0, HISTORY_MAX - 1)];
      lastOpKey = null;
      restore(prev);
      set({ canUndo: past.length > 0, canRedo: true });
    },

    redo: () => {
      const next = future[0];
      if (!next) return;
      future = future.slice(1);
      past = [...past.slice(-(HISTORY_MAX - 1)), get().toBlueprint()];
      lastOpKey = null;
      restore(next);
      set({ canUndo: true, canRedo: future.length > 0 });
    },
  };
});
