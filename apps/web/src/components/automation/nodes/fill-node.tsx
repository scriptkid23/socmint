import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface FillNodeProps extends NodeProps {
  data: {
    selector: string;
    value: string;
    onChange?: (patch: { selector?: string; value?: string }) => void;
  };
}

export function FillNode({ data }: FillNodeProps) {
  return (
    <div className="min-w-56 max-w-xs border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Fill
      </div>
      <div className="space-y-2 p-2">
        <label className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          CSS selector
        </label>
        <input
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          placeholder="#email, input[name=q], .search"
          value={data.selector ?? ''}
          onChange={(e) => data.onChange?.({ selector: e.target.value })}
        />
        <label className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          value
        </label>
        <textarea
          className="h-14 w-full resize-y border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          placeholder="value to type into the field"
          value={data.value ?? ''}
          onChange={(e) => data.onChange?.({ value: e.target.value })}
        />
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
