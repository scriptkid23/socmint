import { Circle, Square } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RecordedStep } from '../../../api/client';
import { Button } from '../../ui/button';

export interface RecordNodeProps extends NodeProps {
  data: {
    steps: RecordedStep[];
    profileId: string | null;
    recording: boolean;
    onStart?: () => void;
    onStop?: () => void;
    onClear?: () => void;
    onGenerateGoto?: () => void;
  };
}

function stepLabel(s: RecordedStep): string {
  if (s.type === 'navigate') return `navigate ${s.url.slice(0, 48)}`;
  if (s.type === 'click') return `click ${s.text || s.tag}`.slice(0, 48);
  if (s.type === 'type') return `type "${s.value.slice(0, 24)}"`;
  return `scroll ${s.direction}`;
}

export function RecordNode({ data }: RecordNodeProps) {
  const steps = data.steps ?? [];
  const canRecord = Boolean(data.profileId) && !data.recording;

  return (
    <div className="min-w-64 max-w-xs border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Record
      </div>
      <div className="space-y-2 p-2">
        {!data.profileId ? (
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Connect a Profile node upstream
          </p>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Profile linked
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {data.recording ? (
            <Button
              type="button"
              variant="outline"
              className="h-7 gap-1 px-2 py-1 text-[10px]"
              onClick={() => data.onStop?.()}
            >
              <Square size={12} />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!canRecord}
              className="h-7 gap-1 px-2 py-1 text-[10px]"
              onClick={() => data.onStart?.()}
            >
              <Circle size={12} />
              Start
            </Button>
          )}
          {steps.length > 0 && !data.recording ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-7 px-2 py-1 text-[10px]"
                onClick={() => data.onClear?.()}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-7 px-2 py-1 text-[10px]"
                onClick={() => data.onGenerateGoto?.()}
              >
                → Goto
              </Button>
            </>
          ) : null}
        </div>
        <p className="font-mono text-[10px] text-muted-foreground leading-snug">
          {data.recording
            ? 'Recording… click/type/scroll in the browser, then Stop'
            : 'Run → interact → bấm Stop để lưu vào board (đừng chỉ đóng cửa sổ Chrome)'}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {data.recording ? 'Live' : `${steps.length} steps saved`}
        </p>
        {steps.length > 0 ? (
          <ol className="max-h-28 list-decimal overflow-auto pl-4 font-mono text-[10px] leading-relaxed">
            {steps.map((s, i) => (
              <li key={`${s.at}-${i}`}>{stepLabel(s)}</li>
            ))}
          </ol>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
