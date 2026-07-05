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

interface FactoryState {
  meta: BlueprintMeta;
  nodes: MachineNodeType[];
  edges: Edge[];
  selectedId: string | null;

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

export const useFactoryStore = create<FactoryState>((set, get) => ({
  meta: { ...EXAMPLE_BLUEPRINT.meta },
  nodes: initial.nodes,
  edges: initial.edges,
  selectedId: null,

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (conn) => {
    const { edges } = get();
    const duplicate = edges.some((e) => e.source === conn.source && e.target === conn.target);
    if (duplicate || conn.source === conn.target) return;
    set({ edges: addEdge({ ...conn, animated: true }, edges) });
  },

  addMachine: (machineType, position) => {
    const def = machineDef(machineType);
    if (!def) return;
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

  deleteNode: (id) =>
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
    }),

  duplicateNode: (id) => {
    const src = get().nodes.find((n) => n.id === id);
    if (!src) return;
    const copy: MachineNodeType = {
      id: newId('m'),
      type: 'machine',
      position: { x: src.position.x + 36, y: src.position.y + 36 },
      data: { machineType: src.data.machineType, config: { ...src.data.config } },
    };
    set({ nodes: [...get().nodes, copy], selectedId: copy.id });
  },

  updateNodeConfig: (id, key, value) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } } : n,
      ),
    }),

  setMeta: (patch) => set({ meta: { ...get().meta, ...patch } }),
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
    const { nodes, edges } = fromBlueprint(bp);
    set({ meta: { ...bp.meta }, nodes, edges, selectedId: null });
  },
}));
