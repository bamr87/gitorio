import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useFleetStore } from '../state/fleet';
import type { ImportedWorkflow, SinkKind } from '../fleet/types';

export type WorkflowNodeData = { wf: ImportedWorkflow };
export type WorkflowNodeType = Node<WorkflowNodeData, 'workflow'>;
export type ExternalNodeData = { name: string };
export type ExternalNodeType = Node<ExternalNodeData, 'external'>;

const TRIGGER_ICON: Record<string, string> = {
  schedule: '⏰',
  workflow_dispatch: '🕹️',
  workflow_run: '🔁',
  push: '⬆️',
  pull_request: '🔀',
  issues: '📥',
  issue_comment: '💬',
  repository_dispatch: '📡',
};

const SINK_LABEL: Record<SinkKind, string> = {
  pr: 'PR',
  issue: 'issue',
  comment: 'comment',
  label: 'label',
  commit: 'commit',
  deploy: 'deploy',
  cross_repo_issue: '↗ issue',
  dispatch: 'dispatch',
};

export function WorkflowNode({ data }: NodeProps<WorkflowNodeType>) {
  const wf = data.wf;
  const led = useFleetStore((s) => s.statusByPath[wf.path] ?? 'idle');
  const triggerKinds = Array.from(new Set(wf.triggers.map((t) => t.kind)));

  return (
    <div className={`wfnode${wf.hasAgent ? ' wfnode--agent' : ''}`}>
      <Handle type="target" position={Position.Left} className="port port--in" />
      <div className="wfnode__head">
        <span className="wfnode__triggers" aria-hidden>
          {triggerKinds.map((k) => TRIGGER_ICON[k] ?? '•').join(' ')}
        </span>
        <span className="wfnode__name" title={wf.path}>
          {wf.name}
        </span>
        <span className={`led led--${led}`} title={`last run: ${led}`} />
      </div>

      {wf.hasAgent && wf.agent && (
        <div className="wfnode__agent">
          ⚙ {wf.agent.agentName ? wf.agent.agentName : 'agent'}
          <span className="wfnode__runner">{wf.agent.runner}</span>
        </div>
      )}

      <div className="wfnode__sinks">
        {wf.sinks.length === 0 && <span className="wfnode__none">read-only</span>}
        {wf.sinks.map((s) => (
          <span key={s} className={`sinkbadge sinkbadge--${s === 'cross_repo_issue' ? 'cross' : 'in'}`}>
            {SINK_LABEL[s]}
          </span>
        ))}
      </div>

      {wf.gate && <div className="wfnode__gate">🔒 {wf.gate}</div>}
      <Handle type="source" position={Position.Right} className="port port--out" />
    </div>
  );
}

export function ExternalRepoNode({ data }: NodeProps<ExternalNodeType>) {
  return (
    <div className="extnode" title={`external repo: ${data.name}`}>
      <Handle type="target" position={Position.Left} className="port port--in" />
      <span className="extnode__icon" aria-hidden>
        🛰️
      </span>
      <span className="extnode__name">{data.name}</span>
    </div>
  );
}
