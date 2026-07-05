import { Handle, Position, type NodeProps } from '@xyflow/react';
import { machineDef } from '../machines/registry';
import { useTelemetryStore } from '../state/telemetry';
import { useBlueprintDiagnostics } from '../state/diagnostics';
import type { LedState } from '../github/types';
import type { MachineNodeType } from '../state/store';

const LED_TITLE: Record<LedState, string> = {
  on: 'Last run: success',
  warn: 'Run in progress',
  bad: 'Last run: failed',
  idle: 'No recent run',
};

export function MachineNode({ id, data, selected }: NodeProps<MachineNodeType>) {
  const def = machineDef(data.machineType);
  const led = useTelemetryStore((s) => s.statusByNode[id] ?? 'idle');
  const diags = useBlueprintDiagnostics();
  const worst = diags.worstByNode.get(id);
  const nodeDiags = diags.byNode.get(id);
  if (!def) {
    return <div className="machine machine--unknown">unknown: {data.machineType}</div>;
  }
  return (
    <div className={`machine machine--${def.category}${selected ? ' is-selected' : ''}${worst ? ` machine--${worst}` : ''}`}>
      <div className="machine__head">
        <span className="machine__icon" aria-hidden>
          {def.icon}
        </span>
        <span className="machine__label">{def.label}</span>
        {worst && (
          <span
            className={`nodebadge nodebadge--${worst}`}
            title={nodeDiags?.map((d) => `${d.level.toUpperCase()}: ${d.message}`).join('\n')}
          >
            {worst === 'error' ? '✗' : '⚠'}
          </span>
        )}
        <span className={`led led--${led}`} title={LED_TITLE[led]} />
      </div>
      <div className="machine__body">{def.describe(data.config)}</div>
      {def.category !== 'trigger' && (
        <Handle type="target" position={Position.Left} className="port port--in" />
      )}
      {def.category !== 'sink' && (
        <Handle type="source" position={Position.Right} className="port port--out" />
      )}
    </div>
  );
}
