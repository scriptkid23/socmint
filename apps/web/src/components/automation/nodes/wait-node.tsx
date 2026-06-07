import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface WaitNodeProps extends NodeProps {
  data: {
    ms: number;
    onChange?: (ms: number) => void;
  };
}

export function WaitNode({ data }: WaitNodeProps) {
  return (
    <div className="min-w-40 border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Wait
      </div>
      <div className="p-2">
        <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          ms
        </label>
        <input
          type="number"
          min={1}
          step={100}
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          value={data.ms}
          onChange={(e) => data.onChange?.(Math.max(1, Number(e.target.value) || 1))}
        />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
