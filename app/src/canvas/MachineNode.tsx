import { Handle, Position, type NodeProps } from '@xyflow/react';
import { machineDef } from '../machines/registry';
import type { MachineNodeType } from '../state/store';

export function MachineNode({ data, selected }: NodeProps<MachineNodeType>) {
  const def = machineDef(data.machineType);
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
        <span className="led led--idle" title="No telemetry yet — lights up in seed 04" />
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
