import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WaitUntil } from '../../../api/client';

export interface GotoNodeProps extends NodeProps {
  data: {
    url: string;
    waitUntil?: WaitUntil;
    onChange?: (patch: { url?: string; waitUntil?: WaitUntil }) => void;
  };
}

export function GotoNode({ data }: GotoNodeProps) {
  return (
    <div className="min-w-52 border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Goto
      </div>
      <div className="space-y-2 p-2">
        <input
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          placeholder="https://…"
          value={data.url}
          onChange={(e) => data.onChange?.({ url: e.target.value })}
        />
        <select
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-[10px] uppercase"
          value={data.waitUntil ?? 'load'}
          onChange={(e) => data.onChange?.({ waitUntil: e.target.value as WaitUntil })}
        >
          <option value="load">load</option>
          <option value="domcontentloaded">domcontentloaded</option>
          <option value="commit">commit</option>
        </select>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
