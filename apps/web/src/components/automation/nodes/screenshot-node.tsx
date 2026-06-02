import { Handle, Position, type NodeProps } from '@xyflow/react';

export function ScreenshotNode(_props: NodeProps) {
  return (
    <div className="min-w-40 border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Screenshot
      </div>
      <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        full page
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
