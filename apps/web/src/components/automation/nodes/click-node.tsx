import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface ClickNodeProps extends NodeProps {
  data: {
    selector: string;
    onChange?: (patch: { selector?: string }) => void;
  };
}

export function ClickNode({ data }: ClickNodeProps) {
  return (
    <div className="min-w-56 max-w-xs border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Click
      </div>
      <div className="space-y-2 p-2">
        <label className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          selector or text=
        </label>
        <input
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          placeholder="button.submit  |  #login  |  text=Sign in"
          value={data.selector ?? ''}
          onChange={(e) => data.onChange?.({ selector: e.target.value })}
        />
        <p className="font-mono text-[9px] leading-snug text-muted-foreground">
          Waits up to 5s. Prefer a short selector or text= over a copied
          devtools path (long paths break easily).
        </p>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
