import { useCallback } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import { useFactoryStore } from '../state/store';
import { MachineNode } from './MachineNode';

const nodeTypes = { machine: MachineNode };
export const DRAG_MIME = 'application/gitfactory-machine';

// Own provider so the authoring flow's store never bleeds into the observe-mode
// FleetCanvas (which has different node types). Only one canvas mounts at a time.
export function FactoryCanvas() {
  return (
    <ReactFlowProvider>
      <FactoryCanvasInner />
    </ReactFlowProvider>
  );
}

function FactoryCanvasInner() {
  const nodes = useFactoryStore((s) => s.nodes);
  const edges = useFactoryStore((s) => s.edges);
  const onNodesChange = useFactoryStore((s) => s.onNodesChange);
  const onEdgesChange = useFactoryStore((s) => s.onEdgesChange);
  const onConnect = useFactoryStore((s) => s.onConnect);
  const addMachine = useFactoryStore((s) => s.addMachine);
  const setSelected = useFactoryStore((s) => s.setSelected);

  const { screenToFlowPosition } = useReactFlow();

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const machineType = e.dataTransfer.getData(DRAG_MIME);
      if (!machineType) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addMachine(machineType, { x: pos.x - 90, y: pos.y - 24 });
    },
    [screenToFlowPosition, addMachine],
  );

  const onSelectionChange = useCallback(
    ({ nodes: sel }: OnSelectionChangeParams) => setSelected(sel[0]?.id ?? null),
    [setSelected],
  );

  return (
    <div className="canvas" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        snapToGrid
        snapGrid={[16, 16]}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        defaultEdgeOptions={{ animated: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
