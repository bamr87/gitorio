import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';
import { useFleetStore } from '../state/fleet';
import { layoutFleet } from '../fleet/layout';
import { externalNodeId } from '../fleet/types';
import { ExternalRepoNode, WorkflowNode } from './WorkflowNode';

const nodeTypes = { workflow: WorkflowNode, external: ExternalRepoNode };

export function FleetCanvas() {
  const fleet = useFleetStore((s) => s.fleet);

  const { nodes, edges, key } = useMemo(() => {
    if (!fleet) return { nodes: [] as Node[], edges: [] as Edge[], key: 'empty' };
    const pos = layoutFleet(fleet);

    const wfNodes: Node[] = fleet.workflows.map((wf) => ({
      id: wf.path,
      type: 'workflow',
      position: pos.get(wf.path) ?? { x: 0, y: 0 },
      data: { wf },
    }));
    const extNodes: Node[] = fleet.externalRepos.map((name) => ({
      id: externalNodeId(name),
      type: 'external',
      position: pos.get(externalNodeId(name)) ?? { x: 0, y: 0 },
      data: { name },
    }));
    const rfEdges: Edge[] = fleet.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.label,
      animated: e.kind === 'workflow_run',
      className: `fleetedge--${e.kind}`,
    }));

    return {
      nodes: [...wfNodes, ...extNodes],
      edges: rfEdges,
      key: `${fleet.repo.owner}/${fleet.repo.repo}:${fleet.workflows.length}`,
    };
  }, [fleet]);

  if (!fleet) return <div className="canvas" />;

  return (
    <div className="canvas">
      <ReactFlowProvider>
        <ReactFlow
          key={key}
          defaultNodes={nodes}
          defaultEdges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
