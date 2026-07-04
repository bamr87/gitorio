import { Handle, Position, type NodeProps } from '@xyflow/react';
import { machineDef } from '../machines/registry';
import { useTelemetryStore } from '../state/telemetry';
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
  if (!def) {
    return <div className="machine machine--unknown">unknown: {data.machineType}</div>;
  }
  return (
    <div className={`machine machine--${def.category}${selected ? ' is-selected' : ''}`}>
      <div className="machine__head">
        <span className="machine__icon" aria-hidden>
          {def.icon}
        </span>
        <span className="machine__label">{def.label}</span>
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
