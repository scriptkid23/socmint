import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Profile } from '../../../api/client';

export interface ProfileNodeProps extends NodeProps {
  data: {
    profileId: string | null;
    profiles?: Profile[];
    onChange?: (profileId: string | null) => void;
  };
}

export function ProfileNode({ data }: ProfileNodeProps) {
  const profiles = data.profiles ?? [];
  return (
    <div className="min-w-44 border-2 border-foreground bg-background">
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Profile
      </div>
      <div className="p-2">
        <select
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          value={data.profileId ?? ''}
          onChange={(e) => data.onChange?.(e.target.value || null)}
        >
          <option value="">— select profile —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
