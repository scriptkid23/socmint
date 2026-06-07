import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { IfCondition } from '../../../api/client';
import { Input } from '../../ui/input';

export interface IfNodeProps extends NodeProps {
  data: {
    selector: string;
    condition: IfCondition;
    onChange?: (patch: { selector?: string; condition?: IfCondition }) => void;
  };
}

export function IfNode({ data }: IfNodeProps) {
  return (
    <div className="min-w-56 border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        If
      </div>
      <div className="space-y-2 p-2">
        <Input
          className="h-7 px-2 text-xs"
          placeholder="CSS selector"
          value={data.selector}
          onChange={(e) => data.onChange?.({ selector: e.target.value })}
        />
        <select
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-[10px] uppercase"
          value={data.condition ?? 'exists'}
          onChange={(e) => data.onChange?.({ condition: e.target.value as IfCondition })}
        >
          <option value="exists">exists</option>
          <option value="not_exists">not exists</option>
        </select>
        <p className="font-mono text-[9px] leading-snug text-muted-foreground">
          true → upper handle · false → lower handle
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: '38%' }}
        className="!bg-emerald-600"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={{ top: '72%' }}
        className="!bg-rose-600"
      />
    </div>
  );
}
