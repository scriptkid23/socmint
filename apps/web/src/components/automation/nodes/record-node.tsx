import { Circle, Square, Trash2 } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RecordedStep, RecordNodeMode } from '../../../api/client';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';

const DEFAULT_REPLAY_DELAY_MS = 500;

export interface RecordNodeProps extends NodeProps {
  data: {
    mode?: RecordNodeMode;
    steps: RecordedStep[];
    profileId: string | null;
    recording: boolean;
    replayDelayMs?: number;
    onSetMode?: (mode: RecordNodeMode) => void;
    onChangeSteps?: (steps: RecordedStep[]) => void;
    onChangeDelay?: (ms: number) => void;
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

function ModeToggle({
  mode,
  onSetMode,
}: {
  mode: RecordNodeMode;
  onSetMode?: (mode: RecordNodeMode) => void;
}) {
  return (
    <div className="flex border-2 border-foreground font-mono text-[10px] uppercase tracking-widest">
      {(['record', 'replay'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onSetMode?.(m)}
          className={`flex-1 px-2 py-1 ${
            mode === m ? 'bg-foreground text-background' : 'bg-background text-foreground'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function RecordMode({ data, steps }: { data: RecordNodeProps['data']; steps: RecordedStep[] }) {
  const canRecord = Boolean(data.profileId) && !data.recording;
  return (
    <>
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
    </>
  );
}

function ReplayStepRow({
  step,
  onChange,
  onRemove,
}: {
  step: RecordedStep;
  onChange: (next: RecordedStep) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-12 shrink-0 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {step.type}
      </span>
      {step.type === 'navigate' ? (
        <Input
          className="h-6 flex-1 px-1 text-[10px]"
          value={step.url}
          onChange={(e) => onChange({ ...step, url: e.target.value })}
        />
      ) : step.type === 'scroll' ? (
        <select
          className="h-6 flex-1 border border-foreground bg-background px-1 text-[10px]"
          value={step.direction}
          onChange={(e) => onChange({ ...step, direction: e.target.value as 'up' | 'down' })}
        >
          <option value="up">up</option>
          <option value="down">down</option>
        </select>
      ) : (
        <>
          {step.type === 'click' && step.text ? (
            <span
              className="max-w-20 shrink-0 truncate font-mono text-[9px] text-muted-foreground"
              title={step.text}
            >
              {step.text}
            </span>
          ) : null}
          <Input
            className="h-6 min-w-0 flex-1 px-1 text-[10px]"
            placeholder="selector"
            value={step.selector}
            onChange={(e) => onChange({ ...step, selector: e.target.value })}
          />
          {step.type === 'type' ? (
            <Input
              className="h-6 flex-1 px-1 text-[10px]"
              placeholder="value"
              value={step.value}
              onChange={(e) => onChange({ ...step, value: e.target.value })}
            />
          ) : null}
        </>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Remove step"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function ReplayMode({ data, steps }: { data: RecordNodeProps['data']; steps: RecordedStep[] }) {
  const update = (i: number, next: RecordedStep) =>
    data.onChangeSteps?.(steps.map((s, idx) => (idx === i ? next : s)));
  const remove = (i: number) => data.onChangeSteps?.(steps.filter((_, idx) => idx !== i));

  if (steps.length === 0) {
    return (
      <p className="font-mono text-[10px] text-muted-foreground leading-snug">
        No recorded steps yet. Switch to Record, capture interactions, then return here to edit & replay.
      </p>
    );
  }
  const delayMs = data.replayDelayMs ?? DEFAULT_REPLAY_DELAY_MS;
  const delaySeconds = (delayMs / 1000).toString();
  return (
    <>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {steps.length} steps · editable
      </p>
      <label className="nodrag flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span className="shrink-0">Delay/step (s)</span>
        <Input
          type="number"
          min="0"
          step="0.1"
          className="h-6 w-16 px-1 text-[10px]"
          value={delaySeconds}
          onChange={(e) => {
            const seconds = Number(e.target.value);
            if (!Number.isFinite(seconds) || seconds < 0) return;
            data.onChangeDelay?.(Math.round(seconds * 1000));
          }}
        />
      </label>
      <div className="nodrag max-h-48 space-y-1 overflow-auto">
        {steps.map((s, i) => (
          <ReplayStepRow
            key={`${s.at}-${i}`}
            step={s}
            onChange={(next) => update(i, next)}
            onRemove={() => remove(i)}
          />
        ))}
      </div>
      <p className="font-mono text-[10px] text-muted-foreground leading-snug">
        Run the board to replay these steps in order.
      </p>
    </>
  );
}

export function RecordNode({ data }: RecordNodeProps) {
  const steps = data.steps ?? [];
  const mode = data.mode ?? 'record';

  return (
    <div className="min-w-64 max-w-xs border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        Record
      </div>
      <div className="space-y-2 p-2">
        <ModeToggle mode={mode} onSetMode={data.onSetMode} />
        {!data.profileId ? (
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Connect a Profile node upstream
          </p>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Profile linked
          </p>
        )}
        {mode === 'record' ? (
          <RecordMode data={data} steps={steps} />
        ) : (
          <ReplayMode data={data} steps={steps} />
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
