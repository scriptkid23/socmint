import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface ScriptNodeProps extends NodeProps {
  data: {
    code: string;
    onChange?: (patch: { code?: string }) => void;
  };
}

export function ScriptNode({ data }: ScriptNodeProps) {
  return (
    <div className="min-w-56 max-w-xs border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Script
      </div>
      <div className="p-2">
        <textarea
          className="nodrag min-h-20 w-full resize-y border-2 border-foreground bg-background px-2 py-1 font-mono text-[10px] leading-relaxed"
          placeholder={'alert("hello")'}
          value={data.code}
          onChange={(e) => data.onChange?.({ code: e.target.value })}
        />
        <p className="mt-1 font-mono text-[9px] leading-snug text-muted-foreground">
          Runs in the page (alert, DOM, etc.)
        </p>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
